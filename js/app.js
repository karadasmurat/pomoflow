/**
 * PomoFlow App Controller (The Glue Layer)
 * This file coordinates Domain Services and UI Views.
 */

import { state, mutations, STORAGE_KEYS, CURRENT_VERSION, DEFAULT_FOCUS_AREAS, ACHIEVEMENTS } from './state/store.js';
import { timer } from './engine/timer.js';
import { dbManager } from './db.js';
import { HistoryService } from './services/history.service.js';
import { FocusService } from './services/focus.service.js';
import { TimerService } from './services/timer.service.js';
import { SettingsService } from './services/settings.service.js';
import { TimerView } from './ui/timer.view.js';
import { FocusView } from './ui/focus.view.js';
import { DashboardView } from './ui/dashboard.view.js';

let currentFilter = 'today';
let showAllHistory = false;
let editingSessionId = null;
let editingTaskId = null;

// --- 1. INITIALIZATION ---

async function init() {
    try { await dbManager.init(); } catch (e) { console.error('DB Init failed', e); }

    if (dbManager.initialized) {
        const fullState = await dbManager.getFullState();
        if (!fullState.appState?.migrated) {
            loadLegacyData();
            await dbManager.migrateFromLocalStorage(state);
            purgeLocalStorage();
        } else {
            if (fullState.tasks.length > 0) state.tasks = fullState.tasks;
            if (fullState.sessions.length > 0) state.sessions = fullState.sessions;
            if (fullState.aims.length > 0) state.aims = fullState.aims;
            if (fullState.settings) state.settings = { ...state.settings, ...fullState.settings };
            
            if (fullState.profile?.full_profile) {
                const p = fullState.profile.full_profile;
                state.xp = p.xp || 0; state.totalXp = p.totalXp || 0;
                state.level = p.level || 1; state.avatar = p.avatar || '🦉';
                state.unlockedAchievements = p.unlockedAchievements || [];
                state.collapsedCategories = p.collapsedCategories || [];
                state.activeCategoryIndex = p.activeCategoryIndex || 0;
            }
            
            if (fullState.appState) {
                if (fullState.appState.timer_state) state.timerState = { ...state.timerState, ...fullState.appState.timer_state };
                if (fullState.appState.theme) document.documentElement.setAttribute('data-theme', fullState.appState.theme);
                if (fullState.appState.notification_prompt) state.notificationPermission = fullState.appState.notification_prompt;
                if (fullState.appState.ui_state) {
                    const ui = fullState.appState.ui_state;
                    state.selectedTaskColor = ui.selectedTaskColor || '#58a6ff';
                    state.selectedFocusAreaIds = ui.selectedFocusAreaIds || [];
                }
            }
        }
    } else {
        loadLegacyData();
    }

    if (state.tasks.length === 0) {
        state.tasks = DEFAULT_FOCUS_AREAS.map((t, index) => ({
            id: (Date.now() + index).toString(),
            name: t.name, category: t.category, color: t.color,
            completed: false, createdAt: new Date().toISOString()
        }));
        saveData();
    }

    setupEventListeners();
    
    timer.init({
        onTick: () => TimerView.updateDisplay(),
        onComplete: handleSessionComplete,
        onSave: saveData
    });

    refreshUI();
    state.lastLogicalDate = HistoryService.getLogicalDate();
    state.lastRefreshTime = Date.now();
    setInterval(updateDateTime, 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') updateDateTime(); });

    restoreTimerState();
    checkAchievements();
}

function refreshUI() {
    renderFocusAreas();
    DashboardView.renderHistory(currentFilter, { 
        showAllHistory, 
        callbacks: { 
            formatTimestamp, 
            onDelete: deleteSession, 
            onEdit: openSessionEditModal 
        } 
    });
    renderPlan();
    FocusView.updateLevelUI();
    TimerView.updateDisplay();
    DashboardView.updateStats();
    updateDateTime();
}

// --- 2. TIMER & SESSION ---

function toggleTimer() {
    if (state.timerState.isRunning) {
        timer.stop();
    } else {
        const display = document.querySelector('.timer-display');
        if (display?.classList.contains('has-message')) {
            const msgEl = document.getElementById('timerMessage');
            if (msgEl) msgEl.innerHTML = '';
            display.classList.remove('has-message');
        }

        // Fix: If timer is at 0:00, we must apply the mode to get the full duration back
        if (state.timerState.remainingTime <= 0) {
            timer.applyMode(state.timerState.mode);
        }

        timer.start();
    }
}

function resetTimer() {
    const display = document.querySelector('.timer-display');
    const isPostSession = display?.classList.contains('has-message');

    if (isPostSession) {
        // User wants to restart the session that JUST finished.
        // We need to revert the mode change that happened in handleSessionComplete.
        const currentMode = state.timerState.mode;
        
        if (currentMode === 'work') {
            // We just finished a break. Go back to break.
            if (state.timerState.cycleStation > 1) {
                state.timerState.mode = 'shortBreak';
                state.timerState.cycleStation--;
            } else {
                state.timerState.mode = 'longBreak';
                state.timerState.cycleStation = state.settings.sessionsBeforeLongBreak;
            }
        } else {
            // We just finished a focus session. Go back to work.
            state.timerState.mode = 'work';
            state.timerState.sessionCount = Math.max(0, state.timerState.sessionCount - 1);
        }

        // Clear the guidance message
        const msgEl = document.getElementById('timerMessage');
        if (msgEl) msgEl.innerHTML = '';
        display.classList.remove('has-message');
    }

    timer.reset();
    refreshUI();
}

function handleSessionComplete(skipped = false) {
    timer.stop();
    const { wasWork, nextMode } = TimerService.handleSessionEnd(skipped);

    if (!skipped) {
        if (wasWork) saveSession();
        timer.playTone(wasWork ? 440 : 880, 0.1, 0);
        notify(wasWork ? 'Focus session complete! 🚀' : 'Break is over! Ready to focus?');
    }
    
    if (skipped) {
        // Escape Hatch: Skip suggested session
        // 1. Clear UI message if it exists
        const display = document.querySelector('.timer-display');
        if (display?.classList.contains('has-message')) {
            const msgEl = document.getElementById('timerMessage');
            if (msgEl) msgEl.innerHTML = '';
            display.classList.remove('has-message');
        }
        
        // 2. Set mode and apply full duration
        state.timerState.mode = nextMode;
        timer.applyMode(nextMode);
    } else {
        // Transition to 'End-of-Session' (0:00 + Guidance)
        state.timerState.mode = nextMode;
        state.timerState.remainingTime = 0;
        TimerView.updateDisplay();
        
        const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: state.settings.use12Hour });
        const msgEl = document.getElementById('timerMessage');
        if (msgEl) {
            msgEl.innerHTML = `<span class="msg-status">Finished ${wasWork ? 'Focus Area' : 'Break'} at ${time}</span><span class="msg-action">Ready for a ${nextMode === 'longBreak' ? 'long break' : (nextMode === 'shortBreak' ? 'break' : 'focus session')}?</span>`;
            document.querySelector('.timer-display')?.classList.add('has-message');
        }
    }
    
    saveData();
    refreshUI();

    if (!skipped && ((nextMode === 'work' && state.settings.autoStartWork) || (nextMode !== 'work' && state.settings.autoStartBreaks))) {
        setTimeout(() => { if (state.timerState.remainingTime <= 0) timer.applyMode(state.timerState.mode); timer.start(); }, 1500);
    }
}

