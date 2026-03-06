import { state, mutations, STORAGE_KEYS, CURRENT_VERSION, DEFAULT_FOCUS_AREAS, ACHIEVEMENTS } from './state/store.js';
import { timer } from './engine/timer.js';

let editingSessionId = null;
let editingTaskId = null;

// Forward declarations for functions that will be moved later or are currently hoisting-dependent
// In module mode, functions are not hoisted to window automatically.
// We'll keep them here for now but accessing them might require window.* assignment if HTML uses inline onclick.

function toggleTimer() {
    if (state.timerState.isRunning) {
        pauseTimer();
    } else {
        startTimer();
    }
}

function startTimer() {
    // Clear any messages when starting
    const msgEl = document.getElementById('timerMessage');
    if (msgEl) {
        msgEl.innerHTML = '';
        const display = document.querySelector('.timer-display');
        if (display) display.classList.remove('has-message');
    }

    // If we are at 0:00, it means we are transitioning modes
    if (state.timerState.remainingTime <= 0) {
        timer.applyMode(state.timerState.mode);
    }

    timer.start();
}

function pauseTimer() {
    timer.stop();
}

function resetTimer() {
    timer.reset();
}

function applyMode(mode) {
    timer.applyMode(mode);
}

function switchMode(mode) {
    timer.stop();
    timer.applyMode(mode);
}
function purgeLocalStorage() {
    // Completely clear all PomoFlow related keys from localStorage
    Object.keys(localStorage).forEach(key => {
        // Keep the migration flag so we don't accidentally try to migrate from empty storage
        if (key.startsWith('flowtracker_') && key !== 'flowtracker_sqlite_migrated') {
            localStorage.removeItem(key);
        }
    });
    console.log('localStorage purged of flowtracker keys (except migration flag).');
}

let currentFilter = 'today';
let showAllHistory = false;
let savePending = false;

async function init() {
    console.log('Cross-Origin Isolated:', self.crossOriginIsolated ? '✅ YES' : '❌ NO (OPFS will fail)');
    
    // 1. Initialize SQLite Database
    try {
        await dbManager.init();
    } catch (e) {
        console.error('SQLite initialization failed:', e);
    }

    if (dbManager.initialized) {
        const fullState = await dbManager.getFullState();
        
        // 2. Check if we need a final migration
        const needsMigration = !fullState.appState || !fullState.appState.migrated;
        
        if (needsMigration) {
            // Load what we have in localStorage currently
            loadData(); 
            // Migrate it all to SQLite
            await dbManager.migrateFromLocalStorage(state);
            // PURGE localStorage completely as requested
            purgeLocalStorage();
        } else {
            // 3. Regular Load from SQLite
            if (fullState.tasks.length > 0) state.tasks = fullState.tasks;
            if (fullState.sessions.length > 0) state.sessions = fullState.sessions;
            if (fullState.aims.length > 0) state.aims = fullState.aims;
            if (fullState.settings) state.settings = { ...state.settings, ...fullState.settings };
            
            // Load Profile
            if (fullState.profile && fullState.profile.full_profile) {
                const p = fullState.profile.full_profile;
                state.xp = p.xp || 0;
                state.totalXp = p.totalXp || 0;
                state.level = p.level || 1;
                state.avatar = p.avatar || '🦉';
                state.unlockedAchievements = p.unlockedAchievements || [];
                state.collapsedCategories = p.collapsedCategories || [];
                state.activeCategoryIndex = p.activeCategoryIndex || 0;
            }
            
            // Load App State (Theme, Timer, UI)
            if (fullState.appState) {
                if (fullState.appState.timer_state) {
                    state.timerState = { ...state.timerState, ...fullState.appState.timer_state };
                }
                if (fullState.appState.theme) {
                    document.documentElement.setAttribute('data-theme', fullState.appState.theme);
                }
                if (fullState.appState.notification_prompt) {
                    state.notificationPermission = fullState.appState.notification_prompt;
                }
                if (fullState.appState.ui_state) {
                    const ui = fullState.appState.ui_state;
                    state.lastSessionId = ui.lastSessionId;
                    state.lastTaskId = ui.lastTaskId;
                    state.selectedTaskColor = ui.selectedTaskColor || '#58a6ff';
                    state.editTaskColor = ui.editTaskColor || '#58a6ff';
                    state.selectedFocusAreaIds = ui.selectedFocusAreaIds || [];
                }
            }
        }
    } else {
        // Fallback to localStorage ONLY if SQLite is disabled/failed
        loadData();
    }

    // Initialize UI defaults if everything was empty
    if (state.tasks.length === 0) {
        // EMERGENCY RECOVERY: If migration flag is set but we have no data, 
        // it means we likely hit the purge bug. Clear the flag to allow a re-migration if any data exists in localStorage.
        if (localStorage.getItem('flowtracker_sqlite_migrated')) {
            localStorage.removeItem('flowtracker_sqlite_migrated');
            console.warn('Data missing but migration flag found. Clearing flag for retry.');
        }

        state.tasks = DEFAULT_FOCUS_AREAS.map((t, index) => ({
            id: (Date.now() + index).toString(),
            name: t.name,
            category: t.category,
            color: t.color,
            completed: false,
            createdAt: new Date().toISOString()
        }));
        
        // Only save if store is ready
        if (dbManager.initialized || dbManager.disabled) {
            saveData();
        }
    }

    if (!state.collapsedCategories || state.collapsedCategories.length === 0) {
        state.collapsedCategories = ["Education & Personal Development", "Health & Wellness", "Personal Life & Home", "Work & Career", "Creative & Innovation", "Completed"];
    }

    // 4. Initialize UI
    setupEventListeners();
    
    // Initialize Timer Engine
    timer.init({
        onTick: updateTimerDisplay,
        onComplete: handleSessionComplete,
        onSave: saveData
    });

    renderFocusAreas();
    renderHistory('today');
    renderPlan();
    updateLevelUI();
    updateTimerDisplay();
    updateStats();
    updateDateTime();
    setInterval(updateDateTime, 1000);
    try { checkNotificationPrompt(); } catch(e) {}
    restoreTimerState();
    // initTheme() is now handled by the SQLite loader above
    checkAchievements();

    // 5. Finalize - if any saves were buffered during init, perform them now
    if (savePending && dbManager.initialized) {
        saveData();
    }
}

function loadData() {
    try {
        const version = localStorage.getItem(STORAGE_KEYS.VERSION);
        if ((!version || parseInt(version) !== CURRENT_VERSION) && dbManager.disabled) {
            localStorage.setItem(STORAGE_KEYS.VERSION, CURRENT_VERSION);
        }

        const profile = localStorage.getItem(STORAGE_KEYS.PROFILE);
        if (profile) {
            const savedProfile = JSON.parse(profile);
            state.xp = savedProfile.xp || 0;
            state.totalXp = savedProfile.totalXp || 0;
            state.level = savedProfile.level || 1;
            state.avatar = savedProfile.avatar || '🦉';
            state.unlockedAchievements = savedProfile.unlockedAchievements || [];
            state.collapsedCategories = savedProfile.collapsedCategories;
            state.activeCategoryIndex = savedProfile.activeCategoryIndex !== undefined ? savedProfile.activeCategoryIndex : 0;
            
            if (!state.collapsedCategories) {
                state.collapsedCategories = [
                    "Education & Personal Development",
                    "Health & Wellness",
                    "Personal Life & Home",
                    "Work & Career",
                    "Creative & Innovation",
                    "Completed"
                ];
            }
        } else {
            state.collapsedCategories = [
                "Education & Personal Development",
                "Health & Wellness",
                "Personal Life & Home",
                "Work & Career",
                "Creative & Innovation",
                "Completed"
            ];
        }

        const tasks = localStorage.getItem(STORAGE_KEYS.TASKS);
        if (tasks) {
            const parsedTasks = JSON.parse(tasks);
            if (parsedTasks && parsedTasks.length > 0) {
                state.tasks = parsedTasks;
            }
        }

        const sessions = localStorage.getItem(STORAGE_KEYS.SESSIONS);
        if (sessions) {
            state.sessions = JSON.parse(sessions);
        }

        const aims = localStorage.getItem(STORAGE_KEYS.AIMS);
        if (aims) {
            state.aims = JSON.parse(aims);
        }

        const settings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
        if (settings) {
            const savedSettings = JSON.parse(settings);
            state.settings = { 
                ...state.settings, 
                ...savedSettings,
                shareTemplates: { ...state.settings.shareTemplates, ...(savedSettings.shareTemplates || {}) }
            };
        }

        const savedState = localStorage.getItem(STORAGE_KEYS.STATE);
        if (savedState) {
            const timerState = JSON.parse(savedState);
            state.timerState = { ...state.timerState, ...timerState };
            if (!state.timerState.cycleStation) state.timerState.cycleStation = 1;
        } else {
            const mode = state.timerState.mode;
            let duration = state.settings.workDuration;
            if (mode === 'shortBreak') duration = state.settings.shortBreakDuration;
            else if (mode === 'longBreak') duration = state.settings.longBreakDuration;
            
            state.timerState.totalTime = duration * 60;
            state.timerState.remainingTime = duration * 60;
        }
    } catch (e) {
        console.error('Error loading data:', e);
    }
}

function saveData() {
    try {
        if (dbManager.disabled) {
            // Emergent Fallback: ONLY if SQLite is physically unavailable (file:// etc)
            localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(state.tasks));
            localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(state.sessions));
            localStorage.setItem(STORAGE_KEYS.AIMS, JSON.stringify(state.aims));
            localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(state.settings));
            localStorage.setItem(STORAGE_KEYS.STATE, JSON.stringify(state.timerState));
            localStorage.setItem(STORAGE_KEYS.VERSION, CURRENT_VERSION);
            localStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify({
                xp: state.xp,
                totalXp: state.totalXp,
                level: state.level,
                avatar: state.avatar,
                unlockedAchievements: state.unlockedAchievements,
                collapsedCategories: state.collapsedCategories,
                activeCategoryIndex: state.activeCategoryIndex
            }));
            return;
        }

        // Primary storage: SQLite sync
        if (dbManager.initialized) {
            state.tasks.forEach(t => dbManager.insertFocusArea(t));
            state.sessions.forEach(s => dbManager.insertSession(s));
            state.aims.forEach(a => dbManager.insertAim(a));
            for (const [key, value] of Object.entries(state.settings)) {
                dbManager.setSetting(key, value);
            }

            // Save Profile
            dbManager.setUserProfile('full_profile', {
                xp: state.xp,
                totalXp: state.totalXp,
                level: state.level,
                avatar: state.avatar,
                unlockedAchievements: state.unlockedAchievements,
                collapsedCategories: state.collapsedCategories,
                activeCategoryIndex: state.activeCategoryIndex
            });

            // Save App Meta
            dbManager.setAppState('timer_state', state.timerState);
            dbManager.setAppState('theme', document.documentElement.getAttribute('data-theme') || 'dark');
            dbManager.setAppState('notification_prompt', state.notificationPermission);
            dbManager.setAppState('ui_state', {
                lastSessionId: state.lastSessionId,
                lastTaskId: state.lastTaskId,
                selectedTaskColor: state.selectedTaskColor,
                editTaskColor: state.editTaskColor,
                selectedFocusAreaIds: state.selectedFocusAreaIds
            });
            savePending = false;
        } else {
            savePending = true;
            console.log('SQLite not yet initialized, buffering save...');
        }
    } catch (e) {
        console.error('Error saving data:', e);
    }
}

