/**
 * PomoFlow App Controller (The Glue Layer)
 * This file coordinates Domain Services and UI Views.
 */

import { state, mutations, CURRENT_VERSION, DEFAULT_FOCUS_AREAS, ACHIEVEMENTS } from './state/store.js';
import { timer } from './engine/timer.js';
import { dbManager } from './db.js';
import { HistoryService } from './services/history.service.js';
import { FocusService } from './services/focus.service.js';
import { TimerService } from './services/timer.service.js';
import { SettingsService } from './services/settings.service.js';
import { uuidv7 } from './utils/uuid.js';
import { FocusView } from './ui/focus.view.js';
import { TimerView } from './ui/timer.view.js';
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
        if (fullState) {
            if (fullState.tasks?.length > 0) state.tasks = fullState.tasks;
            if (fullState.sessions?.length > 0) state.sessions = fullState.sessions;
            if (fullState.aims?.length > 0) state.aims = fullState.aims;
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
    }

    if (state.tasks.length === 0) {
        const now = new Date().toISOString();
        state.tasks = DEFAULT_FOCUS_AREAS.map((t, index) => ({
            id: uuidv7(),
            name: t.name, category: t.category, color: t.color,
            completed: false, 
            createdAt: now, created_at: now, updated_at: now,
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
        onDeleteCategory: (name) => deleteCategory(name),
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
        // If timer is at 0:00, it means a session just finished. 
        // Reset to the current mode's duration before starting.
        if (state.timerState.remainingTime <= 0) {
            timer.applyMode(state.timerState.mode);
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
    // Stop any active timer worker first to prevent race conditions or overwriting state
    timer.stop();

    const activeTask = state.tasks.find(t => t.id === state.timerState.activeTaskId);
    const finishTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: state.settings.use12Hour });
    
    // Save session BEFORE updating timer state to 0:00 to ensure we catch the actual time spent
    if (state.timerState.mode === 'work' && !isSkip) {
        saveSession();
        checkAchievements();
    }

    const { wasWork, nextMode, sessionCount, cycleStation } = TimerService.handleSessionEnd(isSkip);
    
    mutations.updateTimer({
        mode: nextMode,
        sessionCount,
        cycleStation,
        isRunning: false,
        remainingTime: isSkip ? TimerService.getModeDuration(nextMode) * 60 : 0, 
        lastSessionFinishedAt: !isSkip ? finishTime : null,
        lastSessionTaskName: !isSkip && wasWork ? (activeTask ? activeTask.name : 'Focus Area') : null
    });

    if (!isSkip) {
        const title = wasWork ? 'Focus Session Finished!' : 'Break Finished!';
        const body = wasWork ? 'Time for a break!' : 'Ready to focus?';
        SettingsService.sendNotification(title, body);
    }
    
    refreshUI();
    saveData();
}

function saveSession() {
    const activeTask = state.tasks.find(t => t.id === state.timerState.activeTaskId);
    
    // Use actual time elapsed
    const duration = state.timerState.totalTime - Math.max(0, state.timerState.remainingTime);
    if (duration <= 0) return; // Don't save empty sessions

    const now = new Date().toISOString();
    const session = {
        id: uuidv7(),
        taskId: activeTask ? activeTask.id : null,
        taskName: activeTask ? activeTask.name : 'Uncategorized Session',
        taskCategory: activeTask ? activeTask.category : 'Uncategorized',
        taskColor: activeTask ? activeTask.color : '#94a3b8', // Slate-400 for uncategorized
        duration: duration,
        timestamp: now,
        created_at: now,
        updated_at: now,
        xp: Math.floor(duration / 60)
    };

    state.sessions.unshift(session);
    FocusService.addXP(session.xp);
    
    if (dbManager.initialized) {
        dbManager.insertSession(session).catch(e => console.error('Failed to save session:', e));
    }
    
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
        onDeleteCategory: (name) => deleteCategory(name),
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
        btn.innerHTML = `<svg class="spinner" width="14" height="14" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"><path d="M216,128a88,88,0,1,1-42.69-75.69"></path></svg><span>${actionText}</span>`;

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
                state.categories.push({ id: uuidv7(), name: newName, icon: newIcon });
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
                task.updated_at = new Date().toISOString();
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
        const now = new Date().toISOString();
        t.completed = !isComp;
        t.updated_at = now;
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
            if (dbManager.initialized) dbManager.deleteSession(id);
            saveData(); refreshUI();
            notify('Session deleted 🗑️');
        }
    });
}