function saveSession() {
    const session = { 
        id: Date.now().toString(), taskId: state.timerState.activeTaskId, 
        duration: state.settings.workDuration * 60, timestamp: new Date().toISOString() 
    };

    if (state.timerState.activeTaskId) {
        const t = state.tasks.find(x => x.id === state.timerState.activeTaskId);
        if (t) {
            t.totalTime += session.duration;
            session.taskName = t.name; session.taskColor = t.color;
            const aim = FocusView.getActiveAimForFocusArea(t.id);
            if (aim && !aim.completedBonusAwarded && FocusView._getTimeSpentOnAim(aim) >= aim.targetMinutes * 60) {
                aim.completedBonusAwarded = true;
                addXP(500, true); notify(`Milestone: +500 XP!`);
            }
        }
    }
    
    state.sessions.push(session);
    if (dbManager.initialized) dbManager.insertSession(session);
    addXP(Math.floor(session.duration / 60) * 10);
    saveData();
}

function updateActiveDuration(mins, notifyUser = true) {
    mins = parseInt(mins);
    if (isNaN(mins) || mins <= 0) return;

    const mode = state.timerState.mode;
    let settingKey = mode === 'work' ? 'workDuration' : (mode === 'shortBreak' ? 'shortBreakDuration' : 'longBreakDuration');

    mutations.updateSettings({ [settingKey]: mins });
    timer.stop();
    timer.applyMode(mode);
    saveData();
    refreshUI();

    if (notifyUser) {
        const modeName = mode === 'work' ? 'Focus' : (mode === 'shortBreak' ? 'Short Break' : 'Long Break');
        notify(`${modeName} duration set to ${mins}m ⏱️`);
    }
}