function getLogicalDate(date = new Date()) {
    try {
        const d = (date instanceof Date) ? date : new Date(date);
        if (isNaN(d.getTime())) {
            return new Date(Date.now() - (4 * 60 * 60 * 1000)).toISOString().split('T')[0];
        }
        const shifted = new Date(d.getTime() - (4 * 60 * 60 * 1000));
        return shifted.toISOString().split('T')[0];
    } catch (e) {
        return new Date(Date.now() - (4 * 60 * 60 * 1000)).toISOString().split('T')[0];
    }
}

function getActiveAimForFocusArea(focusAreaId) {
    const aims = state.aims.filter(a => a.focusAreaId === focusAreaId);
    if (aims.length === 0) return null;

    const activeAims = aims.filter(aim => {
        const spent = getTimeSpentOnAim(aim);
        return spent < aim.targetMinutes * 60;
    });

    if (activeAims.length === 0) return null;
    return activeAims.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
}

function getTimeSpentOnAim(aim) {

    if (!aim) return 0;
    return state.sessions
        .filter(s => s.taskId === aim.focusAreaId && new Date(s.timestamp) >= new Date(aim.createdAt))
        .reduce((acc, s) => acc + s.duration, 0);
}

function openFocusAreas() {
    const focusAreaPanel = document.getElementById('focusAreaPanel');
    const focusAreaOverlay = document.getElementById('focusAreaOverlay');
    const planPanel = document.getElementById('planPanel');
    const planOverlay = document.getElementById('planOverlay');
    const menuDropdown = document.getElementById('menuDropdown');

    closePlan();
    if (menuDropdown) menuDropdown.classList.remove('open');

    if (focusAreaPanel) focusAreaPanel.classList.add('open');
    if (focusAreaOverlay) focusAreaOverlay.classList.add('open');
}

function closeFocusAreas() {
    const focusAreaPanel = document.getElementById('focusAreaPanel');
    const focusAreaOverlay = document.getElementById('focusAreaOverlay');
    if (focusAreaPanel) focusAreaPanel.classList.remove('open');
    if (focusAreaOverlay) focusAreaOverlay.classList.remove('open');
}

function openPlan() {
    const planPanel = document.getElementById('planPanel');
    const planOverlay = document.getElementById('planOverlay');
    const menuDropdown = document.getElementById('menuDropdown');
    const selectDropdown = document.getElementById('selectDropdown');

    closeFocusAreas();
    if (menuDropdown) menuDropdown.classList.remove('open');
    if (selectDropdown) selectDropdown.classList.remove('open');

    state.selectedFocusAreaIds = [];
    updateCustomSelectUI();
    populateCustomFocusAreaSelect();
    renderPlan();
    if (planPanel) planPanel.classList.add('open');
    if (planOverlay) planOverlay.classList.add('open');
}

function closePlan() {
    const planPanel = document.getElementById('planPanel');
    const planOverlay = document.getElementById('planOverlay');
    if (planPanel) planPanel.classList.remove('open');
    if (planOverlay) planOverlay.classList.remove('open');
}

function resolveTemplate(template, data) {
    let result = template;
    const focusAreaName = data.focusArea || 'focus session';
    const duration = data.duration || '25';
    const finishTime = data.time || new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: state.settings.use12Hour });
    const xp = data.xp || '0';
    const avatar = data.avatar || state.avatar || '🦉';
    const mood = data.mood || 'Focused';

    result = result.replace(/{focusArea}/g, focusAreaName);
    result = result.replace(/{duration}/g, duration);
    result = result.replace(/{time}/g, finishTime);
    result = result.replace(/{xp}/g, xp);
    result = result.replace(/{avatar}/g, avatar);
    result = result.replace(/{mood}/g, mood);
    
    return result;
}

function handleShare(platform, context = 'intent', customData = {}) {
    const activeTask = state.tasks.find(t => t.id === state.timerState.activeTaskId);
    
    const defaultData = {
        focusArea: activeTask ? activeTask.name : '',
        duration: Math.round(state.timerState.totalTime / 60),
        time: new Date(Date.now() + state.timerState.remainingTime * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: state.settings.use12Hour }),
        xp: Math.floor(state.timerState.totalTime / 60) * 10
    };

    const data = { ...defaultData, ...customData };
    const template = state.settings.shareTemplates[context] || state.settings.shareTemplates.intent;
    const message = resolveTemplate(template, data);

    if (platform === 'x') {
        const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}`;
        window.open(url, '_blank');
    } else if (platform === 'facebook') {
        const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.href)}&quote=${encodeURIComponent(message)}`;
        window.open(url, '_blank');
    } else if (platform === 'pinterest') {
        const url = `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(window.location.href)}&description=${encodeURIComponent(message)}`;
        window.open(url, '_blank');
    } else if (platform === 'copy') {
        navigator.clipboard.writeText(message).then(() => {
            notify('Status copied to clipboard! 📋');
        });
    }
    
    document.querySelectorAll('.expand-group.open').forEach(g => g.classList.remove('open'));
}

function setupExpandGroups() {
    document.addEventListener('click', (e) => {
        const trigger = e.target.closest('.expand-trigger');
        const openGroups = document.querySelectorAll('.expand-group.open');
        
        if (trigger) {
            const group = trigger.closest('.expand-group');
            if (group) {
                e.stopPropagation();
                openGroups.forEach(g => {
                    if (g !== group) g.classList.remove('open');
                });
                group.classList.toggle('open');
                return;
            }
        }
        
        if (openGroups.length > 0 && !e.target.closest('.expand-group')) {
            openGroups.forEach(g => g.classList.remove('open'));
        }
    });
}