function renderPlan() {
    FocusView.renderPlan({
        onEditAim: (id) => editAim(id),
        onGoAgain: (a) => goAgain(a),
        onDeleteAim: (id) => { 
            state.aims = state.aims.filter(x => x.id !== id); 
            if (dbManager.initialized) dbManager.deleteAim(id);
            saveData(); renderPlan(); notify('Aim removed 🗑️'); 
        },
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

    const now = new Date().toISOString();
    state.selectedFocusAreaIds.forEach(id => {
        const ex = FocusView.getActiveAimForFocusArea(id);
        if (ex) { 
            ex.targetMinutes = mins; 
            ex.deadline = date; 
            ex.updated_at = now;
            if (dbManager.initialized) dbManager.insertAim(ex).catch(e => console.error('Failed to save aim:', e));
        } else {
            const newAim = { 
                id: uuidv7(), 
                focusAreaId: id, 
                targetMinutes: mins, 
                createdAt: now, 
                created_at: now,
                updated_at: now,
                deadline: date 
            };
            state.aims.push(newAim);
            if (dbManager.initialized) dbManager.insertAim(newAim).catch(e => console.error('Failed to save aim:', e));
        }
    });

    state.selectedFocusAreaIds = []; 
    updateCustomSelectUI();
    const wrapper = document.getElementById('planCreateWrapper');
    if (wrapper) {
        wrapper.classList.remove('open');
        const btn = document.getElementById('togglePlanCreate');
        if (btn) btn.classList.remove('active');
    }
    renderPlan(); renderFocusAreas(); notify('Aim added 🎯'); saveData();
}

function editAim(id) {
    const aim = state.aims.find(a => a.id === id);
    if (!aim) return;
    
    state.selectedFocusAreaIds = [aim.focusAreaId];
    updateCustomSelectUI();
    
    document.getElementById('aimDurationInput').value = aim.targetMinutes;
    if (aim.deadline) {
        document.getElementById('aimDeadlineSelect').value = 'custom';
        const customDateInput = document.getElementById('aimCustomDate');
        if (customDateInput) {
            customDateInput.value = aim.deadline;
            customDateInput.style.display = 'block';
        }
    } else {
        document.getElementById('aimDeadlineSelect').value = 'infinite';
    }
    
    const wrapper = document.getElementById('planCreateWrapper');
    if (wrapper) {
        wrapper.classList.add('open');
        document.getElementById('togglePlanCreate')?.classList.add('active');
    }
}

function goAgain(aim) {
    const now = new Date().toISOString();
    const newAim = {
        ...aim,
        id: uuidv7(),
        createdAt: now,
        created_at: now,
        updated_at: now
    };
    state.aims.push(newAim);
    saveData();
    renderPlan();
    notify('Aim renewed! 🎯');
}

function populateCustomFocusAreaSelect() {
    const container = document.getElementById('selectOptions');
    const noResults = document.getElementById('selectNoResults');
    if (!container) return;
    
    container.innerHTML = '';
    const activeTasks = state.tasks.filter(t => !t.completed);
    
    if (activeTasks.length === 0) {
        noResults.style.display = 'block';
        return;
    }
    
    noResults.style.display = 'none';
    activeTasks.forEach(task => {
        const item = document.createElement('div');
        item.className = 'select-option';
        if (state.selectedFocusAreaIds.includes(task.id)) item.classList.add('selected');
        
        item.innerHTML = `
            <div class="option-color" style="background: ${task.color}"></div>
            <div class="option-info">
                <div class="option-name">${task.name}</div>
                <div class="option-meta">${task.category || 'Uncategorized'}</div>
            </div>
            <div class="option-check">
                <svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L104,194.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"></path></svg>
            </div>
        `;
        
        item.onclick = () => {
            const idx = state.selectedFocusAreaIds.indexOf(task.id);
            if (idx === -1) state.selectedFocusAreaIds.push(task.id);
            else state.selectedFocusAreaIds.splice(idx, 1);
            
            item.classList.toggle('selected');
            updateCustomSelectUI();
            
            // Auto-close on selection to avoid covering the form
            document.getElementById('selectDropdown')?.classList.remove('open');
        };
        
        container.appendChild(item);
    });
}

function updateCustomSelectUI() {
    const badge = document.getElementById('selectedCountBadge');
    const count = state.selectedFocusAreaIds.length;
    
    if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'flex' : 'none';
    }
    
    const triggerText = document.querySelector('#selectTrigger span:not(.selected-count-badge)');
    if (triggerText) {
        if (count === 0) triggerText.textContent = 'Select Focus Areas...';
        else if (count === 1) {
            const task = state.tasks.find(t => t.id === state.selectedFocusAreaIds[0]);
            triggerText.textContent = task ? task.name : '1 Area Selected';
        } else {
            triggerText.textContent = `${count} Areas Selected`;
        }
    }
}

// --- 4. NAVIGATION & MODALS ---

function openFocusAreas() { 
    FocusView.goBack();
    document.getElementById('focusAreaPanel').classList.add('open'); 
    document.getElementById('focusAreaOverlay').classList.add('open'); 
}
function closeFocusAreas() { 
    document.getElementById('focusAreaPanel').classList.remove('open'); 
    document.getElementById('focusAreaOverlay').classList.remove('open');
    document.getElementById('focusAreaCreateWrapper')?.classList.remove('open');
    document.getElementById('toggleFocusAreaCreate')?.classList.remove('active');
}

function openPlan() { 
    closeFocusAreas(); populateCustomFocusAreaSelect();
    document.getElementById('planPanel').classList.add('open'); document.getElementById('planOverlay').classList.add('open'); 
}
function closePlan() { 
    document.getElementById('planPanel').classList.remove('open'); 
    document.getElementById('planOverlay').classList.remove('open'); 
    document.getElementById('planCreateWrapper')?.classList.remove('open');
    document.getElementById('togglePlanCreate')?.classList.remove('active');
}

function openProfile() { closeFocusAreas(); closePlan(); renderAchievements(); document.getElementById('profilePanel').classList.add('open'); document.getElementById('settingsOverlay').classList.add('open'); }
function closeProfile() { 
    document.getElementById('profilePanel').classList.remove('open'); 
    document.getElementById('settingsOverlay').classList.remove('open'); 
    togglePersonaEdit(false);
}

function togglePersonaEdit(isEditing) {
    const slider = document.getElementById('identitySlider');
    slider?.classList.toggle('editing', isEditing);
}

function updatePersona(avatar, mood) {
    state.avatar = avatar;
    updateProfileUI();
    togglePersonaEdit(false);
    saveData();
    notify(`Persona changed to ${mood} ${avatar} ✨`);
}

function updateProfileUI() {
    const avatar = state.avatar || '🦉';
    const circle = document.getElementById('personaCircle');
    const headerAvatar = document.getElementById('headerAvatar');
    const moodLabel = document.getElementById('currentMoodLabel');
    
    if (circle) circle.textContent = avatar;
    if (headerAvatar) headerAvatar.textContent = avatar;
    
    const option = document.querySelector(`.avatar-option[data-avatar="${avatar}"]`);
    if (option && moodLabel) {
        moodLabel.textContent = option.querySelector('.avatar-mood')?.textContent || option.title;
    }
}

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

function toggleOrbit() {
    const orbit = document.getElementById('durationOrbit');
    const container = orbit?.closest('.timer-container');
    if (orbit) {
        const isOpen = orbit.classList.toggle('open');
        container?.classList.toggle('orbit-open', isOpen);
    }
}

function closeOrbit() {
    const orbit = document.getElementById('durationOrbit');
    const container = orbit?.closest('.timer-container');
    orbit?.classList.remove('open');
    container?.classList.remove('orbit-open');
}

function setDurationFromOrbit(mins) {
    const mode = state.timerState.mode;
    const wasRunning = state.timerState.isRunning;
    const oldTotal = state.timerState.totalTime;
    const newTotal = mins * 60;
    const diff = newTotal - oldTotal;

    // Update settings for future sessions
    if (mode === 'work') mutations.updateSettings({ workDuration: mins });
    else if (mode === 'shortBreak') mutations.updateSettings({ shortBreakDuration: mins });
    else mutations.updateSettings({ longBreakDuration: mins });
    
    // Adjust current session without losing progress
    const newRemaining = Math.max(0, state.timerState.remainingTime + diff);
    mutations.updateTimer({ 
        totalTime: newTotal,
        remainingTime: newRemaining
    });

    // Recalculate background worker target if running
    if (wasRunning) timer.start();
    
    saveData();
    refreshUI();
}

function adjustDuration(delta) {
    const mode = state.timerState.mode;
    const wasRunning = state.timerState.isRunning;
    const oldTotal = state.timerState.totalTime;
    let current;
    
    if (mode === 'work') current = state.settings.workDuration;
    else if (mode === 'shortBreak') current = state.settings.shortBreakDuration;
    else current = state.settings.longBreakDuration;

    const next = Math.max(1, current + delta);
    const newTotal = next * 60;
    const diff = newTotal - oldTotal;

    if (mode === 'work') mutations.updateSettings({ workDuration: next });
    else if (mode === 'shortBreak') mutations.updateSettings({ shortBreakDuration: next });
    else mutations.updateSettings({ longBreakDuration: next });
    
    // Adjust current session without losing progress
    const newRemaining = Math.max(0, state.timerState.remainingTime + diff);
    mutations.updateTimer({ 
        totalTime: newTotal,
        remainingTime: newRemaining
    });

    if (wasRunning) timer.start();
    
    saveData();
    refreshUI();
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
    
    // Go back to the first drawer where the creation form is
    FocusView.goBack();
    
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

function deleteCategory(name) {
    confirmAction(`Delete category "${name}"? Focus areas will be moved to Uncategorized.`).then(conf => {
        if (conf) {
            state.categories = state.categories.filter(c => c.name !== name);
            state.tasks.forEach(t => {
                if (t.category === name) t.category = 'Uncategorized';
            });
            saveData();
            refreshUI();
            FocusView.populateCategorySelects();
            notify(`Category "${name}" deleted 🗑️`);
        }
    });
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
    }
}

function updateDateTime() {
    const el = document.getElementById('datetime'); if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: state.settings.use12Hour });
}