// --- 3. DOMAIN ACTIONS ---

function renderFocusAreas() {
    FocusView.renderFocusAreas({
        onPlay: (task) => {
            if (state.timerState.activeTaskId === task.id) toggleTimer();
            else { state.timerState.activeTaskId = task.id; timer.stop(); timer.applyMode('work'); timer.start(); }
            renderFocusAreas(); closeFocusAreas();
        },
        onEdit: (task) => openFocusAreaEditModal(task),
        onToggleComplete: (id) => toggleFocusAreaComplete(id),
        onDelete: (id) => deleteFocusArea(id),
        onStateChange: () => saveData()
    });
}

function addFocusArea() {
    const name = document.getElementById('focusAreaInput').value.trim();
    const cat = document.getElementById('focusAreaCategorySelect').value;
    if (FocusService.addFocusArea(name, cat)) {
        document.getElementById('focusAreaInput').value = '';
        saveData(); renderFocusAreas();
    }
}

function toggleFocusAreaComplete(id) {
    const t = state.tasks.find(x => x.id === id);
    if (t) {
        t.completed = !t.completed;
        if (t.completed && state.timerState.activeTaskId === id) state.timerState.activeTaskId = null;
        saveData(); renderFocusAreas();
    }
}

function deleteFocusArea(id) {
    confirmAction('Delete focus area?').then(conf => {
        if (conf) { FocusService.deleteFocusArea(id); saveData(); renderFocusAreas(); }
    });
}

function deleteSession(id) {
    confirmAction('Delete session record?').then(conf => {
        if (conf) {
            state.sessions = state.sessions.filter(s => s.id !== id);
            saveData(); refreshUI();
        }
    });
}

function renderPlan() {
    FocusView.renderPlan({
        onEditAim: (id) => editAim(id),
        onGoAgain: (a) => goAgain(a),
        onDeleteAim: (id) => { state.aims = state.aims.filter(x => x.id !== id); saveData(); renderPlan(); },
        onShare: (name, mins) => SettingsService.handleShare('x', 'milestone', { focusArea: name, duration: mins }, notify)
    });
}

function addAim() {
    const raw = document.getElementById('aimDurationInput').value.trim();
    const mins = FocusView.parseDuration(raw);
    if (!mins || state.selectedFocusAreaIds.length === 0) return notify('Select area and duration');
    
    const type = document.getElementById('aimDeadlineSelect').value;
    let date = null;
    if (type !== 'infinite') {
        const d = new Date();
        if (type === 'today') date = HistoryService.getLogicalDate();
        else if (type === 'tomorrow') { d.setDate(d.getDate()+1); date = HistoryService.getLogicalDate(d); }
        else if (type === 'week') { d.setDate(d.getDate() + (7 - d.getDay()) % 7); date = HistoryService.getLogicalDate(d); }
        else if (type === 'custom') date = document.getElementById('aimCustomDate').value;
    }

    state.selectedFocusAreaIds.forEach(id => {
        const ex = FocusView.getActiveAimForFocusArea(id);
        if (ex) { ex.targetMinutes = mins; ex.deadline = date; }
        else state.aims.push({ id: Date.now() + '-' + id, focusAreaId: id, targetMinutes: mins, createdAt: new Date().toISOString(), deadline: date });
    });

    state.selectedFocusAreaIds = []; updateCustomSelectUI();
    document.getElementById('planCreateWrapper')?.classList.remove('open');
    renderPlan(); renderFocusAreas(); notify('Aim added'); saveData();
}

function addXP(amt, bonus = false) {
    const { leveledUp, level, oldTotalXp } = FocusService.addXP(amt);
    if (leveledUp) notify(`LEVEL UP! Level ${level}`);
    FocusView.updateLevelUI(oldTotalXp);
}

// --- 4. NAVIGATION & MODALS ---

function openFocusAreas() { document.getElementById('focusAreaPanel').classList.add('open'); document.getElementById('focusAreaOverlay').classList.add('open'); }
function closeFocusAreas() { document.getElementById('focusAreaPanel').classList.remove('open'); document.getElementById('focusAreaOverlay').classList.remove('open'); }