function setupEventListeners() {
    try { setupExpandGroups(); } catch (e) { console.error(e); }
    
    const elements = {
        focusAreaLink: 'focusAreaLink',
        focusAreasNavBtn: 'focusAreasNavBtn',
        closeFocusAreaPanel: 'closeFocusAreaPanel',
        focusAreaOverlay: 'focusAreaOverlay',
        planNavBtn: 'planNavBtn',
        closePlanPanel: 'closePlanPanel',
        planOverlay: 'planOverlay',
        menuBtn: 'menuBtn',
        menuDropdown: 'menuDropdown',
        headerAvatar: 'headerAvatar',
        settingsBtn: 'settingsBtn',
        closeProfileBtn: 'closeProfile',
        toggleFocusAreaCreate: 'toggleFocusAreaCreate',
        focusAreaCreateWrapper: 'focusAreaCreateWrapper',
        togglePlanCreate: 'togglePlanCreate',
        planCreateWrapper: 'planCreateWrapper',
        focusAreaInput: 'focusAreaInput',
        addFocusAreaBtn: 'addFocusAreaBtn',
        addAimBtn: 'addAimBtn',
        aimDurationInput: 'aimDurationInput',
        focusAreaCategorySelect: 'focusAreaCategorySelect',
        aimDeadlineSelect: 'aimDeadlineSelect',
        aimCustomDate: 'aimCustomDate',
        selectTrigger: 'selectTrigger',
        focusAreaSearchInput: 'focusAreaSearchInput',
        inlineColorBtn: 'inlineColorBtn',
        selectedColorCircle: 'selectedColorCircle',
        inlineColorDropdown: 'inlineColorDropdown',
        focusAreaEditColorPicker: 'focusAreaEditColorPicker',
        startPauseBtn: 'startPauseBtn',
        resetBtn: 'resetBtn',
        skipBtn: 'skipBtn',
        clearHistoryBtn: 'clearHistoryBtn',
        themeToggle: 'themeToggle',
        closeSettings: 'closeSettings',
        saveSettings: 'saveSettings',
        settingsOverlay: 'settingsOverlay',
        exportData: 'exportData',
        importFile: 'importFile',
        importData: 'importData',
        restoreDefaults: 'restoreDefaults',
        editPersonaBtn: 'editPersonaBtn',
        cancelPersonaEdit: 'cancelPersonaEdit',
        identitySlider: 'identitySlider',
        closeImport: 'closeImport',
        importReplace: 'importReplace',
        importMerge: 'importMerge',
        importModal: 'importModal',
        closeSessionEdit: 'closeSessionEdit',
        cancelSessionEdit: 'cancelSessionEdit',
        saveSessionEdit: 'saveSessionEdit',
        sessionEditModal: 'sessionEditModal',
        sessionEditDuration: 'sessionEditDuration',
        closeFocusAreaEdit: 'closeFocusAreaEdit',
        cancelFocusAreaEdit: 'cancelFocusAreaEdit',
        saveFocusAreaEdit: 'saveFocusAreaEdit',
        focusAreaEditModal: 'focusAreaEditModal',
        focusAreaEditName: 'focusAreaEditName',
        confirmCancel: 'confirmCancel',
        confirmOk: 'confirmOk',
        confirmModal: 'confirmModal',
        clearFocusArea: 'clearFocusArea',
        enableNotifications: 'enableNotifications',
        denyNotifications: 'denyNotifications',
        notificationPrompt: 'notificationPrompt'
    };

    const el = {};
    Object.keys(elements).forEach(key => {
        el[key] = document.getElementById(elements[key]);
    });

    // --- Unified Global Click Handler ---
    document.addEventListener('click', (e) => {
        // 1. Hamburger
        if (el.menuBtn && el.menuDropdown) {
            if (el.menuBtn.contains(e.target)) {
                e.preventDefault();
                e.stopPropagation();
                el.menuDropdown.classList.toggle('open');
            } else if (!el.menuDropdown.contains(e.target)) {
                el.menuDropdown.classList.remove('open');
            }
        }

        // 2. Focus Area Search / Custom Select
        const customSelect = document.getElementById('customFocusAreaSelect');
        const selectDropdown = document.getElementById('selectDropdown');
        if (customSelect && selectDropdown) {
            if (customSelect.contains(e.target)) {
                // Toggle is handled by el.selectTrigger.onclick
            } else {
                selectDropdown.classList.remove('open');
            }
        }

        // 3. Inline Color Dropdown
        if (el.inlineColorBtn && el.inlineColorDropdown) {
            if (el.inlineColorBtn.contains(e.target)) {
                // Toggle is handled by el.inlineColorBtn.onclick
            } else {
                el.inlineColorDropdown.classList.remove('open');
            }
        }

        // 4. Expand Groups (Share menus, etc)
        const trigger = e.target.closest('.expand-trigger');
        if (!trigger && !e.target.closest('.expand-group')) {
            document.querySelectorAll('.expand-group.open').forEach(g => g.classList.remove('open'));
        }
    });

    if (el.focusAreaLink) el.focusAreaLink.onclick = openFocusAreas;
    if (el.focusAreasNavBtn) el.focusAreasNavBtn.onclick = openFocusAreas;
    if (el.planNavBtn) el.planNavBtn.onclick = openPlan;
    if (el.closeFocusAreaPanel) el.closeFocusAreaPanel.onclick = closeFocusAreas;
    if (el.focusAreaOverlay) el.focusAreaOverlay.onclick = closeFocusAreas;
    if (el.closePlanPanel) el.closePlanPanel.onclick = closePlan;
    if (el.planOverlay) el.planOverlay.onclick = closePlan;
    if (el.headerAvatar) el.headerAvatar.onclick = openProfile;
    if (el.settingsBtn) el.settingsBtn.onclick = openSettings;
    if (el.closeProfileBtn) el.closeProfileBtn.onclick = closeProfile;

    // Settings Tabs
    const settingsTabs = document.querySelectorAll('.settings-tab');
    const settingsSections = document.querySelectorAll('.settings-section');
    settingsTabs.forEach(tab => {
        tab.onclick = () => {
            const targetTab = tab.dataset.tab;
            settingsTabs.forEach(t => t.classList.remove('active'));
            settingsSections.forEach(s => s.classList.remove('active'));
            tab.classList.add('active');
            const targetEl = document.getElementById(`tab-${targetTab}`);
            if (targetEl) targetEl.classList.add('active');
        };
    });

    // Toggles
    if (el.toggleFocusAreaCreate && el.focusAreaCreateWrapper) {
        el.toggleFocusAreaCreate.onclick = (e) => {
            e.stopPropagation();
            const isOpen = el.focusAreaCreateWrapper.classList.toggle('open');
            el.toggleFocusAreaCreate.classList.toggle('active', isOpen);
            if (isOpen && el.focusAreaInput) setTimeout(() => el.focusAreaInput.focus(), 100);
        };
    }

    if (el.togglePlanCreate && el.planCreateWrapper) {
        el.togglePlanCreate.onclick = (e) => {
            e.stopPropagation();
            const isOpen = el.planCreateWrapper.classList.toggle('open');
            el.togglePlanCreate.classList.toggle('active', isOpen);
            if (isOpen && el.aimDurationInput) setTimeout(() => el.aimDurationInput.focus(), 100);
        };
    }

    if (el.focusAreaInput) {
        el.focusAreaInput.onkeypress = (e) => { if (e.key === 'Enter') addFocusArea(); };
    }
    if (el.addFocusAreaBtn) {
        el.addFocusAreaBtn.onclick = (e) => { e.preventDefault(); addFocusArea(); };
    }
    if (el.addAimBtn) el.addAimBtn.onclick = addAim;
    if (el.aimDurationInput) {
        el.aimDurationInput.onkeypress = (e) => { if (e.key === 'Enter') addAim(); };
    }

    if (el.focusAreaCategorySelect) {
        el.focusAreaCategorySelect.onchange = () => {
            el.focusAreaCategorySelect.classList.toggle('has-value', el.focusAreaCategorySelect.value !== 'Uncategorized');
        };
    }

    if (el.aimDeadlineSelect && el.aimCustomDate) {
        el.aimDeadlineSelect.onchange = () => {
            el.aimCustomDate.style.display = el.aimDeadlineSelect.value === 'custom' ? 'inline-block' : 'none';
        };
    }

    if (el.selectTrigger) {
        el.selectTrigger.onclick = (e) => {
            e.stopPropagation();
            const selectDropdown = document.getElementById('selectDropdown');
            const searchInput = document.getElementById('focusAreaSearchInput');
            if (selectDropdown) {
                const isOpen = selectDropdown.classList.toggle('open');
                if (isOpen && searchInput) {
                    searchInput.value = '';
                    populateCustomFocusAreaSelect();
                    searchInput.focus();
                }
            }
        };
    }

    if (el.focusAreaSearchInput) {
        el.focusAreaSearchInput.oninput = (e) => {
            populateCustomFocusAreaSelect(e.target.value);
        };
        el.focusAreaSearchInput.onclick = (e) => e.stopPropagation();
    }

    // Color Dropdown
    if (el.inlineColorBtn && el.inlineColorDropdown) {
        el.inlineColorBtn.onclick = (e) => {
            e.stopPropagation();
            el.inlineColorDropdown.classList.toggle('open');
        };

        el.inlineColorDropdown.querySelectorAll('.color-dot').forEach(dot => {
            dot.onclick = (e) => {
                e.stopPropagation();
                const color = dot.dataset.color;
                state.selectedTaskColor = color;
                if (el.selectedColorCircle) el.selectedColorCircle.style.background = color;
                el.inlineColorDropdown.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
                dot.classList.add('active');
                el.inlineColorDropdown.classList.remove('open');
            };
        });
    }

    // Timer Controls
    if (el.startPauseBtn) el.startPauseBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); toggleTimer(); };
    if (el.resetBtn) el.resetBtn.onclick = (e) => { e.preventDefault(); resetTimer(); };
    if (el.skipBtn) el.skipBtn.onclick = (e) => { e.preventDefault(); skipSession(); };
    if (el.clearHistoryBtn) el.clearHistoryBtn.onclick = clearHistory;

    document.querySelectorAll('.mode-tab').forEach(tab => {
        tab.onclick = () => switchMode(tab.dataset.mode);
    });

    document.querySelectorAll('.history-filters .filter-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.history-filters .filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderHistory(currentFilter);
        };
    });

    const showAllBtn = document.querySelector('.history-show-all-container .filter-btn');
    if (showAllBtn) {
        showAllBtn.onclick = () => {
            showAllHistory = !showAllHistory;
            renderHistory(currentFilter);
        };
    }

    if (el.themeToggle) el.themeToggle.onclick = toggleTheme;
    if (el.closeSettings) el.closeSettings.onclick = closeSettings;
    if (el.saveSettings) el.saveSettings.onclick = () => { notify('Settings saved'); closeSettings(); };
    if (el.settingsOverlay) {
        el.settingsOverlay.onclick = (e) => {
            if (e.target.id === 'settingsOverlay') { closeSettings(); closeProfile(); }
        };
    }

    if (el.exportData) el.exportData.onclick = exportData;
    if (el.importFile) el.importFile.onchange = handleImportFile;
    if (el.importData && el.importFile) el.importData.onclick = () => el.importFile.click();

    if (el.restoreDefaults) {
        el.restoreDefaults.onclick = async () => {
            const confirmed = await confirmAction("Add default focus areas?");
            if (confirmed) {
                const newTasks = DEFAULT_FOCUS_AREAS.map((t, index) => ({
                    id: (Date.now() + index).toString(),
                    name: t.name,
                    category: t.category,
                    color: t.color,
                    completed: false,
                    createdAt: new Date().toISOString()
                }));
                state.tasks = [...state.tasks, ...newTasks];
                saveData(); renderFocusAreas(); notify("Default areas added! 🎯");
            }
        };
    }

    if (el.enableNotifications) el.enableNotifications.onclick = requestNotificationPermission;
    if (el.denyNotifications) el.denyNotifications.onclick = () => {
        state.notificationPermission = 'denied';
        saveData();
        if (el.notificationPrompt) el.notificationPrompt.style.display = 'none';
    };

    if (el.editPersonaBtn && el.identitySlider) el.editPersonaBtn.onclick = () => el.identitySlider.classList.add('editing');
    if (el.cancelPersonaEdit && el.identitySlider) el.cancelPersonaEdit.onclick = () => el.identitySlider.classList.remove('editing');

    document.querySelectorAll('.avatar-option').forEach(opt => {
        opt.onclick = () => {
            state.avatar = opt.dataset.avatar;
            document.querySelectorAll('.avatar-option').forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            saveData(); updateLevelUI();
            if (el.identitySlider) el.identitySlider.classList.remove('editing');
        };
    });

    if (el.closeImport) el.closeImport.onclick = closeImportModal;
    if (el.importReplace) el.importReplace.onclick = () => performImport('replace');
    if (el.importMerge) el.importMerge.onclick = () => performImport('merge');
    if (el.importModal) el.importModal.onclick = (e) => { if (e.target.id === 'importModal') closeImportModal(); };

    if (el.closeSessionEdit) el.closeSessionEdit.onclick = closeSessionEditModal;
    if (el.cancelSessionEdit) el.cancelSessionEdit.onclick = closeSessionEditModal;
    if (el.saveSessionEdit) el.saveSessionEdit.onclick = saveSessionFromModal;
    if (el.sessionEditModal) el.sessionEditModal.onclick = (e) => { if (e.target.id === 'sessionEditModal') closeSessionEditModal(); };
    if (el.sessionEditDuration) {
        el.sessionEditDuration.onkeydown = (e) => {
            if (e.key === 'Enter') saveSessionFromModal();
            if (e.key === 'Escape') closeSessionEditModal();
        };
    }

    if (el.closeFocusAreaEdit) el.closeFocusAreaEdit.onclick = closeFocusAreaEditModal;
    if (el.cancelFocusAreaEdit) el.cancelFocusAreaEdit.onclick = closeFocusAreaEditModal;
    if (el.saveFocusAreaEdit) el.saveFocusAreaEdit.onclick = saveFocusAreaFromModal;
    if (el.focusAreaEditModal) el.focusAreaEditModal.onclick = (e) => { if (e.target.id === 'focusAreaEditModal') closeFocusAreaEditModal(); };
    if (el.focusAreaEditName) {
        el.focusAreaEditName.onkeydown = (e) => {
            if (e.key === 'Enter') saveFocusAreaFromModal();
            if (e.key === 'Escape') closeFocusAreaEditModal();
        };
    }

    if (el.confirmCancel) el.confirmCancel.onclick = closeConfirmModal;
    if (el.confirmOk) {
        el.confirmOk.onclick = () => {
            el.confirmModal.classList.remove('open');
            if (confirmResolve) { confirmResolve(true); confirmResolve = null; }
        };
    }
    if (el.confirmModal) el.confirmModal.onclick = (e) => { if (e.target.id === 'confirmModal') closeConfirmModal(); };

    if (el.clearFocusArea) {
        el.clearFocusArea.onclick = (e) => {
            e.stopPropagation();
            if (state.timerState.isRunning) {
                 confirmAction('Clearing the focus area will reset the timer. Continue?').then(confirmed => {
                    if (confirmed) { state.timerState.activeTaskId = null; resetTimer(); }
                });
            } else { state.timerState.activeTaskId = null; updateTimerDisplay(); }
        };
    }

    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.code === 'Space') {
            e.preventDefault(); toggleTimer();
        } else if (e.key.toLowerCase() === 'r') {
            resetTimer();
        } else if (e.key.toLowerCase() === 'n') {
            skipSession();
        } else if (e.key.toLowerCase() === 'g') {
            const panel = document.getElementById('focusAreaPanel');
            if (panel && panel.classList.contains('open')) closeFocusAreas(); else openFocusAreas();
        } else if (e.key.toLowerCase() === 'p') {
            const panel = document.getElementById('planPanel');
            if (panel && panel.classList.contains('open')) closePlan(); else openPlan();
        } else if (e.key === '1') switchMode('work');
        else if (e.key === '2') switchMode('shortBreak');
        else if (e.key === '3') switchMode('longBreak');
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') restoreTimerState();
    });
}

