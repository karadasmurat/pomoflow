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
                if (fullState.appState.categories) state.categories = fullState.appState.categories;
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
            completed: false, createdAt: new Date().toISOString(),
            totalTime: 0
        }));
        saveData();
    } else {
        const allCompleted = state.tasks.every(t => t.completed);
        if (allCompleted) {
            state.tasks.forEach(t => t.completed = false);
            saveData();
        }
    }

    setupEventListeners();
    FocusView.populateCategorySelects();
    FocusView.init({
        onPlay: (task) => {
            if (state.timerState.activeTaskId === task.id) toggleTimer();
            else { state.timerState.activeTaskId = task.id; timer.stop(); timer.applyMode('work'); timer.start(); }
            refreshUI(); closeFocusAreas();
        },
        onEdit: (task) => openFocusAreaEditModal(task),
        onToggleComplete: (id) => toggleFocusAreaComplete(id),
        onDelete: (id) => deleteFocusArea(id),
        onEditCategory: (name) => openCategoryEditModal(name),
        onMoveToCategory: (taskId, newCat) => moveTaskToCategory(taskId, newCat),
        onStateChange: () => saveData()
    });
    
    timer.init({
        onTick: () => TimerView.updateDisplay(),
        onComplete: handleSessionComplete,
        onSave: saveData
    });

    refreshUI();
    updateDateTime();
    state.lastRefreshTime = Date.now();
    setInterval(updateDateTime, 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') updateDateTime(); });

    restoreTimerState();
    checkAchievements();
}

// --- 2. TIMER LOGIC ---

function toggleTimer() {
    if (state.timerState.isRunning) {
        timer.stop();
    } else {
        if (!state.timerState.activeTaskId && state.timerState.mode === 'work') {
            return notify('Select focus area first 🎯');
        }
        timer.start();
    }
    refreshUI();
}

function resetTimer() {
    timer.stop();
    timer.applyMode(state.timerState.mode);
    refreshUI();
    notify('Timer reset 🔄');
}

function handleSessionComplete(isSkip = false) {
    if (state.timerState.mode === 'work' && !isSkip) {
        saveSession();
        checkAchievements();
    }

    const { wasWork, nextMode, sessionCount, cycleStation } = TimerService.handleSessionEnd(isSkip);
    
    mutations.updateTimer({
        mode: nextMode,
        sessionCount,
        cycleStation,
        isRunning: false
    });

    timer.applyMode(nextMode);
    
    if (!isSkip) {
        const title = wasWork ? 'Focus Session Finished!' : 'Break Finished!';
        const body = wasWork ? 'Time for a break!' : 'Ready to focus?';
        SettingsService.sendNotification(title, body);
        
        if (nextMode === 'work' ? state.settings.autoStartWork : state.settings.autoStartBreaks) {
            setTimeout(() => { if (state.timerState.remainingTime <= 0) timer.applyMode(state.timerState.mode); timer.start(); }, 1500);
        }
    }
    
    refreshUI();
    saveData();
}

function saveSession() {
    const activeTask = state.tasks.find(t => t.id === state.timerState.activeTaskId);
    if (!activeTask) return;

    const duration = state.timerState.totalTime;
    const session = {
        id: Date.now().toString(),
        taskId: activeTask.id,
        taskName: activeTask.name,
        taskColor: activeTask.color,
        duration: duration,
        timestamp: new Date().toISOString(),
        xp: Math.floor(duration / 60)
    };

    state.sessions.unshift(session);
    addXP(session.xp);
    saveData();
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
        onEditCategory: (name) => openCategoryEditModal(name),
        onMoveToCategory: (taskId, newCat) => moveTaskToCategory(taskId, newCat),
        onStateChange: () => saveData()
    });
}