function openPlan() { 
    closeFocusAreas(); populateCustomFocusAreaSelect();
    document.getElementById('planPanel').classList.add('open'); document.getElementById('planOverlay').classList.add('open'); 
}
function closePlan() { document.getElementById('planPanel').classList.remove('open'); document.getElementById('planOverlay').classList.remove('open'); }

function openProfile() { closeFocusAreas(); closePlan(); renderAchievements(); document.getElementById('profilePanel').classList.add('open'); document.getElementById('settingsOverlay').classList.add('open'); }
function closeProfile() { document.getElementById('profilePanel').classList.remove('open'); document.getElementById('settingsOverlay').classList.remove('open'); }

function openSettings() {
    closeFocusAreas(); closePlan();
    const p = document.getElementById('settingsPanel'); const o = document.getElementById('settingsOverlay');
    p.classList.add('open'); o.classList.add('open');
    document.getElementById('workDuration').value = state.settings.workDuration;
    document.getElementById('workDurationValue').textContent = `${state.settings.workDuration} min`;
    document.getElementById('shortBreakDuration').value = state.settings.shortBreakDuration;
    document.getElementById('longBreakDuration').value = state.settings.longBreakDuration;
    
    // Set active variant button
    const variant = state.settings.cardVariant || 'glass';
    document.querySelectorAll('#cardVariantSelect .filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.variant === variant);
    });
}

function closeSettings() {
    const activeVariantBtn = document.querySelector('#cardVariantSelect .filter-btn.active');
    SettingsService.updateSettings({
        workDuration: parseInt(document.getElementById('workDuration').value),
        shortBreakDuration: parseInt(document.getElementById('shortBreakDuration').value),
        longBreakDuration: parseInt(document.getElementById('longBreakDuration').value),
        use12Hour: document.getElementById('timeFormat')?.classList.contains('active'),
        cardVariant: activeVariantBtn ? activeVariantBtn.dataset.variant : 'glass'
    });
    document.getElementById('settingsPanel').classList.remove('open'); document.getElementById('settingsOverlay').classList.remove('open');
    saveData(); refreshUI();
}

function openSessionEditModal(s) {
    editingSessionId = s.id;
    document.getElementById('sessionEditFocusAreaName').textContent = s.taskName;
    document.getElementById('sessionEditDuration').value = Math.round(s.duration / 60);
    document.getElementById('sessionEditModal').classList.add('open');
}

function saveSessionFromModal() {
    const mins = parseInt(document.getElementById('sessionEditDuration').value);
    const s = state.sessions.find(x => x.id === editingSessionId);
    if (s && mins > 0) {
        s.duration = mins * 60; saveData(); refreshUI();
    }
    document.getElementById('sessionEditModal').classList.remove('open');
}

function openFocusAreaEditModal(t) {
    editingTaskId = t.id;
    document.getElementById('focusAreaEditName').value = t.name;
    document.getElementById('focusAreaEditCategory').value = t.category || 'Uncategorized';
    document.getElementById('focusAreaEditModal').classList.add('open');
}

function saveFocusAreaFromModal() {
    const name = document.getElementById('focusAreaEditName').value.trim();
    const t = state.tasks.find(x => x.id === editingTaskId);
    if (t && name) { t.name = name; t.category = document.getElementById('focusAreaEditCategory').value; saveData(); refreshUI(); }
    document.getElementById('focusAreaEditModal').classList.remove('open');
}

// --- 5. PERSISTENCE & SYSTEM ---

function saveData() { dbManager.initialized ? dbManager.saveFullState(state) : localStorage.setItem(STORAGE_KEYS.STATE, JSON.stringify(state)); }
function loadLegacyData() { try { const t = localStorage.getItem(STORAGE_KEYS.TASKS); if (t) state.tasks = JSON.parse(t); } catch(e) {} }
function purgeLocalStorage() { Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k)); }

function updateDateTime() {
    const el = document.getElementById('datetime'); if (!el) return;
    el.textContent = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: state.settings.use12Hour }).replace(',', '');
    const cur = HistoryService.getLogicalDate();
    if (state.lastLogicalDate && state.lastLogicalDate !== cur) { state.lastLogicalDate = cur; refreshUI(); }
    updateRefreshLabel();
}