function skipSession() {
    handleSessionComplete(true);
}

function handleSessionComplete(skipped = false) {
    pauseTimer();
    state.timerState.startTime = null;
    const currentMode = state.timerState.mode;
    const wasWork = currentMode === 'work';
    
    // Determine next mode based on current station
    let nextMode;
    if (wasWork) {
        // Just finished a Focus session. The station remains the same for the following break.
        if (state.timerState.cycleStation >= state.settings.sessionsBeforeLongBreak) {
            nextMode = 'longBreak';
        } else {
            nextMode = 'shortBreak';
        }
    } else {
        // Just finished a break session.
        nextMode = 'work';
        // Now increment the station for the NEW focus session.
        if (currentMode === 'longBreak') {
            state.timerState.cycleStation = 1;
        } else {
            state.timerState.cycleStation++;
        }
    }

    if (wasWork && !skipped) {
        state.timerState.sessionCount++;
        saveSession();
        updateStats();
        const container = document.querySelector('.timer-container');
        if (container) {
            container.classList.add('timer-pulse');
            setTimeout(() => container.classList.remove('timer-pulse'), 600);
        }
        timer.playTone(440, 0.1, 0);
        setTimeout(() => timer.playTone(880, 0.2, 0.1), 100);
        const xp = Math.floor(state.settings.workDuration) * 10;
        setTimeout(() => notify(`Focus Area session complete! +${xp} XP earned 🚀`), 500);
    } else if (!wasWork && !skipped) {
        const container = document.querySelector('.timer-container');
        if (container) {
            container.classList.add('timer-pulse');
            setTimeout(() => container.classList.remove('timer-pulse'), 600);
        }
        timer.playTone(880, 0.1, 0);
        setTimeout(() => timer.playTone(440, 0.2, 0.1), 100);
        setTimeout(() => notify('Break is over! Ready to focus?'), 500);
    }
    
    // DYNAMIC GUIDANCE:
    // If naturally finished, we stay at 0:00 so the user can read the message.
    // If skipped, we apply the next duration immediately as requested, but wait for start.
    if (skipped) {
        timer.applyMode(nextMode);
    } else {
        state.timerState.mode = nextMode;
        state.timerState.remainingTime = 0;
        updateTimerDisplay();
    }
    saveData();

    renderHistory(currentFilter);

    // Show Guidance Message
    const msgEl = document.getElementById('timerMessage');
    if (msgEl) {
        const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: state.settings.use12Hour });
        const status = skipped ? `Skipped ${wasWork ? 'Focus Area' : 'Break'}` : `Finished ${wasWork ? 'Focus Area' : 'Break'} at ${time}`;
        msgEl.innerHTML = `<span class="msg-status">${status}</span><span class="msg-action">Let's start a ${nextMode === 'longBreak' ? 'long break' : (nextMode === 'shortBreak' ? 'break' : 'focus session')}!</span>`;
        const display = document.querySelector('.timer-display');
        if (display) display.classList.add('has-message');
    }
    
    // Auto-start logic only applies to natural finishes, not manual skips
    if (!skipped && ((nextMode === 'work' && state.settings.autoStartWork) || (nextMode !== 'work' && state.settings.autoStartBreaks))) {
        setTimeout(() => {
            if (state.timerState.remainingTime <= 0) timer.applyMode(state.timerState.mode);
            startTimer();
        }, 1500);
    }
}

function updateTimerDisplay() {
    const timeEl = document.getElementById('timerTime');
    const modeEl = document.getElementById('timerMode');
    const startPauseText = document.getElementById('startPauseText');
    const playIcon = document.getElementById('playIcon');
    const timerProgress = document.getElementById('timerProgress');
    const textEl = document.getElementById('focusAreaText');
    const prefixEl = document.getElementById('focusAreaPrefix');
    
    // Calculate mins and secs from remaining time
    const remaining = Math.max(0, state.timerState.remainingTime);
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
    
    if (timeEl) timeEl.textContent = timeStr;
    document.title = `${timeStr} - PomoFlow`;
    
    if (modeEl) modeEl.textContent = state.timerState.mode === 'work' ? '🧠 Focus' : '🏖️ Break';
    const currentStationIndex = (state.timerState.cycleStation || 1) - 1;
    const sessionProgress = document.getElementById('sessionProgress');
    if (sessionProgress) {
        const dotCount = state.settings.sessionsBeforeLongBreak;
        if (sessionProgress.querySelectorAll('.progress-step').length !== dotCount) {
            sessionProgress.innerHTML = '';
            for (let i = 0; i < dotCount; i++) {
                const dot = document.createElement('div');
                dot.className = 'progress-step';
                sessionProgress.appendChild(dot);
            }
        }
        sessionProgress.querySelectorAll('.progress-step').forEach((step, index) => {
            step.classList.remove('active', 'completed');
            if (index === currentStationIndex) step.classList.add('active');
            else if (index < currentStationIndex) step.classList.add('completed');
        });
    }
    if (state.timerState.isRunning) {
        if (startPauseText) startPauseText.textContent = 'Pause';
        if (playIcon) playIcon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
        document.body.classList.add('timer-running');
    } else {
        if (startPauseText) startPauseText.textContent = 'Start';
        if (playIcon) playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
        document.body.classList.remove('timer-running');
    }
    const hudEl = document.getElementById('focusAreaProgressHUD');
    const clearBtn = document.getElementById('clearFocusArea');
    const questionEl = document.getElementById('focusAreaQuestion');

    if (state.timerState.activeTaskId) {
        const task = state.tasks.find(t => t.id === state.timerState.activeTaskId);
        if (task) {
            if (questionEl) questionEl.textContent = 'Focusing on:';
            if (textEl) { 
                textEl.textContent = task.name; 
                textEl.style.color = task.color; 
                textEl.title = task.name;
            }
            if (prefixEl) prefixEl.style.display = 'none';
            if (clearBtn) clearBtn.style.display = 'flex';
            const activeAim = getActiveAimForFocusArea(task.id);
            if (hudEl) {
                hudEl.style.display = 'block';
                if (activeAim) {
                    const spent = getTimeSpentOnAim(activeAim);
                    const targetMins = activeAim.targetMinutes;
                    const h = Math.floor(targetMins / 60);
                    const m = targetMins % 60;
                    const aimStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
                    const existingProgress = hudEl.querySelector('progress-compact');
                    if (existingProgress) {
                        existingProgress.setAttribute('value', spent);
                        existingProgress.setAttribute('label', aimStr);
                    } else {
                        hudEl.innerHTML = `<progress-compact value="${spent}" max="${targetMins * 60}" color="${task.color}" label="${aimStr}"></progress-compact>`;
                    }
                } else {
                    if (!hudEl.querySelector('.set-aim-cta')) hudEl.innerHTML = `<div class="set-aim-cta"><span class="set-aim-text">Set a focus aim.</span></div>`;
                }
                hudEl.onclick = () => {
                    openPlan();
                    state.selectedFocusAreaIds = [task.id];
                    updateCustomSelectUI();
                    populateCustomFocusAreaSelect();
                };
            }
        }
    } else {
        if (questionEl) questionEl.textContent = 'What are you focusing on?';
        if (textEl) {
            textEl.innerHTML = '<span class="focus-area-add-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg></span>';
            textEl.style.color = '';
            textEl.title = '';
        }
        if (hudEl) hudEl.style.display = 'none';
        if (clearBtn) clearBtn.style.display = 'none';
    }
    const percent = (state.timerState.remainingTime / state.timerState.totalTime);
    const offset = 282.7 * (1 - percent);
    const isBreak = state.timerState.mode !== 'work';
    const modeClass = isBreak ? (state.timerState.mode === 'longBreak' ? 'long-break' : 'break') : 'work';
    const sessionColor = isBreak ? 'var(--success)' : 'var(--danger)';

    if (timerProgress) {
        timerProgress.style.strokeDashoffset = offset;
        timerProgress.style.stroke = sessionColor;
        timerProgress.setAttribute('class', `timer-ring-progress ${modeClass}`);
    }
    
    // Update all focus area small rings to match the current mode and its color
    document.querySelectorAll('.focus-area-ring-progress').forEach(ring => {
        ring.style.stroke = sessionColor;
        ring.setAttribute('class', `focus-area-ring-progress ${modeClass}`);
    });
}

function addFocusArea() {
    const input = document.getElementById('focusAreaInput');
    const catSelect = document.getElementById('focusAreaCategorySelect');
    const name = input.value.trim();
    const cat = catSelect.value;
    if (name) {
        const task = { id: Date.now().toString(), name, category: cat, color: state.selectedTaskColor, completed: false, createdAt: new Date().toISOString(), totalTime: 0 };
        state.tasks.push(task);
        state.lastTaskId = task.id;
        input.value = '';
        catSelect.value = 'Uncategorized';
        catSelect.classList.remove('has-value');
        
        // Auto-collapse
        const wrapper = document.getElementById('focusAreaCreateWrapper');
        const btn = document.getElementById('toggleFocusAreaCreate');
        if (wrapper && btn) {
            wrapper.classList.remove('open');
            btn.classList.remove('active');
        }

        saveData();
        renderFocusAreas();
        const addBtn = document.getElementById('addFocusAreaBtn');
        if (addBtn) {
            addBtn.style.background = 'var(--success)';
            setTimeout(() => addBtn.style.background = '', 500);
        }
    } else {
        const w = document.querySelector('.focus-area-input-wrapper');
        if (w) { w.classList.add('shake'); setTimeout(() => w.classList.remove('shake'), 400); }
    }
}