async function addFocusArea() {
    const btn = document.getElementById('addFocusAreaBtn');
    const textSpan = document.getElementById('addFocusAreaBtnText');
    const originalText = textSpan ? textSpan.textContent : 'Create';
    const originalIcon = btn.querySelector('svg')?.outerHTML || '';
    
    try {
        const input = document.getElementById('focusAreaInput');
        const name = input.value.trim();
        if (!name) return notify('Enter focus area name');
        
        btn.disabled = true;
        btn.classList.add('loading');
        const actionText = editingTaskId ? 'Saving...' : 'Creating...';
        btn.innerHTML = `<svg class="spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg><span>${actionText}</span>`;

        const catSelect = document.getElementById('focusAreaCategorySelect');
        let cat = catSelect.value;

        if (cat === '__new__') {
            const newName = document.getElementById('newCategoryNameInput').value.trim();
            const newIcon = document.getElementById('newCategoryIconInput').value.trim() || '📁';
            if (!newName) {
                btn.disabled = false;
                btn.classList.remove('loading');
                btn.innerHTML = `${originalIcon}<span id="addFocusAreaBtnText">${originalText}</span>`;
                return notify('Enter new category name');
            }
            
            if (!state.categories.find(c => c.name.toLowerCase() === newName.toLowerCase())) {
                state.categories.push({ id: Date.now().toString(), name: newName, icon: newIcon });
                FocusView.populateCategorySelects();
            }
            cat = newName;
            
            document.getElementById('newCategoryWrapper').style.display = 'none';
            document.getElementById('newCategoryNameInput').value = '';
            document.getElementById('newCategoryIconInput').value = '📁';
            document.getElementById('selectedIconDisplay').textContent = '📁';
        }
        
        let task;
        const isEdit = !!editingTaskId;
        if (editingTaskId) {
            task = state.tasks.find(t => t.id === editingTaskId);
            if (task) {
                task.name = name;
                task.category = cat;
                task.color = state.selectedTaskColor;
            }
        } else {
            task = FocusService.addFocusArea(name, cat, state.selectedTaskColor);
        }
        
        if (task) {
            input.value = '';
            
            const active = state.tasks.filter(t => !(t.completed === true || t.completed === 1 || t.completed === 'true'));
            const grouped = active.reduce((acc, t) => {
                const c = t.category || 'Uncategorized';
                if (!acc[c]) acc[c] = [];
                acc[c].push(t);
                return acc;
            }, {});
            
            const order = state.categories.map(c => c.name);
            const activeCats = Object.keys(grouped).sort((a, b) => {
                const ia = order.indexOf(a), ib = order.indexOf(b);
                return (ia !== -1 && ib !== -1) ? ia - ib : (ia !== -1 ? -1 : (ib !== -1 ? 1 : a.localeCompare(b)));
            });
            
            state.activeCategoryIndex = activeCats.indexOf(task.category || 'Uncategorized');
            
            await saveData(); 
            
            const wrapper = document.getElementById('focusAreaCreateWrapper');
            wrapper?.classList.remove('open');
            const toggleBtn = document.getElementById('toggleFocusAreaCreate');
            if (toggleBtn) toggleBtn.classList.remove('active');
            
            editingTaskId = null;

            renderFocusAreas(); 
            notify(isEdit ? `Updated: ${name} ✅` : `Added: ${name} ✨`);
        }
    } catch (e) {
        console.error('Failed to add/update focus area:', e);
        notify('Error saving focus area');
    } finally {
        btn.disabled = false;
        btn.classList.remove('loading');
        btn.innerHTML = `${originalIcon}<span id="addFocusAreaBtnText">${originalText}</span>`;
    }
}

function toggleFocusAreaComplete(id) {
    const t = state.tasks.find(x => x.id === id);
    if (t) {
        const isComp = (t.completed === true || t.completed === 1 || t.completed === 'true');
        t.completed = !isComp;
        if (t.completed && state.timerState.activeTaskId === id) state.timerState.activeTaskId = null;
        saveData(); renderFocusAreas();
        notify(t.completed ? 'Focus area completed! ✅' : 'Focus area reactivated 🔄');
    }
}

function deleteFocusArea(id) {
    confirmAction('Delete focus area?').then(conf => {
        if (conf) { 
            const t = state.tasks.find(x => x.id === id);
            const name = t ? t.name : '';
            FocusService.deleteFocusArea(id); 
            if (dbManager.initialized) dbManager.deleteFocusArea(id);
            saveData(); renderFocusAreas(); 
            notify(`Deleted: ${name} 🗑️`);
        }
    });
}

function deleteSession(id) {
    confirmAction('Delete session record?').then(conf => {
        if (conf) {
            state.sessions = state.sessions.filter(s => s.id !== id);
            saveData(); refreshUI();
            notify('Session deleted 🗑️');
        }
    });
}

function renderPlan() {
    FocusView.renderPlan({
        onEditAim: (id) => editAim(id),
        onGoAgain: (a) => goAgain(a),
        onDeleteAim: (id) => { state.aims = state.aims.filter(x => x.id !== id); saveData(); renderPlan(); notify('Aim removed 🗑️'); },
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
    renderPlan(); renderFocusAreas(); notify('Aim added 🎯'); saveData();
}

function addXP(amt, bonus = false) {
    const { leveledUp, level, oldTotalXp } = FocusService.addXP(amt);
    if (leveledUp) notify(`LEVEL UP! Level ${level} 🎉`);
    FocusView.updateLevelUI(oldTotalXp);
}

// --- 4. NAVIGATION & MODALS ---

function openFocusAreas() { 
    FocusView.goBack();
    document.getElementById('focusAreaPanel').classList.add('open'); 
    document.getElementById('focusAreaOverlay').classList.add('open'); 
}
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
    notify('Settings saved ⚙️');
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
        notify('Session updated ✅');
    }
    document.getElementById('sessionEditModal').classList.remove('open');
}