function updateRefreshLabel() {
    const label = document.getElementById('lastUpdatedLabel');
    if (!label || !state.lastRefreshTime) return;
    const diff = Math.floor((Date.now() - state.lastRefreshTime) / 1000);
    label.textContent = diff < 60 ? 'Updated just now' : `Updated ${Math.floor(diff / 60)}m ago`;
}

function formatTimestamp(date) { return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: state.settings.use12Hour }); }

function checkAchievements() {
    const currentStreak = HistoryService.calculateStreak(state.sessions);
    const tryUnlock = (id, cond) => {
        if (!state.unlockedAchievements.find(ua => ua.id === id) && cond) {
            const ach = ACHIEVEMENTS.find(a => a.id === id);
            state.unlockedAchievements.push({ id, date: new Date().toISOString() });
            notify(`Achievement Unlocked: ${ach.name}! 🏆`);
        }
    };
    tryUnlock('habitual', currentStreak >= 3);
}

function renderAchievements() {
    const grid = document.getElementById('achievementsGrid'); if (!grid) return;
    grid.innerHTML = '';
    ACHIEVEMENTS.forEach(a => {
        const unlocked = state.unlockedAchievements.find(ua => ua.id === a.id);
        const badge = document.createElement('div');
        badge.className = `achievement-badge ${unlocked ? 'unlocked' : 'locked'}`;
        badge.innerHTML = `<div class="badge-icon">${unlocked ? a.icon : '🔒'}</div><div class="badge-name">${a.name}</div>`;
        grid.appendChild(badge);
    });
}

function restoreTimerState() {
    if (state.timerState.isRunning && state.timerState.targetEndTime) {
        const diff = state.timerState.targetEndTime - Date.now();
        if (diff > 0) { state.timerState.remainingTime = Math.ceil(diff / 1000); timer.start(); }
        else { handleSessionComplete(); }
    } else { timer.applyMode(state.timerState.mode); }
    TimerView.updateDisplay();
}

// --- 6. EVENT LISTENERS ---

function setupEventListeners() {
    const clickMap = {
        'startPauseBtn': toggleTimer,
        'resetBtn': resetTimer,
        'skipBtn': () => handleSessionComplete(true),
        'themeToggle': () => SettingsService.toggleTheme(),
        'addFocusAreaBtn': addFocusArea,
        'manualRefreshBtn': () => { state.lastRefreshTime = Date.now(); refreshUI(); },
        'menuBtn': () => document.getElementById('menuDropdown')?.classList.toggle('open'),
        'settingsBtn': openSettings, 'closeSettings': closeSettings,
        'saveSettings': closeSettings,
        'headerAvatar': openProfile, 'closeProfile': closeProfile,
        'focusAreasNavBtn': () => { document.getElementById('menuDropdown')?.classList.remove('open'); openFocusAreas(); },
        'closeFocusAreaPanel': closeFocusAreas,
        'planNavBtn': () => { document.getElementById('menuDropdown')?.classList.remove('open'); openPlan(); },
        'closePlanPanel': closePlan,
        'addAimBtn': addAim,
        'sessionEditSave': saveSessionFromModal, 'sessionEditCancel': () => document.getElementById('sessionEditModal').classList.remove('open'),
        'focusAreaEditSave': saveFocusAreaFromModal, 'focusAreaEditCancel': () => document.getElementById('focusAreaEditModal').classList.remove('open'),
        'shareXBtn': () => SettingsService.handleShare('x', 'intent', {}, notify),
        'shareCopyBtn': () => SettingsService.handleShare('copy', 'intent', {}, notify),
        'focusAreaLink': openFocusAreas, 
        'clearFocusArea': (e) => { e.stopPropagation(); mutations.updateTimer({ activeTaskId: null }); refreshUI(); saveData(); },
        'focusAreaOverlay': closeFocusAreas, 'planOverlay': closePlan
    };

    Object.entries(clickMap).forEach(([id, fn]) => {
        const el = document.getElementById(id);
        if (el) el.onclick = fn;
    });

    document.querySelectorAll('.mode-tab').forEach(tab => {
        tab.onclick = () => { timer.stop(); timer.applyMode(tab.dataset.mode); refreshUI(); saveData(); };
    });

    // Card Variant Selection
    document.querySelectorAll('#cardVariantSelect .filter-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('#cardVariantSelect .filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        };
    });

    // Orbital Ray Action Handlers
    const orbit = document.getElementById('durationOrbit');
    const trigger = document.getElementById('durationToggle');

    if (trigger && orbit) {
        trigger.onclick = (e) => {
            e.stopPropagation();
            orbit.classList.toggle('open');
        };
    }

    // Preset Options (10, 20, 30, 40)
    document.querySelectorAll('.orbiter.option[data-mins]').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            updateActiveDuration(btn.dataset.mins);
            orbit?.classList.remove('open');
        };
    });

    // Granular Adjustments (-/+)
    document.getElementById('incDuration')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = state.timerState.mode === 'work' ? 'workDuration' : (state.timerState.mode === 'shortBreak' ? 'shortBreakDuration' : 'longBreakDuration');
        updateActiveDuration(state.settings[key] + 1, false);
    });

    document.getElementById('decDuration')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = state.timerState.mode === 'work' ? 'workDuration' : (state.timerState.mode === 'shortBreak' ? 'shortBreakDuration' : 'longBreakDuration');
        updateActiveDuration(Math.max(1, state.settings[key] - 1), false);
    });

    // Global click handler for specialized UI (Menu, Expand Groups, Closing Orbit)
    document.addEventListener('click', (e) => {
        // 1. Menu Dropdown
        const menu = document.getElementById('menuDropdown');
        const menuBtn = document.getElementById('menuBtn');
        if (menu?.classList.contains('open') && !menuBtn?.contains(e.target) && !menu?.contains(e.target)) {
            menu.classList.remove('open');
        }

        // 2. Expand Groups (Share menus, etc)
        const openGroups = document.querySelectorAll('.expand-group.open');
        const trigger = e.target.closest('.expand-trigger');
        if (trigger) {
            const group = trigger.closest('.expand-group');
            if (group) {
                e.stopPropagation();
                openGroups.forEach(g => { if (g !== group) g.classList.remove('open'); });
                group.classList.toggle('open');
                return;
            }
        }
        if (openGroups.length > 0 && !e.target.closest('.expand-group')) {
            openGroups.forEach(g => g.classList.remove('open'));
        }

        // 3. Auto-close Duration Orbit on outside click
        const orbitEl = document.getElementById('durationOrbit');
        if (orbitEl?.classList.contains('open') && !orbitEl.contains(e.target)) {
            orbitEl.classList.remove('open');
        }
    });
}