function formatDurationHM(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function getTodayTimeForFocusArea(id) {
    const today = getLogicalDate();
    return state.sessions.filter(s => s.taskId === id && getLogicalDate(new Date(s.timestamp)) === today).reduce((acc, s) => acc + s.duration, 0);
}

function getTotalTimeForFocusArea(id) {
    return state.sessions.filter(s => s.taskId === id).reduce((acc, s) => acc + s.duration, 0);
}

function renderFocusAreas() {
    const list = document.getElementById('focusAreaList');
    if (!list) return;
    list.innerHTML = '';
    state.tasks.forEach(t => {
        if (!t.category) t.category = 'Uncategorized';
        if (!t.color) t.color = '#58a6ff';
        if (t.completed === undefined) t.completed = false;
    });
    if (state.tasks.length === 0) {
        list.innerHTML = '<div class="empty-state"><p>No focus areas yet. Add one above!</p></div>';
        return;
    }

    const active = state.tasks.filter(t => !t.completed);
    const completed = state.tasks.filter(t => t.completed);
    const grouped = active.reduce((acc, t) => {
        const c = t.category || 'Uncategorized';
        if (!acc[c]) acc[c] = [];
        acc[c].push(t);
        return acc;
    }, {});

    const icons = { "Education & Personal Development": "🎓", "Health & Wellness": "💪", "Personal Life & Home": "🏠", "Work & Career": "💼", "Creative & Innovation": "🎨", "Completed": "✅", "Uncategorized": "📁" };
    const order = ["Education & Personal Development", "Health & Wellness", "Personal Life & Home", "Work & Career", "Creative & Innovation", "Uncategorized"];
    const activeCats = Object.keys(grouped).sort((a, b) => {
        const ia = order.indexOf(a), ib = order.indexOf(b);
        return (ia !== -1 && ib !== -1) ? ia - ib : (ia !== -1 ? -1 : (ib !== -1 ? 1 : a.localeCompare(b)));
    });

    const categories = [...activeCats];
    if (completed.length > 0) categories.push('Completed');

    // Ensure index is valid
    if (state.activeCategoryIndex >= categories.length) state.activeCategoryIndex = 0;

    const renderItem = (task) => {
        const item = document.createElement('sliding-card');
        const today = getTodayTimeForFocusArea(task.id);
        const total = getTotalTimeForFocusArea(task.id);

        item.setAttribute('menu-width', '150px');
        if (state.timerState.activeTaskId === task.id) item.setAttribute('active', '');

        const clockIcon = '<svg viewBox="0 0 24 24" fill="currentColor" style="opacity: 0.7;"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>';
        const editIcon = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
        const doneIcon = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
        const deleteIcon = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';

        const isBreak = state.timerState.mode !== 'work';
        const modeClass = isBreak ? (state.timerState.mode === 'longBreak' ? 'long-break' : 'break') : 'work';
        const sessionColor = isBreak ? 'var(--success)' : 'var(--danger)';

        item.innerHTML = `
            <button slot="menu" class="edit-btn">${editIcon}<span>Edit</span></button>
            <button slot="menu" class="completed-btn">${doneIcon}<span>${task.completed ? 'Undo' : 'Done'}</span></button>
            <button slot="menu" class="danger delete-btn">${deleteIcon}<span>Delete</span></button>
            <button slot="indicator" class="focus-area-play-btn" style="color: ${task.color}">
                <svg class="focus-area-ring" viewBox="0 0 100 100">
                    <circle class="focus-area-ring-bg" cx="50" cy="50" r="45"></circle>
                    <circle class="focus-area-ring-progress ${modeClass}" cx="50" cy="50" r="45" stroke-dasharray="282.7" stroke-dashoffset="282.7" id="focusAreaRing-${task.id}" style="stroke: ${sessionColor}"></circle>
                </svg>
                ${state.timerState.activeTaskId === task.id && state.timerState.isRunning ? '⏸' : '▶'}
            </button>
            <div class="focus-area-info">
                <div class="focus-area-name" style="color: ${task.color}" title="${escapeHtml(task.name)}">${escapeHtml(task.name)}</div>
                <div class="focus-area-stats-row">
                    <span>${clockIcon}Today: ${formatDurationHM(today)}</span>
                    <span class="stats-divider">|</span>
                    <span>${clockIcon}Total: ${formatDurationHM(total)}</span>
                </div>
            </div>
        `;

        item.querySelector('.focus-area-play-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (state.timerState.activeTaskId === task.id) toggleTimer();
            else { state.timerState.activeTaskId = task.id; applyMode('work'); startTimer(); }
            renderFocusAreas(); closeFocusAreas();
        });
        item.querySelector('.edit-btn').addEventListener('click', () => { item.isOpen = false; openFocusAreaEditModal(task); });
        item.querySelector('.completed-btn').addEventListener('click', () => { item.isOpen = false; toggleFocusAreaComplete(task.id); });
        item.querySelector('.delete-btn').addEventListener('click', () => { item.isOpen = false; deleteFocusArea(task.id); });
        return item;
    };

    categories.forEach((cat, idx) => {
        const isActive = idx === state.activeCategoryIndex;
        const group = document.createElement('div');
        group.className = `focus-area-category-group ${isActive ? 'active' : 'collapsed'}`;
        
        const header = document.createElement('div');
        header.className = `focus-area-category-header ${isActive ? 'active' : ''}`;
        header.innerHTML = `
            <div class="category-title-wrapper">
                <span class="category-icon">${icons[cat] || '📁'}</span>
                <span>${cat}</span>
            </div>
            <svg class="category-chevron" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
            </svg>
        `;
        
        header.onclick = () => {
            if (state.activeCategoryIndex === idx) {
                state.activeCategoryIndex = -1; // Toggle off
            } else {
                state.activeCategoryIndex = idx;
            }
            saveData(); renderFocusAreas();
        };

        group.appendChild(header);

        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'focus-area-category-wrapper';
        
        const content = document.createElement('div');
        content.className = 'focus-area-category-content';
        
        if (isActive) {
            const tasksToShow = cat === 'Completed' ? completed : grouped[cat];
            if (tasksToShow) tasksToShow.forEach(t => content.appendChild(renderItem(t)));
        }

        contentWrapper.appendChild(content);
        group.appendChild(contentWrapper);
        list.appendChild(group);
    });
}

function toggleFocusAreaComplete(id) {
    const t = state.tasks.find(x => x.id === id);
    if (t) {
        t.completed = !t.completed;
        if (t.completed && state.timerState.activeTaskId === id) {
            state.timerState.activeTaskId = null;
            if (state.timerState.isRunning) pauseTimer();
        }
        saveData(); renderFocusAreas();
    }
}

function deleteFocusArea(id) {
    confirmAction('Delete this focus area?').then(conf => {
        if (conf) {
            state.tasks = state.tasks.filter(x => x.id !== id);
            if (state.timerState.activeTaskId === id) {
                state.timerState.activeTaskId = null;
                if (state.timerState.isRunning) pauseTimer();
            }
            saveData(); renderFocusAreas();
        }
    });
}

function saveSession() {
    const session = { id: Date.now().toString(), taskId: state.timerState.activeTaskId, taskName: 'Unknown Focus Area', taskColor: '#58a6ff', duration: state.settings.workDuration * 60, timestamp: new Date().toISOString() };
    if (state.timerState.activeTaskId) {
        const t = state.tasks.find(x => x.id === state.timerState.activeTaskId);
        if (t) {
            t.totalTime += session.duration;
            session.taskName = t.name;
            session.taskColor = t.color;
            const aim = getActiveAimForFocusArea(t.id);
            if (aim && !aim.completedBonusAwarded && getTimeSpentOnAim(aim) >= aim.targetMinutes * 60) {
                aim.completedBonusAwarded = true;
                addXP(500, true);
                notify(`Milestone: +500 XP!`, 'PomoFlow', 'milestone');
            }
        }
    }
    state.sessions.push(session);
    if (dbManager.initialized) dbManager.insertSession(session);
    const xp = Math.floor(session.duration / 60) * 10;
    if (xp > 0) addXP(xp);
    saveData(); renderFocusAreas(); renderHistory(currentFilter); checkAchievements();
}

function addXP(amt, bonus = false) {
    const old = state.totalXp;
    state.xp += amt;
    state.totalXp += amt;
    const el = document.querySelector('.level-xp-display');
    if (el && !bonus) {
        const f = document.createElement('span');
        f.className = 'xp-float';
        f.textContent = `+${amt} XP`;
        el.appendChild(f);
        setTimeout(() => f.remove(), 1500);
    }
    if (state.xp >= state.level * 1000) {
        state.xp -= state.level * 1000;
        state.level++;
        notify(`LEVEL UP! Level ${state.level}`, 'PomoFlow', 'milestone');
        const av = document.getElementById('headerAvatar');
        if (av) { av.classList.add('avatar-victory'); setTimeout(() => av.classList.remove('avatar-victory'), 800); }
        timer.playTone(523.25, 0.1, 0);
    }
    updateLevelUI(old);
}

function updateLevelUI(previousTotalXp = null) {
    const xpEl = document.getElementById('userXP');
    const rankEl = document.getElementById('userRank');
    const headerAvatar = document.getElementById('headerAvatar');
    const levelContainer = document.getElementById('levelContainer');
    if (!xpEl || !rankEl) return;
    if (previousTotalXp !== null && previousTotalXp !== state.totalXp) animateValue(xpEl, previousTotalXp, state.totalXp, 500);
    else xpEl.textContent = state.totalXp.toLocaleString();
    if (levelContainer) levelContainer.title = `Level ${state.level}`;
    if (headerAvatar) headerAvatar.textContent = state.avatar || '🦉';
    const personaCircle = document.getElementById('personaCircle');
    const currentMoodLabel = document.getElementById('currentMoodLabel');
    if (personaCircle) personaCircle.textContent = state.avatar || '🦉';
    if (currentMoodLabel) {
        const opt = document.querySelector(`.avatar-option[data-avatar="${state.avatar}"]`);
        if (opt) currentMoodLabel.textContent = opt.getAttribute('title');
    }
    const ranks = [{ min: 1, name: 'Novice' }, { min: 5, name: 'Focused' }, { min: 10, name: 'Deep Worker' }, { min: 20, name: 'Flow State' }, { min: 35, name: 'Master' }, { min: 50, name: 'Zen Architect' }];
    const currentRank = [...ranks].reverse().find(r => state.level >= r.min);
    rankEl.textContent = currentRank ? currentRank.name : 'Novice';
}