function openFocusAreaEditModal(t) {
    editingTaskId = t.id;
    
    document.getElementById('focusAreaInput').value = t.name;
    FocusView.populateCategorySelects();
    document.getElementById('focusAreaCategorySelect').value = t.category || 'Uncategorized';
    
    state.selectedTaskColor = t.color || '#58a6ff';
    const circle = document.getElementById('selectedColorCircle');
    if (circle) circle.style.background = state.selectedTaskColor;
    
    const header = document.getElementById('faCreateHeader');
    if (header) header.textContent = 'Edit Focus Area';
    const btnText = document.getElementById('addFocusAreaBtnText');
    if (btnText) btnText.textContent = 'Update';
    
    const wrapper = document.getElementById('focusAreaCreateWrapper');
    if (wrapper) {
        wrapper.classList.add('open');
        const toggleBtn = document.getElementById('toggleFocusAreaCreate');
        if (toggleBtn) toggleBtn.classList.add('active');
        document.getElementById('focusAreaInput')?.focus();
    }
}

let editingCategoryName = null;
function openCategoryEditModal(name) {
    editingCategoryName = name;
    const cat = state.categories.find(c => c.name === name);
    if (!cat) return;

    document.getElementById('categoryEditName').value = cat.name;
    document.getElementById('categoryEditIconDisplay').textContent = cat.icon;
    document.getElementById('categoryEditIconInput').value = cat.icon;
    
    const dropdown = document.getElementById('categoryEditIconDropdown');
    const icons = ["🎓", "💼", "💪", "🏠", "🎨", "🧪", "📚", "🚀", "🧠", "🎯", "💻", "📈", "🔧", "🧹", "🛒"];
    if (dropdown) {
        dropdown.innerHTML = icons.map(i => `<button type="button" class="icon-dot" data-icon="${i}">${i}</button>`).join('');

        dropdown.querySelectorAll('.icon-dot').forEach(btn => {
            btn.onclick = () => {
                const icon = btn.dataset.icon;
                document.getElementById('categoryEditIconDisplay').textContent = icon;
                document.getElementById('categoryEditIconInput').value = icon;
                dropdown.classList.remove('open');
            };
        });
    }
    document.getElementById('categoryEditModal').classList.add('open');
}

function saveCategoryFromModal() {
    const newName = document.getElementById('categoryEditName').value.trim();
    const newIcon = document.getElementById('categoryEditIconInput').value;
    if (!newName) return notify('Category name cannot be empty');

    const cat = state.categories.find(c => c.name === editingCategoryName);
    if (cat) {
        state.tasks.forEach(t => {
            if (t.category === editingCategoryName) t.category = newName;
        });
        cat.name = newName;
        cat.icon = newIcon;

        saveData();
        refreshUI();
        FocusView.populateCategorySelects();
        notify(`Category updated: ${newName} ✅`);
    }
    document.getElementById('categoryEditModal').classList.remove('open');
}

function moveTaskToCategory(taskId, newCat) {
    const t = state.tasks.find(x => x.id === taskId);
    if (t) {
        t.category = newCat;
        saveData();
        refreshUI();
        notify(`Moved to ${newCat} 📦`);
    }
}

// --- 5. PERSISTENCE & SYSTEM ---

function saveData() { 
    if (dbManager.initialized) {
        dbManager.saveFullState(state).catch(e => console.error('Failed to save to DB:', e));
    } else {
        localStorage.setItem(STORAGE_KEYS.STATE, JSON.stringify(state));
    }
}
function loadLegacyData() { try { const t = localStorage.getItem(STORAGE_KEYS.TASKS); if (t) state.tasks = JSON.parse(t); } catch(e) {} }
function purgeLocalStorage() { Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k)); }

function updateDateTime() {
    const el = document.getElementById('datetime'); if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: state.settings.use12Hour });
}

function notify(msg) {
    const toast = document.createElement('div');
    toast.className = 'toast show';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
}

function confirmAction(msg) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        const messageEl = document.getElementById('confirmMessage');
        const okBtn = document.getElementById('confirmOk');
        const cancelBtn = document.getElementById('confirmCancel');
        
        if (!modal || !messageEl || !okBtn || !cancelBtn) {
            resolve(confirm(msg));
            return;
        }

        messageEl.textContent = msg;
        modal.classList.add('open');

        const cleanup = (val) => {
            modal.classList.remove('open');
            okBtn.onclick = null;
            cancelBtn.onclick = null;
            resolve(val);
        };

        okBtn.onclick = () => cleanup(true);
        cancelBtn.onclick = () => cleanup(false);
        
        modal.onclick = (e) => {
            if (e.target === modal) cleanup(false);
        };
    });
}