function notify(msg) { const t = document.getElementById('toast'); if (t) { t.innerHTML = `<div class="toast-content">${msg}</div>`; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000); } }

function confirmAction(msg) {
    document.getElementById('confirmMessage').textContent = msg;
    document.getElementById('confirmModal').classList.add('open');
    return new Promise(res => {
        document.getElementById('confirmOk').onclick = () => { document.getElementById('confirmModal').classList.remove('open'); res(true); };
        document.getElementById('confirmCancel').onclick = () => { document.getElementById('confirmModal').classList.remove('open'); res(false); };
    });
}

function populateCustomFocusAreaSelect() {
    const container = document.getElementById('selectOptions'); if (!container) return;
    container.innerHTML = '';
    state.tasks.filter(t => !t.completed).forEach(t => {
        const opt = document.createElement('div');
        opt.className = `select-option ${state.selectedFocusAreaIds.includes(t.id) ? 'selected' : ''}`;
        opt.innerHTML = `<div class="option-color" style="background: ${t.color}"></div><div class="option-name">${t.name}</div>`;
        opt.onclick = () => {
            const idx = state.selectedFocusAreaIds.indexOf(t.id);
            idx > -1 ? state.selectedFocusAreaIds.splice(idx, 1) : state.selectedFocusAreaIds.push(t.id);
            updateCustomSelectUI(); populateCustomFocusAreaSelect();
        };
        container.appendChild(opt);
    });
}

function updateCustomSelectUI() {
    const badge = document.getElementById('selectedCountBadge'); if (!badge) return;
    badge.textContent = state.selectedFocusAreaIds.length;
    badge.style.display = state.selectedFocusAreaIds.length > 0 ? 'inline-block' : 'none';
}

function goAgain(a) { openPlan(); state.selectedFocusAreaIds = [a.focusAreaId]; updateCustomSelectUI(); document.getElementById('aimDurationInput').value = a.targetMinutes; }
function editAim(id) {
    const a = state.aims.find(x => x.id === id); if (!a) return;
    const val = prompt('Minutes:', a.targetMinutes);
    if (val) { a.targetMinutes = FocusView.parseDuration(val); saveData(); renderPlan(); }
}

(async () => { await init(); })();