function animateValue(obj, start, end, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.textContent = Math.floor(progress * (end - start) + start).toLocaleString();
        if (progress < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
}

function renderHistory(filter = 'today') {
    const list = document.getElementById('historyList');
    if (!list) return;
    const headerHTML = `<div class="history-header-grid sticky-header"><div class="history-header-indicator"></div><div class="history-header-info"><div>FOCUS AREA</div><div>DURATION</div><div>CHECKED OFF AT</div></div><div class="history-header-more"></div></div>`;
    let sessions = filterSessions(state.sessions, filter);
    if (sessions.length === 0) {
        list.innerHTML = headerHTML + '<div class="empty-state"><p>No sessions found for this period.</p></div>';
        renderChart([]);
        return;
    }
    sessions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    renderChart(sessions);
    list.innerHTML = headerHTML;
    const displaySessions = showAllHistory ? sessions : sessions.slice(0, 4);
    displaySessions.forEach(session => {
        const item = document.createElement('sliding-card');
        item.setAttribute('menu-width', '100px');
        const timeStr = formatTimestamp(new Date(session.timestamp));
        const durationMin = Math.round(session.duration / 60);
        
        const editIcon = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
        const deleteIcon = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';

        item.innerHTML = `
            <button slot="menu" class="edit-btn">${editIcon}<span>Edit</span></button>
            <button slot="menu" class="danger delete-btn">${deleteIcon}<span>Delete</span></button>
            <div slot="indicator" class="history-type-indicator" style="background: ${session.taskColor || '#58a6ff'}"></div>
            <div class="history-info">
                <div class="history-focus-area" title="${escapeHtml(session.taskName)}">${escapeHtml(session.taskName)}</div>
                <div class="history-duration">${durationMin} min</div>
                <div class="history-time">${timeStr}</div>
            </div>
        `;
        
        item.querySelector('.edit-btn').addEventListener('click', () => { item.isOpen = false; openSessionEditModal(session); });
        item.querySelector('.delete-btn').addEventListener('click', () => { item.isOpen = false; deleteSession(session.id); });
        list.appendChild(item);
    });
    const showAllBtn = document.querySelector('.history-show-all-container .filter-btn');
    if (showAllBtn) {
        showAllBtn.style.display = sessions.length > 4 ? 'flex' : 'none';
        showAllBtn.innerHTML = showAllHistory ? 'Show Less' : 'Show All';
    }
}

function filterSessions(sessions, filter) {
    const now = new Date();
    if (filter === 'today') {
        const today = getLogicalDate(now);
        return sessions.filter(s => getLogicalDate(new Date(s.timestamp)) === today);
    } else if (filter === 'week') {
        const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - (7 * 24 * 60 * 60 * 1000);
        return sessions.filter(s => new Date(s.timestamp).getTime() >= weekAgo);
    }
    return sessions;
}

function deleteSession(id) {
    confirmAction('Delete session record?').then(conf => {
        if (conf) {
            const s = state.sessions.find(x => x.id === id);
            if (s && s.taskId) {
                const t = state.tasks.find(x => x.id === s.taskId);
                if (t) t.totalTime = Math.max(0, t.totalTime - s.duration);
            }
            state.sessions = state.sessions.filter(x => x.id !== id);
            saveData(); renderFocusAreas(); renderHistory(currentFilter); updateStats();
        }
    });
}

function updateStats() {
    const today = getLogicalDate();
    const todaySessions = state.sessions.filter(s => getLogicalDate(new Date(s.timestamp)) === today);
    const totalSecs = todaySessions.reduce((acc, s) => acc + s.duration, 0);
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const todayTimeEl = document.getElementById('todayFocusTime');
    if (todayTimeEl) todayTimeEl.textContent = h > 0 ? `${h}h ${m}m` : `${m}m`;
    const todaySessEl = document.getElementById('todaySessions');
    if (todaySessEl) todaySessEl.textContent = todaySessions.length;
    const streak = calculateStreak(state.sessions);
    const streakEl = document.getElementById('currentStreak');
    if (streakEl) streakEl.textContent = streak > 0 ? `${streak} days` : '--';
}

function calculateStreak(sessions) {
    if (sessions.length === 0) return 0;
    const dates = [...new Set(sessions.map(s => getLogicalDate(new Date(s.timestamp))))].map(d => new Date(d)).sort((a, b) => b - a);
    let streak = 0; let cur = new Date(getLogicalDate());
    if (Math.floor((cur - dates[0]) / 86400000) > 1) return 0;
    for (let i = 0; i < dates.length; i++) {
        if (i === 0) { streak = 1; continue; }
        if (Math.floor((dates[i-1] - dates[i]) / 86400000) === 1) streak++;
        else break;
    }
    return streak;
}

function renderChart(sessions) {
    const container = document.getElementById('historyChart');
    if (!container) return;
    container.innerHTML = ''; if (sessions.length === 0) return;
    const data = {};
    sessions.forEach(s => {
        const name = s.taskName || 'Unknown';
        const duration = Number(s.duration) || 0;
        if (!data[name]) data[name] = { time: 0, color: s.taskColor || '#58a6ff' };
        data[name].time += duration;
    });
    const top = Object.entries(data).sort((a, b) => b[1].time - a[1].time).slice(0, 5);
    const total = sessions.reduce((acc, s) => acc + (s.duration || 0), 0);
    if (total <= 0) return;

    const chartSize = 140; const center = chartSize / 2; const radius = 60; let curAngle = 0;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${chartSize} ${chartSize}`);
    svg.classList.add('pie-chart');
    top.forEach(([name, d]) => {
        const slice = (d.time / total) * 360;
        if (isNaN(slice)) return;
        if (slice >= 359.9) {
            const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            c.setAttribute('cx', center); c.setAttribute('cy', center); c.setAttribute('r', radius); c.setAttribute('fill', d.color);
            svg.appendChild(c); return;
        }
        const x1 = center + radius * Math.cos(Math.PI * (curAngle - 90) / 180);
        const y1 = center + radius * Math.sin(Math.PI * (curAngle - 90) / 180);
        curAngle += slice;
        const x2 = center + radius * Math.cos(Math.PI * (curAngle - 90) / 180);
        const y2 = center + radius * Math.sin(Math.PI * (curAngle - 90) / 180);
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', `M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 ${slice > 180 ? 1 : 0} 1 ${x2} ${y2} Z`);
        p.setAttribute('fill', d.color); svg.appendChild(p);
    });
    const wrapper = document.createElement('div');
    wrapper.className = 'pie-chart-container'; wrapper.appendChild(svg);
    const legend = document.createElement('div');
    legend.className = 'pie-legend';
    top.forEach(([name, d]) => {
        const item = document.createElement('div');
        item.className = 'legend-item';
        item.innerHTML = `<div class="legend-color" style="background: ${d.color}"></div><div class="legend-label">${escapeHtml(name)}</div><div class="legend-value">${Math.round(d.time/60)}m (${Math.round(d.time/total*100)}%)</div>`;
        legend.appendChild(item);
    });
    wrapper.appendChild(legend); container.appendChild(wrapper);
}

function updateDateTime() {
    const el = document.getElementById('datetime'); if (!el) return;
    const now = new Date();
    const options = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: state.settings.use12Hour };
    el.textContent = now.toLocaleDateString('en-US', options).replace(',', '');
}

function formatTimestamp(date) {
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: state.settings.use12Hour });
}

function openProfile() {
    const profilePanel = document.getElementById('profilePanel');
    const settingsOverlay = document.getElementById('settingsOverlay');
    if (!profilePanel || !settingsOverlay) return;
    closeFocusAreas(); closePlan(); document.getElementById('settingsPanel').classList.remove('open');
    renderAchievements(); profilePanel.classList.add('open'); settingsOverlay.classList.add('open');
}

function closeProfile() {
    const profilePanel = document.getElementById('profilePanel');
    const settingsOverlay = document.getElementById('settingsOverlay');
    if (profilePanel) profilePanel.classList.remove('open');
    if (settingsOverlay) settingsOverlay.classList.remove('open');
}

function renderAchievements() {
    const grid = document.getElementById('achievementsGrid'); if (!grid) return;
    grid.innerHTML = '';
    ACHIEVEMENTS.forEach(achievement => {
        const unlocked = state.unlockedAchievements.find(ua => ua.id === achievement.id);
        const badge = document.createElement('div');
        let icon = achievement.icon; let name = achievement.name; let desc = achievement.desc;
        if (!unlocked && achievement.hidden) { icon = '❓'; name = 'Secret'; desc = 'Keep focusing to discover...'; }
        badge.className = `achievement-badge ${unlocked ? 'unlocked' : 'locked'} ${!unlocked && achievement.hidden ? 'hidden' : ''}`;
        badge.innerHTML = `<div class="badge-icon">${icon}</div><div class="badge-name">${name}</div><div class="badge-desc">${desc}</div>${unlocked ? `<div class="badge-date">${new Date(unlocked.date).toLocaleDateString('en-US', {month:'short', day:'numeric'})}</div>` : ''}`;
        grid.appendChild(badge);
    });
}

function checkAchievements() {
    const totalFocusMinutes = state.sessions.reduce((acc, s) => acc + s.duration, 0) / 60;
    const totalAimsReached = state.aims.filter(aim => getTimeSpentOnAim(aim) >= aim.targetMinutes * 60).length;
    const currentStreak = calculateStreak(state.sessions);
    const tryUnlock = (id, condition) => {
        if (!state.unlockedAchievements.find(ua => ua.id === id) && condition) {
            const achievement = ACHIEVEMENTS.find(a => a.id === id);
            const unlock = { id, date: new Date().toISOString() };
            state.unlockedAchievements.push(unlock);
            let bonus = achievement.type === 'silver' ? 250 : (achievement.type === 'gold' ? 500 : (achievement.type === 'special' ? 300 : 100));
            addXP(bonus, true); notify(`Achievement Unlocked: ${achievement.name}! 🏆`, 'PomoFlow', 'milestone');
        }
    };
    tryUnlock('first_steps', state.sessions.length >= 1);
    tryUnlock('habitual', currentStreak >= 3);
    tryUnlock('deep_diver', totalFocusMinutes >= 600);
    tryUnlock('unstoppable', totalFocusMinutes >= 6000);
    tryUnlock('architect', totalAimsReached >= 10);
    const hour = new Date().getHours();
    tryUnlock('night_owl', hour >= 0 && hour < 4 && !state.timerState.isRunning);
    tryUnlock('early_bird', hour >= 4 && hour < 7 && !state.timerState.isRunning);
    saveData();
}

function openSettings() {
    const p = document.getElementById('settingsPanel');
    const o = document.getElementById('settingsOverlay');
    const m = document.getElementById('menuDropdown'); if (m) m.classList.remove('open');
    closeFocusAreas(); closePlan();
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'general'));
    document.querySelectorAll('.settings-section').forEach(s => s.classList.toggle('active', s.id === 'tab-general'));
    p.classList.add('open'); o.classList.add('open');
    document.getElementById('templateIntent').value = state.settings.shareTemplates.intent;
    document.getElementById('templateSession').value = state.settings.shareTemplates.session;
    document.getElementById('templateMilestone').value = state.settings.shareTemplates.milestone;
    document.getElementById('templateMood').value = state.settings.shareTemplates.mood;
    document.getElementById('workDuration').value = state.settings.workDuration;
    document.getElementById('workDurationValue').textContent = `${state.settings.workDuration} min`;
    document.getElementById('shortBreakDuration').value = state.settings.shortBreakDuration;
    document.getElementById('shortBreakDurationValue').textContent = `${state.settings.shortBreakDuration} min`;
    document.getElementById('longBreakDuration').value = state.settings.longBreakDuration;
    document.getElementById('longBreakDurationValue').textContent = `${state.settings.longBreakDuration} min`;
    document.getElementById('sessionsBeforeLongBreak').value = state.settings.sessionsBeforeLongBreak;
    document.getElementById('autoStartBreaks').className = `setting-toggle ${state.settings.autoStartBreaks ? 'active' : ''}`;
    document.getElementById('autoStartWork').className = `setting-toggle ${state.settings.autoStartWork ? 'active' : ''}`;
    document.getElementById('timeFormat').className = `setting-toggle ${state.settings.use12Hour ? 'active' : ''}`;
    document.getElementById('soundVolume').value = state.settings.soundVolume;
    document.getElementById('soundVolumeValue').textContent = `${state.settings.soundVolume}%`;
}

function closeSettings() {
    const p = document.getElementById('settingsPanel');
    const o = document.getElementById('settingsOverlay');
    p.classList.remove('open'); o.classList.remove('open');
    state.settings.workDuration = parseInt(document.getElementById('workDuration').value);
    state.settings.shortBreakDuration = parseInt(document.getElementById('shortBreakDuration').value);
    state.settings.longBreakDuration = parseInt(document.getElementById('longBreakDuration').value);
    state.settings.sessionsBeforeLongBreak = parseInt(document.getElementById('sessionsBeforeLongBreak').value);
    state.settings.autoStartBreaks = document.getElementById('autoStartBreaks').classList.contains('active');
    state.settings.autoStartWork = document.getElementById('autoStartWork').classList.contains('active');
    state.settings.use12Hour = document.getElementById('timeFormat').classList.contains('active');
    state.settings.soundVolume = parseInt(document.getElementById('soundVolume').value);
    state.settings.shareTemplates.intent = document.getElementById('templateIntent').value;
    state.settings.shareTemplates.session = document.getElementById('templateSession').value;
    state.settings.shareTemplates.milestone = document.getElementById('templateMilestone').value;
    state.settings.shareTemplates.mood = document.getElementById('templateMood').value;
    saveData(); if (!state.timerState.isRunning) applyMode(state.timerState.mode); updateDateTime();
}

let confirmResolve = null;
function confirmAction(msg) {
    document.getElementById('confirmMessage').textContent = msg;
    document.getElementById('confirmModal').classList.add('open');
    return new Promise(res => { confirmResolve = res; });
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.remove('open');
    if (confirmResolve) confirmResolve(false);
    confirmResolve = null;
}

function openSessionEditModal(s) {
    editingSessionId = s.id;
    document.getElementById('sessionEditFocusAreaName').textContent = s.taskName;
    document.getElementById('sessionEditDuration').value = Math.round(s.duration / 60);
    document.getElementById('sessionEditModal').classList.add('open');
}

function closeSessionEditModal() {
    document.getElementById('sessionEditModal').classList.remove('open');
    editingSessionId = null;
}

function saveSessionFromModal() {
    const dur = parseInt(document.getElementById('sessionEditDuration').value); if (isNaN(dur) || dur < 1) return;
    const s = state.sessions.find(x => x.id === editingSessionId);
    if (s) {
        const old = s.duration; s.duration = dur * 60;
        if (s.taskId) {
            const t = state.tasks.find(x => x.id === s.taskId);
            if (t) t.totalTime = Math.max(0, t.totalTime - old + s.duration);
        }
        saveData(); renderFocusAreas(); renderHistory(currentFilter); updateStats(); closeSessionEditModal();
    }
}

function openFocusAreaEditModal(t) {
    editingTaskId = t.id;
    state.editTaskColor = t.color;
    document.getElementById('focusAreaEditName').value = t.name;
    document.getElementById('focusAreaEditCategory').value = t.category || 'Uncategorized';
    document.getElementById('focusAreaEditColorPicker').querySelectorAll('.color-dot').forEach(d => d.classList.toggle('active', d.dataset.color === t.color));
    document.getElementById('focusAreaEditModal').classList.add('open');
}

function closeFocusAreaEditModal() {
    document.getElementById('focusAreaEditModal').classList.remove('open');
    editingTaskId = null;
}

function saveFocusAreaFromModal() {
    const name = document.getElementById('focusAreaEditName').value.trim();
    const cat = document.getElementById('focusAreaEditCategory').value; if (!name) return;
    const t = state.tasks.find(x => x.id === editingTaskId);
    if (t) {
        t.name = name; t.category = cat; t.color = state.editTaskColor;
        state.sessions.forEach(s => { if (s.taskId === t.id) { s.taskName = t.name; s.taskColor = t.color; } });
        saveData(); renderFocusAreas(); renderHistory(currentFilter); updateTimerDisplay(); closeFocusAreaEditModal();
    }
}

function checkNotificationPrompt() {
    if (Notification.permission === 'default' && state.notificationPermission !== 'denied') {
        const p = document.getElementById('notificationPrompt'); if (p) p.style.display = 'flex';
    }
}

function requestNotificationPermission() {
    Notification.requestPermission().then(p => {
        state.notificationPermission = p;
        const pr = document.getElementById('notificationPrompt');
        if (pr) pr.style.display = 'none';
        if (p === 'granted') notify('Notifications enabled!');
    });
}

function notify(msg, title = 'PomoFlow', type = 'info') {
    const bg = document.visibilityState === 'hidden';
    if (!bg || type === 'milestone') showToast(msg, type);
    if (Notification.permission === 'granted' && (bg || type === 'milestone')) {
        try { new Notification(title, { body: msg, silent: false }); } catch (e) {}
    }
}

function showToast(msg, type = 'info') {
    const t = document.getElementById('toast'); if (!t) return;
    t.innerHTML = `<div class="toast-content">${msg}</div><div class="toast-progress-container"><div class="toast-progress"></div></div>`;
    t.className = `toast show ${type}`;
    if (t.timeout) clearTimeout(t.timeout);
    t.timeout = setTimeout(() => { t.classList.remove('show'); }, 5000);
}

function exportData() {
    const data = { tasks: state.tasks, sessions: state.sessions, settings: state.settings, exportDate: new Date().toISOString(), version: CURRENT_VERSION };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `pomoflow-data-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

let pendingImportData = null;
function handleImportFile(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const data = JSON.parse(event.target.result);
            if (!data.tasks || !data.sessions) throw new Error('Invalid format');
            pendingImportData = data;
            const info = document.getElementById('importInfo');
            if (info) info.innerHTML = `<p>Found <strong>${data.tasks.length}</strong> focus areas and <strong>${data.sessions.length}</strong> sessions.</p><p>Proceed?</p>`;
            const modal = document.getElementById('importModal'); if (modal) modal.classList.add('open');
        } catch (err) { alert('Error: ' + err.message); }
    };
    reader.readAsText(file);
}