function notify(msg, type = '') {
    const toast = document.createElement('div');
    toast.className = `toast show ${type}`;
    
    toast.innerHTML = `
        <div class="toast-content">${msg}</div>
        <div class="toast-progress-container">
            <div class="toast-progress"></div>
        </div>
    `;
    
    document.body.appendChild(toast);
    
    // Auto-remove after 5s (matching animation)
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 5000);
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
                btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L104,194.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"></path></svg>';
            } else {
                btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM192,108,148,64l24-24,44,44Zm-101,96H48V160l88-88,44,44Z"></path></svg>';
            }
            refreshUI();
        },
        'inlineColorBtn': () => document.getElementById('inlineColorDropdown')?.classList.toggle('open'),
        'inlineIconBtn': () => document.getElementById('inlineIconDropdown')?.classList.toggle('open'),
        'selectTrigger': () => document.getElementById('selectDropdown')?.classList.toggle('open'),
        'manualRefreshBtn': () => { state.lastRefreshTime = Date.now(); refreshUI(); },
        'menuBtn': () => document.getElementById('menuDropdown')?.classList.toggle('open'),
        'settingsBtn': openSettings, 'closeSettings': closeSettings,
        'saveSettings': closeSettings,
        'headerAvatar': openProfile, 'closeProfile': closeProfile,
        'editPersonaBtn': () => togglePersonaEdit(true),
        'cancelPersonaEdit': () => togglePersonaEdit(false),
        'shareMoodBtn': () => {
            const avatar = state.avatar || '🦉';
            const mood = document.getElementById('currentMoodLabel')?.textContent || 'Sage';
            SettingsService.handleShare('x', 'mood', { avatar, mood }, notify);
        },
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
            const wrapper = document.getElementById('planCreateWrapper');
            const isOpen = wrapper?.classList.toggle('open');
            const btn = document.getElementById('togglePlanCreate');
            if (btn) btn.classList.toggle('active', isOpen);
            if (isOpen) {
                // Reset form when opening
                state.selectedFocusAreaIds = [];
                updateCustomSelectUI();
                document.getElementById('aimDurationInput').value = '';
                document.getElementById('aimDeadlineSelect').value = 'infinite';
                const customDate = document.getElementById('aimCustomDate');
                if (customDate) customDate.style.display = 'none';
                populateCustomFocusAreaSelect();
            }
        },
        'cancelPlanCreate': () => {
            const wrapper = document.getElementById('planCreateWrapper');
            wrapper?.classList.remove('open');
            const btn = document.getElementById('togglePlanCreate');
            if (btn) btn.classList.remove('active');
            state.selectedFocusAreaIds = [];
            updateCustomSelectUI();
        },
        'categoryEditIconBtn': () => document.getElementById('categoryEditIconDropdown')?.classList.toggle('open'),
        'saveCategoryEdit': saveCategoryFromModal,
        'cancelCategoryEdit': () => document.getElementById('categoryEditModal').classList.remove('open'),
        'closeCategoryEdit': () => document.getElementById('categoryEditModal').classList.remove('open'),
        'saveSessionEdit': saveSessionFromModal, 'cancelSessionEdit': () => document.getElementById('sessionEditModal').classList.remove('open'),
        'shareXBtn': () => SettingsService.handleShare('x', 'intent', {}, notify),
        'shareCopyBtn': () => SettingsService.handleShare('copy', 'intent', {}, notify),
        'shareFocusBtn': () => {
            document.querySelector('.expand-group')?.classList.toggle('open');
        },
        'durationToggle': toggleOrbit,
        'incDuration': () => adjustDuration(1),
        'decDuration': () => adjustDuration(-1),
        'focusAreaLink': openFocusAreas, 
        'clearFocusArea': (e) => { e.stopPropagation(); mutations.updateTimer({ activeTaskId: null }); refreshUI(); saveData(); },
        'focusAreaOverlay': closeFocusAreas, 'planOverlay': closePlan
    };

    Object.entries(clickMap).forEach(([id, fn]) => {
        const el = document.getElementById(id);
        if (el) el.onclick = fn;
    });

    // Orbit option buttons
    document.querySelectorAll('.orbiter.option[data-mins]').forEach(btn => {
        btn.onclick = () => {
            const mins = parseInt(btn.dataset.mins);
            if (mins) setDurationFromOrbit(mins);
            closeOrbit();
        };
    });

    // Avatar selection
    document.querySelectorAll('.avatar-option').forEach(btn => {
        btn.onclick = () => {
            const avatar = btn.dataset.avatar;
            const mood = btn.querySelector('.avatar-mood')?.textContent || btn.title;
            updatePersona(avatar, mood);
        };
    });

    // Global click listener to close dropdowns/menus when clicking outside
    document.addEventListener('click', (e) => {
        // Close share menu
        const shareGroup = document.querySelector('.expand-group');
        if (shareGroup?.classList.contains('open') && !shareGroup.contains(e.target)) {
            shareGroup.classList.remove('open');
        }

        // Close orbit menu
        const orbit = document.getElementById('durationOrbit');
        if (orbit?.classList.contains('open') && !orbit.contains(e.target)) {
            closeOrbit();
        }

        // Close navigation menu
        const menuDropdown = document.getElementById('menuDropdown');
        const menuBtn = document.getElementById('menuBtn');
        if (menuDropdown?.classList.contains('open') && !menuDropdown.contains(e.target) && !menuBtn?.contains(e.target)) {
            menuDropdown.classList.remove('open');
        }

        // Close focus area select dropdown
        const selectDropdown = document.getElementById('selectDropdown');
        const selectTrigger = document.getElementById('selectTrigger');
        if (selectDropdown?.classList.contains('open') && !selectDropdown.contains(e.target) && !selectTrigger?.contains(e.target)) {
            selectDropdown.classList.remove('open');
        }
    });

    document.getElementById('focusAreaCategorySelect')?.addEventListener('change', (e) => {
        const wrapper = document.getElementById('newCategoryWrapper');
        if (wrapper) wrapper.style.display = e.target.value === '__new__' ? 'flex' : 'none';
        if (e.target.value === '__new__') document.getElementById('newCategoryNameInput')?.focus();
    });

    document.getElementById('focusAreaSearchInput')?.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        let visible = 0;
        document.querySelectorAll('#selectOptions .select-option').forEach(opt => {
            const name = opt.querySelector('.option-name').textContent.toLowerCase();
            const cat = opt.querySelector('.option-meta').textContent.toLowerCase();
            const match = name.includes(q) || cat.includes(q);
            opt.style.display = match ? 'flex' : 'none';
            if (match) visible++;
        });
        const noResults = document.getElementById('selectNoResults');
        if (noResults) noResults.style.display = visible === 0 ? 'block' : 'none';
    });

    document.getElementById('aimDeadlineSelect')?.addEventListener('change', (e) => {
        const customDate = document.getElementById('aimCustomDate');
        if (customDate) customDate.style.display = e.target.value === 'custom' ? 'block' : 'none';
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
    DashboardView.updateStats();
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
    updateProfileUI();
}

(async () => { await init(); })();