function formatTimestamp(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function checkAchievements() {
    ACHIEVEMENTS.forEach(ach => {
        if (state.unlockedAchievements.includes(ach.id)) return;
        if (ach.check(state)) {
            state.unlockedAchievements.push(ach.id);
            notify(`ACHIEVEMENT: ${ach.title} 🏆`);
            saveData();
        }
    });
}

function renderAchievements() {
    const grid = document.getElementById('achievementsGrid');
    if (!grid) return;
    grid.innerHTML = '';
    
    ACHIEVEMENTS.forEach(ach => {
        const isUnlocked = state.unlockedAchievements.includes(ach.id);
        const badge = document.createElement('div');
        badge.className = `achievement-badge ${isUnlocked ? 'unlocked' : 'locked'}`;
        badge.innerHTML = `
            <div class="ach-icon">${isUnlocked ? ach.icon : '🔒'}</div>
            <div class="ach-info">
                <div class="ach-title">${ach.title}</div>
                <div class="ach-desc">${ach.desc}</div>
            </div>
        `;
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
        'toggleTaskPanelManagement': (e) => {
            const panel = document.getElementById('faTaskPanel');
            const isManagement = panel?.classList.toggle('management-mode');
            const btn = e.currentTarget;
            btn.classList.toggle('active', isManagement);
            
            if (isManagement) {
                btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
            } else {
                btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/></svg>';
            }
            refreshUI();
        },
        'inlineColorBtn': () => document.getElementById('inlineColorDropdown')?.classList.toggle('open'),
        'inlineIconBtn': () => document.getElementById('inlineIconDropdown')?.classList.toggle('open'),
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
        'toggleFocusAreaCreate': (e) => {
            const wrapper = document.getElementById('focusAreaCreateWrapper');
            const isOpen = wrapper?.classList.toggle('open');
            const btn = document.getElementById('toggleFocusAreaCreate');
            if (btn) btn.classList.toggle('active', isOpen);
            if (isOpen) {
                editingTaskId = null;
                const header = document.getElementById('faCreateHeader');
                if (header) header.textContent = 'Create Focus Area';
                const btnText = document.getElementById('addFocusAreaBtnText');
                if (btnText) btnText.textContent = 'Create';
                document.getElementById('focusAreaInput').value = '';
                
                FocusView.populateCategorySelects();
                document.getElementById('focusAreaInput')?.focus();
            }
        },
        'cancelFocusAreaCreate': () => {
            const wrapper = document.getElementById('focusAreaCreateWrapper');
            wrapper?.classList.remove('open');
            const btn = document.getElementById('toggleFocusAreaCreate');
            if (btn) btn.classList.remove('active');
            editingTaskId = null;
        },
        'togglePlanCreate': (e) => {
            const isOpen = document.getElementById('planCreateWrapper')?.classList.toggle('open');
            e.currentTarget.classList.toggle('active', isOpen);
        },
        'categoryEditIconBtn': () => document.getElementById('categoryEditIconDropdown')?.classList.toggle('open'),
        'saveCategoryEdit': saveCategoryFromModal,
        'cancelCategoryEdit': () => document.getElementById('categoryEditModal').classList.remove('open'),
        'closeCategoryEdit': () => document.getElementById('categoryEditModal').classList.remove('open'),
        'saveSessionEdit': saveSessionFromModal, 'cancelSessionEdit': () => document.getElementById('sessionEditModal').classList.remove('open'),
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

    document.getElementById('focusAreaCategorySelect')?.addEventListener('change', (e) => {
        const wrapper = document.getElementById('newCategoryWrapper');
        if (wrapper) wrapper.style.display = e.target.value === '__new__' ? 'flex' : 'none';
        if (e.target.value === '__new__') document.getElementById('newCategoryNameInput')?.focus();
    });

    document.querySelectorAll('#inlineIconDropdown .icon-dot').forEach(dot => {
        dot.onclick = (e) => {
            e.stopPropagation();
            const icon = dot.dataset.icon;
            const display = document.getElementById('selectedIconDisplay');
            const hidden = document.getElementById('newCategoryIconInput');
            if (display) display.textContent = icon;
            if (hidden) hidden.value = icon;
            document.getElementById('inlineIconDropdown')?.classList.remove('open');
        };
    });

    document.querySelectorAll('#inlineColorDropdown .color-dot').forEach(dot => {
        dot.onclick = (e) => {
            e.stopPropagation();
            const color = dot.dataset.color;
            state.selectedTaskColor = color;
            const circle = document.getElementById('selectedColorCircle');
            if (circle) circle.style.background = color;
            document.querySelectorAll('#inlineColorDropdown .color-dot').forEach(d => d.classList.remove('active'));
            dot.classList.add('active');
            document.getElementById('inlineColorDropdown')?.classList.remove('open');
        };
    });
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
    TimerView.updateDisplay();
    FocusView.updateLevelUI();
}

(async () => { await init(); })();