function closeImportModal() {
    const modal = document.getElementById('importModal'); if (modal) modal.classList.remove('open');
    pendingImportData = null; const file = document.getElementById('importFile'); if (file) file.value = '';
}

function performImport(mode) {
    if (!pendingImportData) return;
    if (mode === 'replace') {
        state.tasks = pendingImportData.tasks; state.sessions = pendingImportData.sessions;
        if (pendingImportData.settings) state.settings = { ...state.settings, ...pendingImportData.settings };
    } else {
        const ids = new Set(state.tasks.map(t => t.id)); pendingImportData.tasks.forEach(t => { if (!ids.has(t.id)) state.tasks.push(t); });
        const sids = new Set(state.sessions.map(s => s.id)); pendingImportData.sessions.forEach(s => { if (!sids.has(s.id)) state.sessions.push(s); });
    }
    saveData(); renderFocusAreas(); renderHistory(currentFilter); updateStats(); closeImportModal(); notify('Data imported');
}

function initTheme() {
    let theme = document.documentElement.getAttribute('data-theme');
    if (!theme) {
        const saved = localStorage.getItem('flowtracker_theme');
        const sys = window.matchMedia('(prefers-color-scheme: dark)').matches;
        theme = saved || (sys ? 'dark' : 'light');
    }
    document.documentElement.setAttribute('data-theme', theme);
    const toggle = document.getElementById('themeToggle'); 
    if (toggle) toggle.classList.toggle('dark', theme === 'dark');
}

function toggleTheme() {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    if (dbManager.initialized) {
        dbManager.setAppState('theme', next);
    } else if (dbManager.disabled) {
        localStorage.setItem('flowtracker_theme', next);
    }
    const toggle = document.getElementById('themeToggle'); 
    if (toggle) toggle.classList.toggle('dark', next === 'dark');
}

function restoreTimerState() {
    if (state.timerState.isRunning && state.timerState.targetEndTime) {
        const now = Date.now(); const diff = state.timerState.targetEndTime - now;
        if (diff > 0) {
            state.timerState.remainingTime = Math.ceil(diff / 1000); initTimerWorker();
            timerWorker.postMessage({ action: 'start', endTime: state.timerState.targetEndTime }); updateTimerDisplay();
        } else { state.timerState.remainingTime = 0; handleSessionComplete(); }
    } else { updateTimerDisplay(); }
}

function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }

function clearHistory() {
    confirmAction('Are you sure you want to clear all session history?').then(conf => {
        if (conf) { state.sessions = []; saveData(); renderHistory(currentFilter); updateStats(); }
    });
}

function populateCustomFocusAreaSelect(query = '') {
    const container = document.getElementById('selectOptions');
    const nores = document.getElementById('selectNoResults');
    if (!container) return;

    const filtered = state.tasks.filter(t => !t.completed && t.name.toLowerCase().includes(query.toLowerCase()));
    container.innerHTML = '';

    if (filtered.length === 0) {
        nores.style.display = 'block';
    } else {
        nores.style.display = 'none';
        
        // Group by category
        const groups = {};
        filtered.forEach(t => {
            const cat = t.category || 'Uncategorized';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(t);
        });

        // Sort categories to keep a consistent order
        const sortedCats = Object.keys(groups).sort();
        
        sortedCats.forEach(cat => {
            // Add category header
            const header = document.createElement('div');
            header.className = 'select-category-header';
            header.textContent = cat;
            container.appendChild(header);

            // Add focus areas in this category
            groups[cat].forEach(t => {
                const isSelected = state.selectedFocusAreaIds.includes(t.id);
                const opt = document.createElement('div');
                opt.className = `select-option ${isSelected ? 'selected' : ''}`;
                opt.innerHTML = `<div class="option-color" style="background: ${t.color}"></div><div class="option-name">${escapeHtml(t.name)}</div><div class="option-check"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></div>`;
                opt.onclick = (e) => { e.stopPropagation(); toggleFocusAreaSelection(t.id); };
                container.appendChild(opt);
            });
        });
    }
}

function toggleFocusAreaSelection(id) {
    const idx = state.selectedFocusAreaIds.indexOf(id);
    if (idx > -1) state.selectedFocusAreaIds.splice(idx, 1);
    else state.selectedFocusAreaIds.push(id);
    updateCustomSelectUI();
    const search = document.getElementById('focusAreaSearchInput');
    populateCustomFocusAreaSelect(search ? search.value : '');
}

function updateCustomSelectUI() {
    const text = document.querySelector('.trigger-text'); const badge = document.getElementById('selectedCountBadge'); if (!text || !badge) return;
    const count = state.selectedFocusAreaIds.length;
    if (count === 0) { text.textContent = 'Select Focus Areas...'; badge.style.display = 'none'; }
    else if (count === 1) { const t = state.tasks.find(x => x.id === state.selectedFocusAreaIds[0]); text.textContent = t ? t.name : '1 Focus Area Selected'; badge.textContent = '1'; badge.style.display = 'inline-block'; }
    else { text.textContent = `${count} Focus Areas Selected`; badge.textContent = count; badge.style.display = 'inline-block'; }
}

function parseDuration(val) {
    val = val.toLowerCase().trim(); if (!val) return 0; let m = 0;
    if (val.includes(':')) { const p = val.split(':'); m = (parseInt(p[0]) || 0) * 60 + (parseInt(p[1]) || 0); }
    else if (val.includes('h')) { const p = val.split('h'); m += (parseFloat(p[0]) || 0) * 60; if (p[1]) m += parseFloat(p[1].replace('min', '').replace('m', '').trim()) || 0; }
    else m = parseFloat(val) || 0; return Math.round(m);
}

function addAim() {
    const input = document.getElementById('aimDurationInput'); const wrap = document.querySelector('.aim-input-row'); const raw = input.value.trim().toLowerCase();
    if (state.selectedFocusAreaIds.length === 0) { notify('Please select at least one focus area'); return; }
    if (!raw) { if (wrap) { wrap.classList.add('shake'); setTimeout(() => wrap.classList.remove('shake'), 400); } notify('Please enter a duration'); return; }
    const mins = parseDuration(raw); if (mins <= 0) { notify('Invalid duration'); return; }
    const type = document.getElementById('aimDeadlineSelect').value; let date = null;
    if (type !== 'infinite') {
        const d = new Date(); if (type === 'today') date = getLogicalDate(); else if (type === 'tomorrow') { d.setDate(d.getDate() + 1); date = getLogicalDate(d); }
        else if (type === 'week') { const day = d.getDay(); d.setDate(d.getDate() + (7 - day) % 7); date = getLogicalDate(d); }
        else if (type === 'custom') date = document.getElementById('aimCustomDate').value;
    }
    state.selectedFocusAreaIds.forEach(id => {
        const ex = getActiveAimForFocusArea(id); if (ex) { ex.targetMinutes = mins; ex.deadline = date; }
        else state.aims.push({ id: Date.now().toString() + '-' + id, focusAreaId: id, targetMinutes: mins, createdAt: new Date().toISOString(), deadline: date });
    });
    input.value = ''; state.selectedFocusAreaIds = []; updateCustomSelectUI(); document.getElementById('aimDeadlineSelect').value = 'infinite'; document.getElementById('aimCustomDate').style.display = 'none';
    
    // Auto-collapse
    const wrapper = document.getElementById('planCreateWrapper');
    const btn = document.getElementById('togglePlanCreate');
    if (wrapper && btn) {
        wrapper.classList.remove('open');
        btn.classList.remove('active');
    }

    renderPlan(); renderFocusAreas(); updateTimerDisplay(); notify('Aim(s) added to plan');
}

function renderPlan() {
    const list = document.getElementById('todayPlanList'); const past = document.getElementById('pastPlanList'); if (!list || !past) return;
    const active = []; const done = [];
    state.aims.forEach(a => { if (getTimeSpentOnAim(a) >= a.targetMinutes * 60) done.push(a); else active.push(a); });
    const renderAim = (a) => {
        const t = state.tasks.find(x => x.id === a.focusAreaId); const name = t ? t.name : 'Unknown Focus Area'; const color = t ? t.color : '#58a6ff';
        const spent = getTimeSpentOnAim(a); const target = a.targetMinutes * 60; const h = Math.floor(a.targetMinutes / 60); const m = a.targetMinutes % 60; const str = h > 0 ? `${h}h ${m}m` : `${m}m`;
        let dl = 'Until Done'; let exp = false;
        if (a.deadline) { const today = getLogicalDate(); dl = a.deadline === today ? 'by Today' : `by ${new Date(a.deadline).toLocaleDateString('en-US', {month:'short', day:'numeric'})}`; if (a.deadline < today) exp = true; }
        const item = document.createElement('sliding-card'); const reached = spent >= target;
        item.className = `plan-aim-item ${reached ? 'reached' : ''} ${exp && !reached ? 'expired' : ''}`;
        item.setAttribute('menu-width', reached ? '150px' : '100px');

        const editIcon = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
        const deleteIcon = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
        const shareIcon = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92c0-1.61-1.31-2.92-2.92-2.92z"/></svg>';
        const budgetIcon = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>';
        const againIcon = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1L7 6l5 4V7c3.31 0 6 2.69 6 6 0 2.97-2.17 5.43-5 5.91v2.02c3.95-.49 7-3.85 7-7.93 0-4.42-3.58-8-8-8zm-6 8c0-2.97 2.17-5.43 5-5.91V5.07c-3.95.49-7 3.85-7 7.93 0 4.42 3.58 8 8 8v-4c-3.31 0-6-2.69-6-6z"/></svg>';

        item.innerHTML = `
            ${reached ? `
                <button slot="menu" class="share-milestone-btn">${shareIcon}<span>Share</span></button>
                <button slot="menu" class="edit-btn">${budgetIcon}<span>Re-budget</span></button>
                <button slot="menu" class="go-again-btn">${againIcon}<span>Go Again</span></button>
            ` : `
                <button slot="menu" class="edit-btn">${editIcon}<span>Edit</span></button>
            `}
            <button slot="menu" class="danger delete-btn">${deleteIcon}<span>Delete</span></button>
            <div slot="indicator" class="history-type-indicator" style="background: ${color}; margin-right: 12px;"></div>
            <div class="aim-info">
                <div class="aim-top-row">
                    <div class="aim-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
                </div>
                <div class="aim-bottom-row">
                    <progress-compact value="${spent}" max="${target}" color="${color}" label="${str}"></progress-compact>
                    <div class="aim-meta"><span>${str}</span></div>
                    <div class="aim-deadline-badge ${exp ? 'expired' : ''}">${dl}</div>
                </div>
            </div>
        `;

        if (item.querySelector('.edit-btn')) item.querySelector('.edit-btn').onclick = () => { item.isOpen = false; editAim(a.id); };
        if (item.querySelector('.go-again-btn')) item.querySelector('.go-again-btn').onclick = () => { item.isOpen = false; goAgain(a.id); };
        if (item.querySelector('.share-milestone-btn')) item.querySelector('.share-milestone-btn').onclick = () => { item.isOpen = false; handleShare('x', 'milestone', { focusArea: name, duration: a.targetMinutes }); };
        item.querySelector('.delete-btn').onclick = () => { item.isOpen = false; removeAim(a.id); };
        return item;
    };
    list.innerHTML = ''; active.forEach(a => list.appendChild(renderAim(a)));
    past.innerHTML = ''; done.forEach(a => past.appendChild(renderAim(a)));
}

function goAgain(aimId) {
    const a = state.aims.find(x => x.id === aimId);
    if (!a) return;

    // 1. Open creation section if closed
    const wrapper = document.getElementById('planCreateWrapper');
    const btn = document.getElementById('togglePlanCreate');
    if (wrapper && !wrapper.classList.contains('open')) {
        wrapper.classList.add('open');
        if (btn) btn.classList.add('active');
    }

    // 2. Auto-populate
    state.selectedFocusAreaIds = [a.focusAreaId];
    updateCustomSelectUI();
    populateCustomFocusAreaSelect();

    const durationInput = document.getElementById('aimDurationInput');
    if (durationInput) {
        durationInput.value = a.targetMinutes;
    }

    const deadlineSelect = document.getElementById('aimDeadlineSelect');
    if (deadlineSelect) {
        // Find if previous deadline was a specific type or custom
        if (!a.deadline) deadlineSelect.value = 'infinite';
        else {
            // Check if it matches today/tomorrow logic roughly, or just set to custom if it's a fixed date string
            const today = getLogicalDate();
            if (a.deadline === today) deadlineSelect.value = 'today';
            else deadlineSelect.value = 'custom';
            
            const customDateInput = document.getElementById('aimCustomDate');
            if (customDateInput) {
                customDateInput.value = a.deadline;
                customDateInput.style.display = deadlineSelect.value === 'custom' ? 'inline-block' : 'none';
            }
        }
    }

    // 3. Scroll to top
    const panel = document.getElementById('planPanel');
    if (panel) {
        panel.scrollTo({ top: 0, behavior: 'smooth' });
    }
    
    if (durationInput) durationInput.focus();
}

function removeAim(id) { confirmAction('Delete this aim?').then(conf => { if (conf) { state.aims = state.aims.filter(x => x.id !== id); saveData(); renderPlan(); renderFocusAreas(); updateTimerDisplay(); } }); }
function editAim(id) {
    const a = state.aims.find(x => x.id === id);
    if (!a) return;
    const val = prompt('Adjust target (min or h:mm):', a.targetMinutes);
    if (val) {
        a.targetMinutes = parseDuration(val);
        a.updatedAt = new Date().toISOString();
        saveData();
        renderPlan();
        renderFocusAreas();
        updateTimerDisplay();
    }
}

document.querySelectorAll('.setting-slider').forEach(s => s.oninput = () => { const v = document.getElementById(`${s.id}Value`); if (v) v.textContent = s.id === 'soundVolume' ? `${s.value}%` : `${s.value} min`; });
document.querySelectorAll('.setting-toggle').forEach(t => t.onclick = () => t.classList.toggle('active'));

// Start initialization and ensure it finishes before any other operations
(async () => {
    try {
        await init();
    } catch (e) {
        console.error('Final initialization failed:', e);
    }
})();
