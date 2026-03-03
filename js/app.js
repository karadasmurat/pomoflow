const STORAGE_KEYS = {
    TASKS: 'flowtracker_tasks',
    SESSIONS: 'flowtracker_sessions',
    AIMS: 'flowtracker_aims',
    SETTINGS: 'flowtracker_settings',
    STATE: 'flowtracker_state',
    VERSION: 'flowtracker_version',
    NOTIFICATION_PROMPT: 'flowtracker_notification_prompt',
    PROFILE: 'flowtracker_profile'
};

const CURRENT_VERSION = 1;

let state = {
    tasks: [],
    sessions: [],
    aims: [],
    settings: {
        workDuration: 25,
        shortBreakDuration: 5,
        longBreakDuration: 15,
        sessionsBeforeLongBreak: 4,
        autoStartBreaks: false,
        autoStartWork: false,
        soundVolume: 70,
        use12Hour: false
    },
    currentTask: null,
    timerState: {
        mode: 'work',
        isRunning: false,
        remainingTime: 25 * 60,
        totalTime: 25 * 60,
        sessionCount: 0,
        cycleStation: 1,
        startTime: null,
        targetEndTime: null,
        activeTaskId: null
    },
    notificationPermission: 'default',
    lastSessionId: null,
    lastTaskId: null,
    selectedTaskColor: '#58a6ff',
    editTaskColor: '#58a6ff',
    selectedGoalIds: [],
    xp: 0,
    totalXp: 0,
    level: 1,
    avatar: '🦉'
};

let timerWorker = null;
let audioContext = null;

function initTimerWorker() {
    if (timerWorker) return;
    
    const workerCode = `
        let timerInterval = null;
        let endTime = null;

        self.onmessage = function(e) {
            if (e.data.action === 'start') {
                endTime = e.data.endTime;
                if (timerInterval) clearInterval(timerInterval);
                
                timerInterval = setInterval(() => {
                    const now = Date.now();
                    const remaining = Math.max(0, Math.ceil((endTime - now) / 1000));
                    
                    self.postMessage({ 
                        action: 'tick', 
                        remaining: remaining 
                    });
                    
                    if (remaining <= 0) {
                        clearInterval(timerInterval);
                    }
                }, 500);
            } else if (e.data.action === 'stop') {
                if (timerInterval) clearInterval(timerInterval);
            }
        };
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    timerWorker = new Worker(URL.createObjectURL(blob));
    
    timerWorker.onmessage = function(e) {
        if (e.data.action === 'tick') {
            state.timerState.remainingTime = e.data.remaining;
            if (state.timerState.remainingTime <= 0) {
                state.timerState.remainingTime = 0;
                state.timerState.isRunning = false;
                state.timerState.targetEndTime = null;
                handleSessionComplete();
            } else {
                updateTimerDisplay();
                if (state.timerState.remainingTime % 10 === 0) saveData();
            }
        }
    };

    timerWorker.onerror = function(err) {
        console.error('Worker Error:', err);
    };
}
let currentFilter = 'today';
let showAllHistory = false;

function init() {
    loadData();
    setupEventListeners();
    renderTasks();
    renderHistory('today');
    renderPlan();
    updateLevelUI();

    const todayBtn = document.querySelector('.filter-btn[data-filter="today"]');    if (todayBtn) {
        document.querySelectorAll('.history-filters .filter-btn').forEach(b => b.classList.remove('active'));
        todayBtn.classList.add('active');
    }

    updateTimerDisplay();
    updateStats();
    updateDateTime();
    setInterval(updateDateTime, 1000);
    try { checkNotificationPrompt(); } catch(e) {}
    restoreTimerState();
    initTheme();
}

function loadData() {
    try {
        const version = localStorage.getItem(STORAGE_KEYS.VERSION);
        if (!version || parseInt(version) !== CURRENT_VERSION) {
            localStorage.setItem(STORAGE_KEYS.VERSION, CURRENT_VERSION);
        }

        const profile = localStorage.getItem(STORAGE_KEYS.PROFILE);
        if (profile) {
            const savedProfile = JSON.parse(profile);
            state.xp = savedProfile.xp || 0;
            state.totalXp = savedProfile.totalXp || 0;
            state.level = savedProfile.level || 1;
            state.avatar = savedProfile.avatar || '🦉';
        }

        const tasks = localStorage.getItem(STORAGE_KEYS.TASKS);
        if (tasks) {
            state.tasks = JSON.parse(tasks);
            state.tasks.forEach(t => {
                if (!t.color) t.color = '#58a6ff';
            });
        }

        const sessions = localStorage.getItem(STORAGE_KEYS.SESSIONS);
        if (sessions) {
            state.sessions = JSON.parse(sessions);
            state.sessions.forEach(s => {
                if (!s.taskColor) s.taskColor = '#58a6ff';
            });
        }

        const aims = localStorage.getItem(STORAGE_KEYS.AIMS);
        if (aims) {
            state.aims = JSON.parse(aims);
        } else if (tasks) {
            // Migration: Move existing dailyAimMinutes to today's aims
            const today = new Date().toISOString().split('T')[0];
            state.tasks.forEach(t => {
                if (t.dailyAimMinutes > 0) {
                    state.aims.push({
                        id: Date.now().toString() + '-' + t.id,
                        goalId: t.id,
                        date: today,
                        targetMinutes: t.dailyAimMinutes
                    });
                    delete t.dailyAimMinutes;
                }
            });
            saveData();
        }

        const settings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
        if (settings) state.settings = { ...state.settings, ...JSON.parse(settings) };

        const savedState = localStorage.getItem(STORAGE_KEYS.STATE);
        if (savedState) {
            const timerState = JSON.parse(savedState);
            state.timerState = { ...state.timerState, ...timerState };
            if (!state.timerState.cycleStation) state.timerState.cycleStation = 1;
        }
    } catch (e) {
        console.error('Error loading data:', e);
    }
}

function saveData() {
    try {
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
            avatar: state.avatar
        }));
    } catch (e) {
        console.error('Error saving data:', e);
        if (e.name === 'QuotaExceededError') {
            alert('Storage is full. Consider clearing old session history.');
        }
    }
}

function getLogicalDate(date = new Date()) {
    const timestamp = date instanceof Date ? date.getTime() : new Date(date).getTime();
    // Shift the "logical day" by 4 hours. 
    // This means 00:00 - 03:59 still counts as the previous day.
    const shifted = new Date(timestamp - (4 * 60 * 60 * 1000));
    return shifted.toISOString().split('T')[0];
}

function getActiveAimForGoal(goalId) {
    // Find the most recent aim for this goal
    const aims = state.aims.filter(a => a.goalId === goalId);
    if (aims.length === 0) return null;
    // Sort by createdAt descending to get the newest one
    return aims.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
}

function getTodayAimForGoal(goalId) {
    const aim = getActiveAimForGoal(goalId);
    return aim ? aim.targetMinutes : 0;
}

function setTodayAimForGoal(goalId, minutes) {
    const existingAim = getActiveAimForGoal(goalId);
    
    if (minutes <= 0) {
        if (existingAim) {
            state.aims = state.aims.filter(a => a.id !== existingAim.id);
        }
    } else {
        if (existingAim) {
            existingAim.targetMinutes = minutes;
        } else {
            state.aims.push({
                id: Date.now().toString(),
                goalId: goalId,
                targetMinutes: minutes,
                createdAt: new Date().toISOString()
            });
        }
    }
    saveData();
}

function getTimeSpentOnAim(aim) {
    if (!aim) return 0;
    return state.sessions
        .filter(s => s.taskId === aim.goalId && new Date(s.timestamp) >= new Date(aim.createdAt))
        .reduce((acc, s) => acc + s.duration, 0);
}

function openTasks() {
    const taskPanel = document.getElementById('taskPanel');
    const taskOverlay = document.getElementById('taskOverlay');
    const planPanel = document.getElementById('planPanel');
    const planOverlay = document.getElementById('planOverlay');
    const menuDropdown = document.getElementById('menuDropdown');

    // Close plan if open
    closePlan();
    if (menuDropdown) menuDropdown.classList.remove('open');

    if (taskPanel) taskPanel.classList.add('open');
    if (taskOverlay) taskOverlay.classList.add('open');
}

function closeTasks() {
    const taskPanel = document.getElementById('taskPanel');
    const taskOverlay = document.getElementById('taskOverlay');
    if (taskPanel) taskPanel.classList.remove('open');
    if (taskOverlay) taskOverlay.classList.remove('open');
}

function openPlan() {
    const planPanel = document.getElementById('planPanel');
    const planOverlay = document.getElementById('planOverlay');
    const menuDropdown = document.getElementById('menuDropdown');
    const selectDropdown = document.getElementById('selectDropdown');

    // Close tasks if open
    closeTasks();
    if (menuDropdown) menuDropdown.classList.remove('open');
    if (selectDropdown) selectDropdown.classList.remove('open');

    state.selectedGoalIds = [];
    updateCustomSelectUI();
    populateCustomGoalSelect();
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
function setupEventListeners() {
    const taskLink = document.getElementById('taskLink');
    const tasksNavBtn = document.getElementById('tasksNavBtn');
    const closeTaskPanel = document.getElementById('closeTaskPanel');
    const taskOverlay = document.getElementById('taskOverlay');
    const taskPanel = document.getElementById('taskPanel');

    const planNavBtn = document.getElementById('planNavBtn');
    const closePlanPanel = document.getElementById('closePlanPanel');
    const planOverlay = document.getElementById('planOverlay');
    const planPanel = document.getElementById('planPanel');
    const clearAimsBtn = document.getElementById('clearAimsBtn');

    const menuBtn = document.getElementById('menuBtn');
    const menuDropdown = document.getElementById('menuDropdown');

    const headerAvatar = document.getElementById('headerAvatar');
    if (headerAvatar) {
        headerAvatar.addEventListener('click', openSettings);
    }

    if (menuBtn && menuDropdown) {
        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            menuDropdown.classList.toggle('open');
        });

        document.addEventListener('click', (e) => {
            if (!menuDropdown.contains(e.target) && e.target !== menuBtn) {
                menuDropdown.classList.remove('open');
            }
        });
    }

    if (taskLink) taskLink.addEventListener('click', openTasks);
    if (tasksNavBtn) tasksNavBtn.addEventListener('click', openTasks);
    if (planNavBtn) planNavBtn.addEventListener('click', openPlan);

    // Custom Select Event Listeners
    const selectTrigger = document.getElementById('selectTrigger');
    if (selectTrigger) {
        selectTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdown = document.getElementById('selectDropdown');
            const searchInput = document.getElementById('goalSearchInput');
            if (dropdown) {
                dropdown.classList.toggle('open');
                if (dropdown.classList.contains('open') && searchInput) {
                    searchInput.value = '';
                    populateCustomGoalSelect();
                    searchInput.focus();
                }
            }
        });
    }

    const goalSearchInput = document.getElementById('goalSearchInput');
    if (goalSearchInput) {
        goalSearchInput.addEventListener('input', (e) => {
            populateCustomGoalSelect(e.target.value);
        });
        goalSearchInput.addEventListener('click', (e) => e.stopPropagation());
    }

    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('selectDropdown');
        const customSelect = document.getElementById('customGoalSelect');
        if (dropdown && !customSelect.contains(e.target)) {
            dropdown.classList.remove('open');
        }
    });

    if (closeTaskPanel) {
        closeTaskPanel.addEventListener('click', () => {
            closeTasks();
        });
    }

    if (taskOverlay) {
        taskOverlay.addEventListener('click', () => {
            closeTasks();
        });
    }

    if (closePlanPanel) {
        closePlanPanel.addEventListener('click', () => {
            closePlan();
        });
    }

    if (planOverlay) {
        planOverlay.addEventListener('click', () => {
            closePlan();
        });
    }

    if (clearAimsBtn) clearAimsBtn.addEventListener('click', clearAims);

    document.getElementById('taskInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addTask();
    });
    
    document.getElementById('addTaskBtn').addEventListener('click', function(e) {
        e.preventDefault();
        addTask();
    });

    document.getElementById('addAimBtn').addEventListener('click', addAim);
    document.getElementById('aimDurationInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addAim();
    });

    const deadlineSelect = document.getElementById('aimDeadlineSelect');
    const customDateInput = document.getElementById('aimCustomDate');
    if (deadlineSelect && customDateInput) {
        deadlineSelect.addEventListener('change', () => {
            customDateInput.style.display = deadlineSelect.value === 'custom' ? 'inline-block' : 'none';
        });
    }

    const inlineColorBtn = document.getElementById('inlineColorBtn');
    const selectedColorCircle = document.getElementById('selectedColorCircle');
    const inlineColorDropdown = document.getElementById('inlineColorDropdown');
    
    if (inlineColorBtn && inlineColorDropdown) {
        inlineColorBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            inlineColorDropdown.classList.toggle('open');
        });

        inlineColorDropdown.querySelectorAll('.color-dot').forEach(dot => {
            dot.addEventListener('click', (e) => {
                e.stopPropagation();
                const color = dot.dataset.color;
                state.selectedTaskColor = color;
                if (selectedColorCircle) selectedColorCircle.style.background = color;
                inlineColorDropdown.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
                dot.classList.add('active');
                inlineColorDropdown.classList.remove('open');
            });
        });

        document.addEventListener('click', () => {
            inlineColorDropdown.classList.remove('open');
        });
    }

    const editColorPicker = document.getElementById('taskEditColorPicker');
    if (editColorPicker) {
        editColorPicker.querySelectorAll('.color-dot').forEach(dot => {
            dot.addEventListener('click', () => {
                editColorPicker.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
                dot.classList.add('active');
                state.editTaskColor = dot.dataset.color;
            });
        });
    }
    
    document.getElementById('startPauseBtn').addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        toggleTimer();
    });
    
    document.getElementById('resetBtn').addEventListener('click', function(e) {
        e.preventDefault();
        resetTimer();
    });
    document.getElementById('skipBtn').addEventListener('click', function(e) {
        e.preventDefault();
        skipSession();
    });
    document.getElementById('clearHistoryBtn').addEventListener('click', clearHistory);

    document.querySelectorAll('.mode-tab').forEach(tab => {
        tab.addEventListener('click', () => switchMode(tab.dataset.mode));
    });

    document.querySelectorAll('.history-filters .filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.history-filters .filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderHistory(currentFilter);
        });
    });

    const showAllBtn = document.querySelector('.history-show-all-container .filter-btn');
    if (showAllBtn) {
        showAllBtn.addEventListener('click', () => {
            showAllHistory = !showAllHistory;
            renderHistory(currentFilter);
        });
    }

    document.getElementById('settingsBtn').addEventListener('click', openSettings);
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);
    document.getElementById('closeSettings').addEventListener('click', closeSettings);
    document.getElementById('saveSettings').addEventListener('click', () => {
        notify('Settings saved');
        closeSettings();
    });
    document.getElementById('settingsOverlay').addEventListener('click', (e) => {
        if (e.target.id === 'settingsOverlay') closeSettings();
    });

    document.getElementById('exportData').addEventListener('click', exportData);
    document.getElementById('importFile').addEventListener('change', handleImportFile);
    document.getElementById('importData').addEventListener('click', () => {
        document.getElementById('importFile').click();
    });

    // Avatar Selection
    document.querySelectorAll('.avatar-option').forEach(opt => {
        opt.addEventListener('click', () => {
            state.avatar = opt.dataset.avatar;
            document.querySelectorAll('.avatar-option').forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            saveData();
            updateLevelUI();
        });
    });

    document.getElementById('closeImport').addEventListener('click', closeImportModal);
    document.getElementById('importReplace').addEventListener('click', () => performImport('replace'));
    document.getElementById('importMerge').addEventListener('click', () => performImport('merge'));
    document.getElementById('importModal').addEventListener('click', (e) => {
        if (e.target.id === 'importModal') closeImportModal();
    });

    document.getElementById('closeSessionEdit').addEventListener('click', closeSessionEditModal);
    document.getElementById('cancelSessionEdit').addEventListener('click', closeSessionEditModal);
    document.getElementById('saveSessionEdit').addEventListener('click', saveSessionFromModal);
    document.getElementById('sessionEditModal').addEventListener('click', (e) => {
        if (e.target.id === 'sessionEditModal') closeSessionEditModal();
    });
    document.getElementById('sessionEditDuration').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveSessionFromModal();
        if (e.key === 'Escape') closeSessionEditModal();
    });

    document.getElementById('closeTaskEdit').addEventListener('click', closeTaskEditModal);
    document.getElementById('cancelTaskEdit').addEventListener('click', closeTaskEditModal);
    document.getElementById('saveTaskEdit').addEventListener('click', saveTaskFromModal);
    document.getElementById('taskEditModal').addEventListener('click', (e) => {
        if (e.target.id === 'taskEditModal') closeTaskEditModal();
    });
    document.getElementById('taskEditName').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveTaskFromModal();
        if (e.key === 'Escape') closeTaskEditModal();
    });

    document.getElementById('confirmCancel').addEventListener('click', () => {
        closeConfirmModal();
    });
    document.getElementById('confirmOk').addEventListener('click', () => {
        document.getElementById('confirmModal').classList.remove('open');
        if (confirmResolve) {
            confirmResolve(true);
            confirmResolve = null;
        }
    });
    document.getElementById('confirmModal').addEventListener('click', (e) => {
        if (e.target.id === 'confirmModal') closeConfirmModal();
    });

    document.getElementById('clearTask').addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent opening the task panel
        if (state.timerState.isRunning) {
             confirmAction('Clearing the goal will reset the timer. Continue?').then(confirmed => {
                if (confirmed) {
                    state.timerState.activeTaskId = null;
                    resetTimer();
                }
            });
        } else {
            state.timerState.activeTaskId = null;
            updateTimerDisplay();
        }
    });

    document.getElementById('enableNotifications').addEventListener('click', () => {
        requestNotificationPermission();
    });
    document.getElementById('denyNotifications').addEventListener('click', () => {
        state.notificationPermission = 'denied';
        localStorage.setItem(STORAGE_KEYS.NOTIFICATION_PROMPT, 'denied');
        const prompt = document.getElementById('notificationPrompt');
        if (prompt) prompt.style.display = 'none';
    });
    document.getElementById('requestNotifyManual').addEventListener('click', () => {
        requestNotificationPermission();
    });
    document.getElementById('testNotify').addEventListener('click', () => {
        notify('This is a test notification! It works.', 'PomoFlow Test', 'milestone');
    });

    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT') return;
        
        if (e.code === 'Space') {
            e.preventDefault();
            toggleTimer();
        } else if (e.key.toLowerCase() === 'r') {
            resetTimer();
        } else if (e.key.toLowerCase() === 'n') {
            skipSession();
        } else if (e.key.toLowerCase() === 'g') {
            const taskPanel = document.getElementById('taskPanel');
            if (taskPanel.classList.contains('open')) {
                closeTasks();
            } else {
                openTasks();
            }
        } else if (e.key.toLowerCase() === 'p') {
            const planPanel = document.getElementById('planPanel');
            if (planPanel.classList.contains('open')) {
                closePlan();
            } else {
                openPlan();
            }
        } else if (e.key === '1') {
            switchMode('work');
        } else if (e.key === '2') {
            switchMode('shortBreak');
        } else if (e.key === '3') {
            switchMode('longBreak');
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            restoreTimerState();
        }
    });
}

function switchMode(mode) {
    if (state.timerState.mode === mode) return;
    
    if (state.timerState.isRunning) {
        confirmAction('Switching modes will reset the current timer. Continue?').then(confirmed => {
            if (confirmed) {
                const msgEl = document.getElementById('timerMessage');
                if (msgEl) msgEl.textContent = '';
                applyMode(mode);
            }
        });
    } else {
        const msgEl = document.getElementById('timerMessage');
        if (msgEl) msgEl.textContent = '';
        applyMode(mode);
    }
}

function applyMode(mode) {
    state.timerState.mode = mode;
    state.timerState.isRunning = false;
    state.timerState.targetEndTime = null;
    
    if (mode === 'work') {
        state.timerState.totalTime = state.settings.workDuration * 60;
    } else if (mode === 'shortBreak') {
        state.timerState.totalTime = state.settings.shortBreakDuration * 60;
    } else if (mode === 'longBreak') {
        state.timerState.totalTime = state.settings.longBreakDuration * 60;
    }
    
    state.timerState.remainingTime = state.timerState.totalTime;
    
    if (timerWorker) {
        timerWorker.postMessage({ action: 'stop' });
    }
    
    updateTimerDisplay();
    saveData();
}

function toggleTimer() {
    if (state.timerState.isRunning) {
        pauseTimer();
    } else {
        startTimer();
    }
}

function startTimer() {
    if (state.timerState.isRunning) return;
    
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } else if (audioContext.state === 'suspended') {
        audioContext.resume();
    }

    const msgEl = document.getElementById('timerMessage');
    if (msgEl) msgEl.textContent = '';

    state.timerState.isRunning = true;
    state.timerState.startTime = state.timerState.startTime || Date.now();
    state.timerState.targetEndTime = Date.now() + (state.timerState.remainingTime * 1000);
    
    updateTimerDisplay();
    
    initTimerWorker();
    if (timerWorker) {
        timerWorker.postMessage({ 
            action: 'start', 
            endTime: state.timerState.targetEndTime 
        });
    }
}

function pauseTimer() {
    state.timerState.isRunning = false;
    state.timerState.targetEndTime = null;
    if (timerWorker) {
        timerWorker.postMessage({ action: 'stop' });
    }
    updateTimerDisplay();
    saveData();
}

function resetTimer() {
    pauseTimer();
    state.timerState.startTime = null;
    const msgEl = document.getElementById('timerMessage');
    if (msgEl) msgEl.textContent = '';
    applyMode(state.timerState.mode);
    renderHistory(currentFilter);
}

function skipSession() {
    const wasRunning = state.timerState.isRunning || (state.timerState.startTime !== null);
    if (!wasRunning) {
        const msgEl = document.getElementById('timerMessage');
        if (msgEl) msgEl.textContent = '';
        
        // Just move to next mode without guidance message
        let nextMode;
        if (state.timerState.mode === 'work') {
            if (state.timerState.cycleStation >= state.settings.sessionsBeforeLongBreak) {
                nextMode = 'longBreak';
            } else {
                nextMode = 'shortBreak';
            }
        } else {
            nextMode = 'work';
            if (state.timerState.mode === 'longBreak') {
                state.timerState.cycleStation = 1;
            } else {
                state.timerState.cycleStation++;
            }
        }
        applyMode(nextMode);
    } else {
        handleSessionComplete(true);
    }
}

function handleSessionComplete(skipped = false) {
    pauseTimer();
    state.timerState.startTime = null;
    
    const wasWork = state.timerState.mode === 'work';
    
    let nextMode;
    if (wasWork) {
        if (state.timerState.cycleStation >= state.settings.sessionsBeforeLongBreak) {
            nextMode = 'longBreak';
        } else {
            nextMode = 'shortBreak';
        }
    } else {
        nextMode = 'work';
    }

    const msgEl = document.getElementById('timerMessage');
    if (msgEl) {
        const finishTime = new Date().toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit', 
            hour12: state.settings.use12Hour 
        });
        
        const statusMsg = skipped 
            ? `Skipped ${wasWork ? 'Focus' : 'Break'}` 
            : `Finished ${wasWork ? 'Focus' : 'Break'} at ${finishTime}`;
            
        if (wasWork) {
            const breakType = nextMode === 'longBreak' ? 'long break' : 'break';
            msgEl.innerHTML = `<span class="msg-status">${statusMsg}</span><span class="msg-action">Let's start a ${breakType}!</span>`;
        } else {
            msgEl.innerHTML = `<span class="msg-status">${statusMsg}</span><span class="msg-action">Let's start focusing!</span>`;
        }
    }
    
    if (wasWork && !skipped) {
        state.timerState.sessionCount++;
        saveSession();
        updateStats();
        
        // Timer Pulse Animation
        const timerContainer = document.querySelector('.timer-container');
        if (timerContainer) {
            timerContainer.classList.add('timer-pulse');
            setTimeout(() => timerContainer.classList.remove('timer-pulse'), 600);
        }

        playTone(440, 0.1, 0);
        setTimeout(() => playTone(880, 0.2, 0.1), 100);
        const duration = state.settings.workDuration * 60;
        const xpGained = Math.floor(duration / 60) * 10;
        setTimeout(() => {
            notify(`Focus session complete! +${xpGained} XP earned 🚀`, 'PomoFlow');
        }, 500);
    } else if (!wasWork && !skipped) {
        // Timer Pulse Animation
        const timerContainer = document.querySelector('.timer-container');
        if (timerContainer) {
            timerContainer.classList.add('timer-pulse');
            setTimeout(() => timerContainer.classList.remove('timer-pulse'), 600);
        }

        playTone(880, 0.1, 0);
        setTimeout(() => playTone(440, 0.2, 0.1), 100);
        setTimeout(() => {
            notify('Break is over! Ready to get back to work?', 'PomoFlow');
        }, 500);
    }

    if (!wasWork && !skipped) {
        if (state.timerState.mode === 'longBreak') {
            state.timerState.cycleStation = 1;
        } else {
            state.timerState.cycleStation++;
        }
    }
    
    applyMode(nextMode);
    renderHistory(currentFilter);
    
    const autoStart = (nextMode === 'work' && state.settings.autoStartWork) || 
                      (nextMode !== 'work' && state.settings.autoStartBreaks);
                      
    if (autoStart) {
        // Delay auto-start slightly to let sounds/animation breathe
        setTimeout(startTimer, 1500);
    }
}

function updateTimerDisplay() {
    const timeDisplay = document.getElementById('timerTime');
    const modeDisplay = document.getElementById('timerMode');
    const startPauseText = document.getElementById('startPauseText');
    const playIcon = document.getElementById('playIcon');
    const timerProgress = document.getElementById('timerProgress');
    const timerTaskDisplay = document.getElementById('timerTask');
    const timerTaskPrefix = document.getElementById('timerTaskPrefix');
    const sessionProgress = document.getElementById('sessionProgress');
    const timerMessage = document.getElementById('timerMessage');
    const timerDisplay = document.querySelector('.timer-display');
    const clearTaskBtn = document.getElementById('clearTask');
    const taskQuestion = document.getElementById('taskQuestion');
    
    const hasMsg = timerMessage && timerMessage.textContent.trim() !== '';
    // ... rest of time formatting ...
    
    const minutes = hasMsg ? 0 : Math.floor(Math.max(0, state.timerState.remainingTime) / 60);
    const seconds = hasMsg ? 0 : Math.max(0, state.timerState.remainingTime) % 60;
    const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    if (timeDisplay) timeDisplay.textContent = formattedTime;
    document.title = `${formattedTime} - PomoFlow`;
    
    const modeLabels = {
        work: 'Focus',
        shortBreak: 'Short Break',
        longBreak: 'Long Break'
    };
    
    if (modeDisplay) modeDisplay.textContent = modeLabels[state.timerState.mode];
    
    if (timerDisplay && timerMessage) {
        if (hasMsg) {
            timerDisplay.classList.add('has-message');
        } else {
            timerDisplay.classList.remove('has-message');
        }
    }

    const currentStationIndex = (state.timerState.cycleStation || 1) - 1;
    
    if (sessionProgress) {
        const dotCount = state.settings.sessionsBeforeLongBreak;
        const currentDots = sessionProgress.querySelectorAll('.progress-step');
        
        if (currentDots.length !== dotCount) {
            sessionProgress.innerHTML = '';
            for (let i = 0; i < dotCount; i++) {
                const dot = document.createElement('div');
                dot.className = 'progress-step';
                dot.dataset.step = i + 1;
                sessionProgress.appendChild(dot);
            }
        }

        const steps = sessionProgress.querySelectorAll('.progress-step');
        steps.forEach((step, index) => {
            step.classList.remove('active', 'completed');
            if (index === currentStationIndex) {
                step.classList.add('active');
            } else if (index < currentStationIndex) {
                step.classList.add('completed');
            }
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
    
    const startPauseBtn = document.getElementById('startPauseBtn');
    const taskLink = document.getElementById('taskLink');
    const hudEl = document.getElementById('goalProgressHUD');
    
    if (state.timerState.activeTaskId) {
        const task = state.tasks.find(t => t.id === state.timerState.activeTaskId);
        if (task) {
            if (timerTaskDisplay) {
                timerTaskDisplay.textContent = task.name;
                timerTaskDisplay.style.color = task.color;
            }
            if (taskQuestion) taskQuestion.textContent = 'Focusing on:';
            if (timerTaskPrefix) timerTaskPrefix.style.display = 'none';
            if (taskLink) taskLink.classList.add('has-task');
            if (clearTaskBtn) clearTaskBtn.style.display = 'flex';
            
            const todayAim = getTodayAimForGoal(task.id);
            if (hudEl) {
                hudEl.style.display = 'block';
                if (todayAim > 0) {
                    const todayTime = getTodayTimeForTask(task.id);
                    const hAim = Math.floor(todayAim / 60);
                    const mAim = todayAim % 60;
                    const aimStr = hAim > 0 ? `${hAim}h ${mAim}min` : `${mAim}min`;
                    
                    hudEl.innerHTML = `
                        <progress-compact 
                            value="${todayTime}" 
                            max="${todayAim * 60}" 
                            color="${task.color}" 
                            label="${aimStr}">
                        </progress-compact>
                    `;
                    hudEl.onclick = (e) => {
                        e.stopPropagation();
                        // Open Plan and select this task
                        openPlan();
                        if (state.timerState.activeTaskId) {
                            state.selectedGoalIds = [state.timerState.activeTaskId];
                            updateCustomSelectUI();
                            populateCustomGoalSelect();
                        }
                        
                        // Focus the duration input
                        const durInput = document.getElementById('aimDurationInput');
                        if (durInput) setTimeout(() => durInput.focus(), 300);
                    };
                } else {
                    hudEl.innerHTML = `
                        <div class="set-aim-cta">
                            <span class="set-aim-text">Set a target for today now.</span>
                            <div class="info-popover-wrapper">
                                <svg class="info-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
                                <div class="info-popover">Daily Aims are specific focus targets for today. They help you stay intentional without changing your overall goal.</div>
                            </div>
                        </div>
                    `;
                    hudEl.onclick = (e) => {
                        // Prevent click if clicking the info icon/popover specifically
                        if (e.target.closest('.info-popover-wrapper')) {
                            e.stopPropagation();
                            return;
                        }
                        e.stopPropagation();
                        
                        // Open Plan and select this task
                        openPlan();
                        if (state.timerState.activeTaskId) {
                            state.selectedGoalIds = [state.timerState.activeTaskId];
                            updateCustomSelectUI();
                            populateCustomGoalSelect();
                        }
                        
                        // Focus the duration input for quick entry
                        const durInput = document.getElementById('aimDurationInput');
                        if (durInput) setTimeout(() => durInput.focus(), 300);
                    };
                }
            }
            
            if (startPauseBtn) {
                startPauseBtn.style.color = task.color;
                const icon = startPauseBtn.querySelector('svg');
                if (icon) icon.style.fill = task.color;
            }
        }
    } else {
        if (taskQuestion) taskQuestion.textContent = 'What are you focusing on?';
        if (timerTaskDisplay) {
            timerTaskDisplay.innerHTML = `
                <span class="task-add-icon">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                    </svg>
                </span>
                <span class="task-placeholder-text">Goal</span>
            `;
            timerTaskDisplay.style.color = '';
        }
        if (timerTaskPrefix) timerTaskPrefix.style.display = 'none';
        if (taskLink) taskLink.classList.remove('has-task');
        if (hudEl) hudEl.style.display = 'none';
        if (clearTaskBtn) clearTaskBtn.style.display = 'none';
        
        if (startPauseBtn) {
            startPauseBtn.style.color = '';
            const icon = startPauseBtn.querySelector('svg');
            if (icon) icon.style.fill = '';
        }
    }
    
    const percent = (state.timerState.remainingTime / state.timerState.totalTime);
    const offset = 282.7 * (1 - percent);
    if (timerProgress) {
        timerProgress.style.strokeDashoffset = offset;
        timerProgress.className = 'timer-ring-progress';
        if (state.timerState.mode === 'work') timerProgress.classList.add('work');
        if (state.timerState.mode === 'shortBreak') timerProgress.classList.add('break');
        if (state.timerState.mode === 'longBreak') timerProgress.classList.add('long-break');
    }

    if (state.timerState.activeTaskId) {
        const taskRing = document.getElementById(`taskRing-${state.timerState.activeTaskId}`);
        if (taskRing) {
            taskRing.style.strokeDashoffset = offset;
            taskRing.className = 'task-ring-progress';
            if (state.timerState.mode === 'work') taskRing.classList.add('work');
            if (state.timerState.mode === 'shortBreak') taskRing.classList.add('break');
            if (state.timerState.mode === 'longBreak') taskRing.classList.add('long-break');
        }
    }
}

function addTask() {
    const input = document.getElementById('taskInput');
    const name = input.value.trim();
    
    if (name) {
        const task = {
            id: Date.now().toString(),
            name: name,
            color: state.selectedTaskColor,
            completed: false,
            createdAt: new Date().toISOString(),
            totalTime: 0
        };
        
        state.tasks.push(task);
        state.lastTaskId = task.id;
        input.value = '';
        saveData();
        renderTasks();
        
        const btn = document.getElementById('addTaskBtn');
        if (btn) {
            btn.style.background = 'var(--success)';
            setTimeout(() => btn.style.background = '', 500);
        }
    } else {
        const wrapper = document.querySelector('.task-input-wrapper');
        if (wrapper) {
            wrapper.classList.add('shake');
            setTimeout(() => wrapper.classList.remove('shake'), 400);
        }
    }
}

function formatDurationHM(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function getTodayTimeForTask(taskId) {
    const today = getLogicalDate();
    return state.sessions
        .filter(s => s.taskId === taskId && getLogicalDate(new Date(s.timestamp)) === today)
        .reduce((acc, s) => acc + s.duration, 0);
}

function getTotalTimeForTask(taskId) {
    return state.sessions
        .filter(s => s.taskId === taskId)
        .reduce((acc, s) => acc + s.duration, 0);
}

function renderTasks() {
    const list = document.getElementById('taskList');
    const taskSelectHeader = document.getElementById('taskSelectHeader');
    if (!list) return;
    list.innerHTML = '';
    
    if (state.tasks.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/></svg>
                <p>No goals yet. Add one above to start focusing.</p>
            </div>
        `;
        if (taskSelectHeader) taskSelectHeader.style.display = 'none';
        return;
    }
    
    if (taskSelectHeader) taskSelectHeader.style.display = 'block';
    
    const activeTasks = state.tasks.filter(t => !t.completed).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const completedTasks = state.tasks.filter(t => t.completed).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
        const renderTaskItem = (task) => {
        const item = document.createElement('div');
        const isNewSlide = task.id === state.lastTaskId;

        const createdAt = new Date(task.createdAt);
        const now = new Date();
        const isRecentlyCreated = (now - createdAt) < (24 * 60 * 60 * 1000);
        const newBadge = isRecentlyCreated && !task.completed ? '<span class="new-badge">NEW</span>' : '';

        const todaySeconds = getTodayTimeForTask(task.id);
        const totalSeconds = getTotalTimeForTask(task.id);
        
        item.className = `task-item ${isNewSlide ? 'slide-in' : ''} ${task.completed ? 'completed' : ''} ${state.timerState.activeTaskId === task.id ? 'active' : ''}`;

        const todayStr = formatDurationHM(todaySeconds);
        const totalStr = formatDurationHM(totalSeconds);

        item.innerHTML = `
            <div class="task-menu">
                <button class="edit-btn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.25L17.81 9.94l-3.25-3.25L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.25 3.25 1.83-1.83z"/></svg>
                    <span>Edit</span>
                </button>
                <button class="completed-btn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>
                    <span>${task.completed ? 'Undo' : 'Done'}</span>
                </button>
                <button class="danger delete-btn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                    <span>Delete</span>
                </button>
            </div>
            <div class="task-slide-wrapper">
                <button class="task-play-btn" style="color: ${task.color}">
                    <svg class="task-ring" viewBox="0 0 100 100">
                        <circle class="task-ring-bg" cx="50" cy="50" r="45"/>
                        <circle class="task-ring-progress" id="taskRing-${task.id}" cx="50" cy="50" r="45" 
                                stroke-dasharray="282.7" stroke-dashoffset="${state.timerState.activeTaskId === task.id ? 282.7 * (1 - (state.timerState.remainingTime / state.timerState.totalTime)) : 0}"/>
                    </svg>
                    <svg class="task-icon" viewBox="0 0 24 24"><path d="${state.timerState.activeTaskId === task.id && state.timerState.isRunning ? 'M6 19h4V5H6v14zm8-14v14h4V5h-4z' : 'M8 5v14l11-7z'}"/></svg>
                </button>
                <div class="task-info">
                    <div class="task-name">
                        <span class="task-text" style="color: ${task.color}">${escapeHtml(task.name)}</span>
                        ${newBadge}
                    </div>
                    <div class="task-stats-row">
                        <div class="task-stat-item">
                            <span class="stat-label">Today</span>
                            <span class="stat-value">${todayStr}</span>
                        </div>
                        <div class="task-stat-item">
                            <span class="stat-label">Total</span>
                            <span class="stat-value">${totalStr}</span>
                        </div>
                    </div>
                </div>
                <button class="task-more">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                </button>
            </div>
        `;

        let startX = 0;
        let currentTranslate = 0;
        let isSliding = false;
        const wrapper = item.querySelector('.task-slide-wrapper');
        
        wrapper.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            isSliding = true;
            wrapper.style.transition = 'none';
        }, {passive: true});
        
        wrapper.addEventListener('touchmove', (e) => {
            if (!isSliding) return;
            const diff = e.touches[0].clientX - startX;
            if (diff < 0) {
                currentTranslate = Math.max(diff, -160);
                wrapper.style.transform = `translateX(${currentTranslate}px)`;
            }
        }, {passive: true});
        
        wrapper.addEventListener('touchend', () => {
            isSliding = false;
            wrapper.style.transition = 'transform 0.2s ease';
            if (currentTranslate < -80) {
                item.classList.add('menu-open');
                wrapper.style.transform = 'translateX(-160px)';
            } else {
                item.classList.remove('menu-open');
                wrapper.style.transform = 'translateX(0)';
            }
            currentTranslate = 0;
        });

        item.querySelector('.task-more').addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = item.classList.toggle('menu-open');
            wrapper.style.transition = 'transform 0.2s ease';
            wrapper.style.transform = isOpen ? 'translateX(-160px)' : 'translateX(0)';
        });

        item.querySelector('.task-play-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (state.timerState.activeTaskId === task.id) {
                toggleTimer();
            } else {
                state.timerState.activeTaskId = task.id;
                applyMode('work');
                startTimer();
            }
            renderTasks();
            closeTasks();
        });

        item.querySelector('.task-info').addEventListener('click', (e) => {
            e.stopPropagation();
            if (state.timerState.activeTaskId !== task.id) {
                state.timerState.activeTaskId = task.id;
                applyMode('work');
                startTimer();
                renderTasks();
            }
            closeTasks();
        });

        item.querySelector('.edit-btn').addEventListener('click', () => {
            openTaskEditModal(task);
            item.classList.remove('menu-open');
            wrapper.style.transform = 'translateX(0)';
        });

        item.querySelector('.completed-btn').addEventListener('click', () => {
            toggleTaskComplete(task.id);
            item.classList.remove('menu-open');
            wrapper.style.transform = 'translateX(0)';
        });

        item.querySelector('.delete-btn').addEventListener('click', () => {
            deleteTask(task.id);
        });

        return item;
    };

    activeTasks.forEach(task => list.appendChild(renderTaskItem(task)));
    
    if (completedTasks.length > 0) {
        const completedHeader = document.createElement('div');
        completedHeader.className = 'task-section-header';
        completedHeader.textContent = 'Check off time';
        list.appendChild(completedHeader);
        completedTasks.forEach(task => list.appendChild(renderTaskItem(task)));
    }
    
    state.lastTaskId = null;
}

function toggleTaskComplete(id) {
    const task = state.tasks.find(t => t.id === id);
    if (task) {
        task.completed = !task.completed;
        if (task.completed && state.timerState.activeTaskId === id) {
            state.timerState.activeTaskId = null;
            if (state.timerState.isRunning) pauseTimer();
        }
        saveData();
        renderTasks();
    }
}

function deleteTask(id) {
    confirmAction('Are you sure you want to delete this goal?').then(confirmed => {
        if (confirmed) {
            state.tasks = state.tasks.filter(t => t.id !== id);
            if (state.timerState.activeTaskId === id) {
                state.timerState.activeTaskId = null;
                if (state.timerState.isRunning) pauseTimer();
            }
            saveData();
            renderTasks();
        }
    });
}

function saveSession() {
    const session = {
        id: Date.now().toString(),
        taskId: state.timerState.activeTaskId,
        taskName: 'Unknown Goal',
        taskColor: '#58a6ff',
        duration: state.settings.workDuration * 60,
        timestamp: new Date().toISOString()
    };

    if (state.timerState.activeTaskId) {
        const task = state.tasks.find(t => t.id === state.timerState.activeTaskId);
        if (task) {
            task.totalTime += session.duration;
            session.taskName = task.name;
            session.taskColor = task.color;

            // Check for Aim Completion Bonus
            const aim = getActiveAimForGoal(task.id);
            if (aim && !aim.completedBonusAwarded) {
                const spentSeconds = getTimeSpentOnAim(aim);
                const targetSeconds = aim.targetMinutes * 60;

                if (spentSeconds >= targetSeconds) {
                    aim.completedBonusAwarded = true;
                    const bonusAmount = 500;
                    addXP(bonusAmount, true);

                    // Visual feedback for bonus
                    setTimeout(() => {
                        const items = document.querySelectorAll('.plan-aim-item');
                        items.forEach(item => {
                            if (item.dataset.goalId === task.id) {
                                const bonusFloat = document.createElement('div');
                                bonusFloat.className = 'xp-float-bonus';
                                bonusFloat.textContent = `🎯 +${bonusAmount} XP BONUS`;
                                item.appendChild(bonusFloat);
                                setTimeout(() => bonusFloat.remove(), 2000);
                            }
                        });
                    }, 500);

                    notify(`Milestone Reached: +${bonusAmount} XP Bonus!`, 'PomoFlow', 'milestone');
                }
            }
        }
    }
    
    state.sessions.push(session);

    // Award standard XP: 10 XP per minute focused
    const xpGained = Math.floor(session.duration / 60) * 10;
    if (xpGained > 0) {
        addXP(xpGained);
    }

    saveData();
    renderTasks();
    renderHistory(currentFilter);
}

function addXP(amount, isBonus = false) {
    const oldTotalXp = state.totalXp;
    state.xp += amount;
    state.totalXp += amount;

    // XP Float Animation
    const xpDisplay = document.querySelector('.level-xp-display');
    if (xpDisplay && !isBonus) {
        const float = document.createElement('span');
        float.className = 'xp-float';
        float.textContent = `+${amount} XP`;
        xpDisplay.appendChild(float);
        setTimeout(() => float.remove(), 1500);
    }

    const xpToLevel = state.level * 1000;
    if (state.xp >= xpToLevel) {
        state.xp -= xpToLevel;
        state.level++;
        notify(`LEVEL UP! You are now Level ${state.level}`, 'PomoFlow', 'milestone');

        // Avatar Victory Animation
        const avatar = document.getElementById('headerAvatar');
        if (avatar) {
            avatar.classList.add('avatar-victory');
            setTimeout(() => avatar.classList.remove('avatar-victory'), 800);
        }

        // Success sound
        playTone(523.25, 0.1, 0); // C5
        setTimeout(() => playTone(659.25, 0.1, 0.1), 100); // E5
        setTimeout(() => playTone(783.99, 0.2, 0.2), 200); // G5
    }

    updateLevelUI(oldTotalXp);
}
function animateValue(obj, start, end, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.textContent = Math.floor(progress * (end - start) + start).toLocaleString();
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}

function updateLevelUI(previousTotalXp = null) {
    const xpEl = document.getElementById('userXP');
    const rankEl = document.getElementById('userRank');
    const headerAvatar = document.getElementById('headerAvatar');
    const levelContainer = document.getElementById('levelContainer');

    if (!xpEl || !rankEl) return;

    if (previousTotalXp !== null && previousTotalXp !== state.totalXp) {
        animateValue(xpEl, previousTotalXp, state.totalXp, 500);
    } else {
        xpEl.textContent = state.totalXp.toLocaleString();
    }

    if (levelContainer) levelContainer.title = `Level ${state.level}`;
    if (headerAvatar) headerAvatar.textContent = state.avatar || '🦉';

    const ranks = [        { min: 1, name: 'Novice' },
        { min: 5, name: 'Focused' },
        { min: 10, name: 'Deep Worker' },
        { min: 20, name: 'Flow State' },
        { min: 35, name: 'Master' },
        { min: 50, name: 'Zen Architect' }
    ];

    const currentRank = [...ranks].reverse().find(r => state.level >= r.min);
    rankEl.textContent = currentRank ? currentRank.name : 'Novice';
}

function renderHistory(filter = 'today') {
    const list = document.getElementById('historyList');
    if (!list) return;
    
    // Header HTML
    const headerHTML = `
        <div class="history-header-grid sticky-header">
            <div class="history-header-indicator"></div>
            <div class="history-header-info">
                <div>GOAL</div>
                <div>DURATION</div>
                <div>CHECKED OFF AT</div>
            </div>
            <div class="history-header-more"></div>
        </div>
    `;

    let sessions = filterSessions(state.sessions, filter);
    
    if (sessions.length === 0) {
        list.innerHTML = headerHTML + '<div class="empty-state"><p>No sessions found for this period.</p></div>';
        renderChart([]);
        return;
    }
    
    sessions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    renderChart(sessions);
    
    // Clear list but start with header
    list.innerHTML = headerHTML;
    
    const displaySessions = showAllHistory ? sessions : sessions.slice(0, 4);

    displaySessions.forEach(session => {
        const item = document.createElement('div');
        item.className = 'history-item slide-in';

        const timeStr = formatTimestamp(new Date(session.timestamp));
        const durationMin = Math.round(session.duration / 60);

        item.innerHTML = `
            <div class="history-menu">
                <button class="edit-btn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.25L17.81 9.94l-3.25-3.25L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.25 3.25 1.83-1.83z"/></svg>
                    <span>Edit</span>
                </button>
                <button class="danger delete-btn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                    <span>Delete</span>
                </button>
            </div>
            <div class="history-slide-wrapper">
                <div class="history-type-indicator" style="background: ${session.taskColor || '#58a6ff'}"></div>
                <div class="history-info">
                    <div class="history-task">${escapeHtml(session.taskName)}</div>
                    <div class="history-duration">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zM12.5 7H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
                        ${durationMin} min
                    </div>
                    <div class="history-time">${timeStr}</div>
                </div>
                <button class="history-more">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                </button>
            </div>
        `;

        let startX = 0;
        let currentTranslate = 0;
        let isSliding = false;
        const wrapper = item.querySelector('.history-slide-wrapper');

        wrapper.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            isSliding = true;
            wrapper.style.transition = 'none';
        }, {passive: true});

        wrapper.addEventListener('touchmove', (e) => {
            if (!isSliding) return;
            const diff = e.touches[0].clientX - startX;
            if (diff < 0) {
                currentTranslate = Math.max(diff, -120);
                wrapper.style.transform = `translateX(${currentTranslate}px)`;
            }
        }, {passive: true});

        wrapper.addEventListener('touchend', () => {
            isSliding = false;
            wrapper.style.transition = 'transform 0.2s ease';
            if (currentTranslate < -60) {
                item.classList.add('menu-open');
                wrapper.style.transform = 'translateX(-120px)';
            } else {
                item.classList.remove('menu-open');
                wrapper.style.transform = 'translateX(0)';
            }
            currentTranslate = 0;
        });

        item.querySelector('.history-more').addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = item.classList.toggle('menu-open');
            wrapper.style.transition = 'transform 0.2s ease';
            wrapper.style.transform = isOpen ? 'translateX(-120px)' : 'translateX(0)';
        });

        item.querySelector('.edit-btn').addEventListener('click', () => {
            openSessionEditModal(session);
            item.classList.remove('menu-open');
            wrapper.style.transform = 'translateX(0)';
        });

        item.querySelector('.delete-btn').addEventListener('click', () => {
            deleteSession(session.id);
        });

        list.appendChild(item);
    });

    const showAllBtn = document.querySelector('.history-show-all-container .filter-btn');
    if (showAllBtn) {
        const filterIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M4.25 5.61C6.27 8.2 10 13 10 13v6c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-6s3.72-4.8 5.74-7.39A.998.998 0 0 0 20.95 4H3.04a.998.998 0 0 0-.79 1.61z"/></svg>`;
        showAllBtn.innerHTML = showAllHistory ? 
            `${filterIcon} Show Less` : 
            `${filterIcon} Show All`;
        showAllBtn.style.display = sessions.length > 4 ? 'flex' : 'none';
    }}

function filterSessions(sessions, filter) {
    const now = new Date();
    
    if (filter === 'today') {
        const today = getLogicalDate(now);
        return sessions.filter(s => getLogicalDate(new Date(s.timestamp)) === today);
    } else if (filter === 'week') {
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const weekAgo = todayStart - (7 * 24 * 60 * 60 * 1000);
        return sessions.filter(s => new Date(s.timestamp).getTime() >= weekAgo);
    }
    return sessions;
}

function deleteSession(id) {
    confirmAction('Delete this session record?').then(confirmed => {
        if (confirmed) {
            const session = state.sessions.find(s => s.id === id);
            if (session && session.taskId) {
                const task = state.tasks.find(t => t.id === session.taskId);
                if (task) task.totalTime = Math.max(0, task.totalTime - session.duration);
            }
            state.sessions = state.sessions.filter(s => s.id !== id);
            saveData();
            renderTasks();
            renderHistory(currentFilter);
            updateStats();
        }
    });
}

function updateStats() {
    const today = getLogicalDate();
    const todaySessions = state.sessions.filter(s => getLogicalDate(new Date(s.timestamp)) === today);
    const totalSeconds = todaySessions.reduce((acc, s) => acc + s.duration, 0);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    
    const todayFocusTime = document.getElementById('todayFocusTime');
    if (todayFocusTime) todayFocusTime.textContent = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    const todaySessionsEl = document.getElementById('todaySessions');
    if (todaySessionsEl) todaySessionsEl.textContent = todaySessions.length;
    
    const streak = calculateStreak(state.sessions);
    const streakEl = document.getElementById('currentStreak');
    if (streakEl) streakEl.textContent = streak > 0 ? `${streak} days` : '--';
}

function calculateStreak(sessions) {
    if (sessions.length === 0) return 0;
    // Map sessions to logical dates to preserve streak for late-night workers
    const dates = [...new Set(sessions.map(s => getLogicalDate(new Date(s.timestamp))))]
        .map(d => new Date(d))
        .sort((a, b) => b - a);
    let streak = 0;
    let currentDateStr = getLogicalDate();
    let currentDate = new Date(currentDateStr);
    
    if (Math.floor((currentDate - dates[0]) / 86400000) > 1) return 0;
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
    container.innerHTML = '';
    if (sessions.length === 0) return;
    
    const taskData = {};
    sessions.forEach(s => {
        if (!taskData[s.taskName]) taskData[s.taskName] = { time: 0, color: s.taskColor || '#58a6ff' };
        taskData[s.taskName].time += s.duration;
    });
    
    const topTasks = Object.entries(taskData).sort((a, b) => b[1].time - a[1].time).slice(0, 5);
    const totalTime = sessions.reduce((acc, s) => acc + s.duration, 0);
    const chartSize = 140;
    const center = chartSize / 2;
    const radius = 60;
    let currentAngle = 0;
    
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${chartSize} ${chartSize}`);
    svg.classList.add('pie-chart');
    
    topTasks.forEach(([name, data]) => {
        const sliceAngle = (data.time / totalTime) * 360;
        if (sliceAngle >= 359.9) {
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', center); circle.setAttribute('cy', center);
            circle.setAttribute('r', radius); circle.setAttribute('fill', data.color);
            svg.appendChild(circle); return;
        }
        const x1 = center + radius * Math.cos(Math.PI * (currentAngle - 90) / 180);
        const y1 = center + radius * Math.sin(Math.PI * (currentAngle - 90) / 180);
        currentAngle += sliceAngle;
        const x2 = center + radius * Math.cos(Math.PI * (currentAngle - 90) / 180);
        const y2 = center + radius * Math.sin(Math.PI * (currentAngle - 90) / 180);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 ${sliceAngle > 180 ? 1 : 0} 1 ${x2} ${y2} Z`);
        path.setAttribute('fill', data.color); svg.appendChild(path);
    });
    
    const wrapper = document.createElement('div');
    wrapper.className = 'pie-chart-container';
    wrapper.appendChild(svg);
    const legend = document.createElement('div');
    legend.className = 'pie-legend';
    topTasks.forEach(([name, data]) => {
        const item = document.createElement('div');
        item.className = 'legend-item';
        item.innerHTML = `<div class="legend-color" style="background: ${data.color}"></div><div class="legend-label">${escapeHtml(name)}</div><div class="legend-value">${Math.round(data.time/60)}m (${Math.round(data.time/totalTime*100)}%)</div>`;
        legend.appendChild(item);
    });
    wrapper.appendChild(legend);
    container.appendChild(wrapper);
}

function updateDateTime() {
    const el = document.getElementById('datetime');
    if (!el) return;
    const now = new Date();
    const options = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: state.settings.use12Hour };
    el.textContent = now.toLocaleDateString('en-US', options).replace(',', '');
}

function formatTimestamp(date) {
    return date.toLocaleString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        hour: 'numeric', 
        minute: '2-digit', 
        hour12: state.settings.use12Hour 
    });
}

function openSettings() {
    const panel = document.getElementById('settingsPanel');
    const overlay = document.getElementById('settingsOverlay');
    if (!panel || !overlay) return;
    
    const menuDropdown = document.getElementById('menuDropdown');
    if (menuDropdown) menuDropdown.classList.remove('open');

    // Close other panels
    closeTasks();
    closePlan();

    panel.classList.add('open');

    overlay.classList.add('open');
    
    // Highlight active avatar
    document.querySelectorAll('.avatar-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.avatar === state.avatar);
    });
    
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
    document.getElementById('settingsPanel').classList.remove('open');
    document.getElementById('settingsOverlay').classList.remove('open');
    
    state.settings.workDuration = parseInt(document.getElementById('workDuration').value);
    state.settings.shortBreakDuration = parseInt(document.getElementById('shortBreakDuration').value);
    state.settings.longBreakDuration = parseInt(document.getElementById('longBreakDuration').value);
    state.settings.sessionsBeforeLongBreak = parseInt(document.getElementById('sessionsBeforeLongBreak').value);
    state.settings.autoStartBreaks = document.getElementById('autoStartBreaks').classList.contains('active');
    state.settings.autoStartWork = document.getElementById('autoStartWork').classList.contains('active');
    state.settings.use12Hour = document.getElementById('timeFormat').classList.contains('active');
    state.settings.soundVolume = parseInt(document.getElementById('soundVolume').value);
    saveData();
    if (!state.timerState.isRunning) applyMode(state.timerState.mode);
    updateDateTime();
}

let confirmResolve = null;
function confirmAction(message) {
    document.getElementById('confirmMessage').textContent = message;
    document.getElementById('confirmModal').classList.add('open');
    return new Promise(resolve => { confirmResolve = resolve; });
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.remove('open');
    if (confirmResolve) confirmResolve(false);
    confirmResolve = null;
}

let editingSessionId = null;
function openSessionEditModal(session) {
    editingSessionId = session.id;
    document.getElementById('sessionEditTaskName').textContent = session.taskName;
    document.getElementById('sessionEditDuration').value = Math.round(session.duration / 60);
    document.getElementById('sessionEditModal').classList.add('open');
}

function closeSessionEditModal() {
    document.getElementById('sessionEditModal').classList.remove('open');
    editingSessionId = null;
}

function saveSessionFromModal() {
    const duration = parseInt(document.getElementById('sessionEditDuration').value);
    if (isNaN(duration) || duration < 1) return;
    const session = state.sessions.find(s => s.id === editingSessionId);
    if (session) {
        const oldDuration = session.duration;
        session.duration = duration * 60;
        if (session.taskId) {
            const task = state.tasks.find(t => t.id === session.taskId);
            if (task) task.totalTime = Math.max(0, task.totalTime - oldDuration + session.duration);
        }
        saveData(); renderTasks(); renderHistory(currentFilter); updateStats(); closeSessionEditModal();
    }
}

let editingTaskId = null;
function openTaskEditModal(task) {
    editingTaskId = task.id;
    state.editTaskColor = task.color;
    document.getElementById('taskEditName').value = task.name;
    document.getElementById('taskEditColorPicker').querySelectorAll('.color-dot').forEach(dot => {
        dot.classList.toggle('active', dot.dataset.color === task.color);
    });
    document.getElementById('taskEditModal').classList.add('open');
}

function closeTaskEditModal() {
    document.getElementById('taskEditModal').classList.remove('open');
    editingTaskId = null;
}

function saveTaskFromModal() {
    const name = document.getElementById('taskEditName').value.trim();
    if (!name) return;
    const task = state.tasks.find(t => t.id === editingTaskId);
    if (task) {
        task.name = name; 
        task.color = state.editTaskColor;
        state.sessions.forEach(s => { if (s.taskId === task.id) { s.taskName = task.name; s.taskColor = task.color; } });
        saveData(); renderTasks(); renderHistory(currentFilter); updateTimerDisplay(); closeTaskEditModal();
    }
}

function checkNotificationPrompt() {
    if (Notification.permission === 'default' && localStorage.getItem(STORAGE_KEYS.NOTIFICATION_PROMPT) !== 'denied') {
        const prompt = document.getElementById('notificationPrompt');
        if (prompt) prompt.style.display = 'flex';
    }
}

function requestNotificationPermission() {
    Notification.requestPermission().then(permission => {
        console.log('Notification permission result:', permission);
        state.notificationPermission = permission;
        const prompt = document.getElementById('notificationPrompt');
        if (prompt) prompt.style.display = 'none';
        if (permission === 'granted') {
            notify('Notifications enabled! You will be alerted when focus ends.');
        }
    });
}

function notify(message, title = 'PomoFlow', type = 'info') {
    const isBackground = document.visibilityState === 'hidden';
    
    // Always try to show the internal toast if visible OR if it's a milestone
    if (!isBackground || type === 'milestone') {
        showToast(message, type);
    }
    
    // Push notification logic
    if (Notification.permission === 'granted') {
        // If background, or major milestone, send system notification
        if (isBackground || type === 'milestone') {
            try {
                new Notification(title, { 
                    body: message,
                    tag: 'pomoflow-notification-' + Date.now(), // Unique tag per notification
                    silent: false // Ensure system sound is played if allowed
                });
            } catch (err) {
                console.error('Notification Error:', err);
            }
        }
    } else if (isBackground || type === 'milestone') {
        // Only log if we intended to send a push but didn't have permission
        console.log('Notification permission state:', Notification.permission);
    }
}

function showToast(message, type = 'info') {
    const t = document.getElementById('toast'); 
    if (!t) return;
    
    t.textContent = message;
    t.className = `toast show ${type}`;
    
    if (t.timeout) clearTimeout(t.timeout);
    t.timeout = setTimeout(() => {
        t.classList.remove('show');
    }, 4000);
}

function playTone(freq, duration, delay) {
    if (!audioContext) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const vol = state.settings.soundVolume / 100;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, audioContext.currentTime + delay);
    gain.gain.setValueAtTime(0, audioContext.currentTime + delay);
    gain.gain.linearRampToValueAtTime(vol * 0.1, audioContext.currentTime + delay + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + delay + duration);
    osc.connect(gain); gain.connect(audioContext.destination);
    osc.start(audioContext.currentTime + delay); osc.stop(audioContext.currentTime + delay + duration);
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
            if (info) info.innerHTML = `<p>Found <strong>${data.tasks.length}</strong> goals and <strong>${data.sessions.length}</strong> sessions.</p><p>Proceed?</p>`;
            const modal = document.getElementById('importModal');
            if (modal) modal.classList.add('open');
        } catch (err) { alert('Error: ' + err.message); }
    };
    reader.readAsText(file);
}

function closeImportModal() { 
    const modal = document.getElementById('importModal');
    if (modal) modal.classList.remove('open'); 
    pendingImportData = null; 
    const file = document.getElementById('importFile');
    if (file) file.value = ''; 
}

function performImport(mode) {
    if (!pendingImportData) return;
    if (mode === 'replace') { 
        state.tasks = pendingImportData.tasks; 
        state.sessions = pendingImportData.sessions; 
        if (pendingImportData.settings) state.settings = { ...state.settings, ...pendingImportData.settings }; 
    } else {
        const taskIds = new Set(state.tasks.map(t => t.id));
        pendingImportData.tasks.forEach(t => { if (!taskIds.has(t.id)) state.tasks.push(t); });
        const sessionIds = new Set(state.sessions.map(s => s.id));
        pendingImportData.sessions.forEach(s => { if (!sessionIds.has(s.id)) state.sessions.push(s); });
    }
    saveData(); renderTasks(); renderHistory(currentFilter); updateStats(); closeImportModal(); notify('Data imported');
}

function initTheme() {
    const savedTheme = localStorage.getItem('flowtracker_theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = savedTheme || (systemPrefersDark ? 'dark' : 'light');
    
    document.documentElement.setAttribute('data-theme', theme);
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) themeToggle.classList.toggle('dark', theme === 'dark');

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        if (!localStorage.getItem('flowtracker_theme')) {
            const nextTheme = e.matches ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', nextTheme);
            if (themeToggle) themeToggle.classList.toggle('dark', nextTheme === 'dark');
        }
    });
}

function toggleTheme() {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('flowtracker_theme', next);
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) themeToggle.classList.toggle('dark', next === 'dark');
}

function restoreTimerState() {
    const msgEl = document.getElementById('timerMessage');
    if (msgEl) msgEl.textContent = '';

    if (state.timerState.isRunning && state.timerState.targetEndTime) {
        const now = Date.now();
        state.timerState.remainingTime = Math.max(0, Math.ceil((state.timerState.targetEndTime - now) / 1000));
        
        if (state.timerState.remainingTime > 0) {
            initTimerWorker();
            timerWorker.postMessage({ 
                action: 'start', 
                endTime: state.timerState.targetEndTime 
            });
            startTimer();
        } else {
            state.timerState.remainingTime = 0;
            state.timerState.targetEndTime = null;
            handleSessionComplete();
        }
    } else {
        updateTimerDisplay();
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function clearHistory() {
    confirmAction('Are you sure you want to clear all session history?').then(confirmed => {
        if (confirmed) {
            state.sessions = []; saveData(); renderHistory(currentFilter); updateStats();
        }
    });
}

function populateCustomGoalSelect(searchQuery = '') {
    const optionsContainer = document.getElementById('selectOptions');
    const noResults = document.getElementById('selectNoResults');
    if (!optionsContainer) return;
    
    const activeTasks = state.tasks.filter(t => !t.completed);
    const filteredTasks = activeTasks.filter(task => 
        task.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
    
    optionsContainer.innerHTML = '';
    
    if (filteredTasks.length === 0) {
        noResults.style.display = 'block';
    } else {
        noResults.style.display = 'none';
        filteredTasks.forEach(task => {
            const isSelected = state.selectedGoalIds.includes(task.id);
            const option = document.createElement('div');
            option.className = `select-option ${isSelected ? 'selected' : ''}`;
            option.innerHTML = `
                <div class="option-color" style="background: ${task.color}"></div>
                <div class="option-name">${escapeHtml(task.name)}</div>
                <div class="option-check">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                </div>
            `;
            
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleGoalSelection(task.id);
            });
            
            optionsContainer.appendChild(option);
        });
    }
}

function toggleGoalSelection(goalId) {
    const index = state.selectedGoalIds.indexOf(goalId);
    if (index > -1) {
        state.selectedGoalIds.splice(index, 1);
    } else {
        state.selectedGoalIds.push(goalId);
    }
    
    updateCustomSelectUI();
    const searchInput = document.getElementById('goalSearchInput');
    populateCustomGoalSelect(searchInput ? searchInput.value : '');
}

function updateCustomSelectUI() {
    const triggerText = document.querySelector('.trigger-text');
    const badge = document.getElementById('selectedCountBadge');
    if (!triggerText || !badge) return;

    const count = state.selectedGoalIds.length;

    if (count === 0) {
        triggerText.textContent = 'Select Goals...';
        badge.style.display = 'none';
    } else if (count === 1) {
        const task = state.tasks.find(t => t.id === state.selectedGoalIds[0]);
        triggerText.textContent = task ? task.name : '1 Goal Selected';
        badge.textContent = '1';
        badge.style.display = 'inline-block';
    } else {
        triggerText.textContent = `${count} Goals Selected`;
        badge.textContent = count;
        badge.style.display = 'inline-block';
    }
}
function parseDuration(val) {
    val = val.toLowerCase().trim();
    if (!val) return 0;
    
    let minutes = 0;
    if (val.includes(':')) {
        const parts = val.split(':');
        minutes = (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
    } else if (val.includes('h')) {
        const parts = val.split('h');
        minutes += (parseFloat(parts[0]) || 0) * 60;
        if (parts[1]) {
            const mPart = parts[1].replace('min', '').replace('m', '').trim();
            minutes += parseFloat(mPart) || 0;
        }
    } else {
        minutes = parseFloat(val) || 0;
    }
    return Math.round(minutes);
}

function addAim() {
    const durationInput = document.getElementById('aimDurationInput');
    const durationWrapper = document.querySelector('.aim-input-row');
    const durationRaw = durationInput.value.trim().toLowerCase();
    
    if (state.selectedGoalIds.length === 0) {
        notify('Please select at least one goal');
        return;
    }
    
    if (!durationRaw) {
        if (durationWrapper) {
            durationWrapper.classList.add('shake');
            setTimeout(() => durationWrapper.classList.remove('shake'), 400);
        }
        notify('Please enter a duration');
        return;
    }
    
    const minutes = parseDuration(durationRaw);
    
    if (minutes <= 0) {
        notify('Invalid duration');
        return;
    }
    
    const updatedGoalIds = [...state.selectedGoalIds];
    
    // Calculate Deadline
    const deadlineType = document.getElementById('aimDeadlineSelect').value;
    let deadlineDate = null;
    
    if (deadlineType !== 'infinite') {
        const d = new Date();
        if (deadlineType === 'today') {
            deadlineDate = getLogicalDate();
        } else if (deadlineType === 'tomorrow') {
            d.setDate(d.getDate() + 1);
            deadlineDate = getLogicalDate(d);
        } else if (deadlineType === 'week') {
            // End of current week (Sunday)
            const day = d.getDay();
            const diff = d.getDate() + (7 - day) % 7;
            d.setDate(diff);
            deadlineDate = getLogicalDate(d);
        } else if (deadlineType === 'custom') {
            const customVal = document.getElementById('aimCustomDate').value;
            if (customVal) deadlineDate = customVal;
        }
    }

    state.selectedGoalIds.forEach(goalId => {
        // Find existing aim
        const existingAim = getActiveAimForGoal(goalId);
        if (existingAim) {
            existingAim.targetMinutes = Math.round(minutes);
            existingAim.deadline = deadlineDate;
        } else {
            state.aims.push({
                id: Date.now().toString() + '-' + goalId,
                goalId: goalId,
                targetMinutes: Math.round(minutes),
                createdAt: new Date().toISOString(),
                deadline: deadlineDate
            });
        }
    });
    
    durationInput.value = '';
    state.selectedGoalIds = [];
    updateCustomSelectUI();
    
    const selectDropdown = document.getElementById('selectDropdown');
    if (selectDropdown) selectDropdown.classList.remove('open');
    
    const searchInput = document.getElementById('goalSearchInput');
    if (searchInput) searchInput.value = '';
    
    // Reset deadline fields
    document.getElementById('aimDeadlineSelect').value = 'infinite';
    document.getElementById('aimCustomDate').style.display = 'none';
    document.getElementById('aimCustomDate').value = '';
    
    renderPlan();
    renderTasks();
    updateTimerDisplay();
    
    // Highlight updated cards
    updatedGoalIds.forEach(goalId => {
        const items = document.querySelectorAll('.plan-aim-item');
        items.forEach(item => {
            // We need to find the item that matches this goalId
            // The item doesn't have a data attribute yet, we'll need to add it in renderAimItem
            if (item.dataset.goalId === goalId) {
                item.classList.add('highlight');
                setTimeout(() => item.classList.remove('highlight'), 1500);
                item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });
    });
    
    const btn = document.getElementById('addAimBtn');
    if (btn) {
        btn.style.background = 'var(--success)';
        btn.style.color = 'var(--text-on-accent)';
        setTimeout(() => {
            btn.style.background = '';
            btn.style.color = '';
        }, 500);
    }
    
    notify('Aim(s) added to plan');
}

function renderPlan() {
    const todayList = document.getElementById('todayPlanList');
    const pastList = document.getElementById('pastPlanList');
    if (!todayList || !pastList) return;

    // Group aims into Active and Completed (Reached)
    const activeAims = [];
    const completedAims = [];
    
    state.aims.forEach(aim => {
        const spentSeconds = getTimeSpentOnAim(aim);
        const targetSeconds = aim.targetMinutes * 60;
        if (spentSeconds >= targetSeconds) {
            completedAims.push(aim);
        } else {
            activeAims.push(aim);
        }
    });

    const renderAimItem = (aim) => {
        const task = state.tasks.find(t => t.id === aim.goalId);
        const name = task ? task.name : 'Unknown Goal';
        const color = task ? task.color : '#58a6ff';

        const spentSeconds = getTimeSpentOnAim(aim);
        const targetSeconds = aim.targetMinutes * 60;

        const hAim = Math.floor(aim.targetMinutes / 60);
        const mAim = aim.targetMinutes % 60;
        const aimStr = hAim > 0 ? `${hAim}h ${mAim}min` : `${mAim}min`;

        // Deadline Logic
        let deadlineLabel = 'Until Done';
        let isExpired = false;
        if (aim.deadline) {
            const today = getLogicalDate();
            if (aim.deadline === today) {
                deadlineLabel = 'by Today';
            } else {
                const d = new Date(aim.deadline);
                const options = { month: 'short', day: 'numeric' };
                deadlineLabel = `by ${d.toLocaleDateString('en-US', options)}`;
                if (aim.deadline < today) isExpired = true;
            }
        }

        const item = document.createElement('div');
        const rawProgress = (spentSeconds / targetSeconds) * 100;
        const reached = rawProgress >= 100;
        item.className = `plan-aim-item ${reached ? 'reached' : ''} ${isExpired && !reached ? 'expired' : ''}`;
        item.dataset.goalId = aim.goalId;

        item.innerHTML = `
            <div class="plan-aim-menu">
                <button class="edit-btn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.25L17.81 9.94l-3.25-3.25L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.25 3.25 1.83-1.83z"/></svg>
                    <span>Edit</span>
                </button>
                <button class="danger delete-btn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                    <span>Delete</span>
                </button>
            </div>
            <div class="plan-aim-slide-wrapper">
                <div class="history-type-indicator" style="background: ${color}; margin-right: 12px;"></div>
                <div class="aim-info">
                    <div class="aim-top-row">
                        <div class="aim-name">${escapeHtml(name)}</div>
                    </div>
                    <div class="aim-bottom-row">
                        <progress-compact 
                            value="${spentSeconds}" 
                            max="${targetSeconds}" 
                            color="${color}" 
                            label="${aimStr}">
                        </progress-compact>
                        <div class="aim-meta">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="opacity: 0.6;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-5.5-8c0-3.03 2.47-5.5 5.5-5.5s5.5 2.47 5.5 5.5-2.47 5.5-5.5 5.5-5.5-2.47-5.5-5.5z"/></svg>
                            <span class="aim-duration-label">${aimStr}</span>
                        </div>
                        <div class="aim-deadline-badge ${isExpired ? 'expired' : ''}">${deadlineLabel}</div>
                    </div>
                </div>
                <button class="plan-aim-more">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                </button>
            </div>
        `;

        // ... event listeners remain the same ...
        let startX = 0;
        let currentTranslate = 0;
        let isSliding = false;
        const wrapper = item.querySelector('.plan-aim-slide-wrapper');
        
        wrapper.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            isSliding = true;
            wrapper.style.transition = 'none';
        }, {passive: true});
        
        wrapper.addEventListener('touchmove', (e) => {
            if (!isSliding) return;
            const diff = e.touches[0].clientX - startX;
            if (diff < 0) {
                currentTranslate = Math.max(diff, -120);
                wrapper.style.transform = `translateX(${currentTranslate}px)`;
            }
        }, {passive: true});
        
        wrapper.addEventListener('touchend', () => {
            isSliding = false;
            wrapper.style.transition = 'transform 0.2s ease';
            if (currentTranslate < -60) {
                item.classList.add('menu-open');
                wrapper.style.transform = 'translateX(-120px)';
            } else {
                item.classList.remove('menu-open');
                wrapper.style.transform = 'translateX(0)';
            }
            currentTranslate = 0;
        });

        item.querySelector('.plan-aim-more').addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = item.classList.toggle('menu-open');
            wrapper.style.transition = 'transform 0.2s ease';
            wrapper.style.transform = isOpen ? 'translateX(-120px)' : 'translateX(0)';
        });

        item.querySelector('.edit-btn').addEventListener('click', () => {
            editAim(aim.id);
            item.classList.remove('menu-open');
            wrapper.style.transform = 'translateX(0)';
        });

        item.querySelector('.delete-btn').addEventListener('click', () => {
            removeAim(aim.id);
        });

        return item;
    };
    
    todayList.innerHTML = '';
    if (activeAims.length === 0) {
        todayList.innerHTML = '<p class="empty-plan">No active focus aims. Set one above!</p>';
    } else {
        activeAims.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                  .forEach(aim => todayList.appendChild(renderAimItem(aim)));
    }
    
    pastList.innerHTML = '';
    if (completedAims.length === 0) {
        pastList.innerHTML = '<p class="empty-plan">No completed aims yet.</p>';
    } else {
        completedAims.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                     .forEach(aim => pastList.appendChild(renderAimItem(aim)));
    }
}

function removeAim(aimId) {
    confirmAction('Delete this focus aim?').then(confirmed => {
        if (confirmed) {
            state.aims = state.aims.filter(a => a.id !== aimId);
            saveData();
            renderPlan();
            renderTasks();
            updateTimerDisplay();
            notify('Aim removed');
        }
    });
}

function editAim(aimId) {
    const aim = state.aims.find(a => a.id === aimId);
    if (!aim) return;
    
    const hAim = Math.floor(aim.targetMinutes / 60);
    const mAim = aim.targetMinutes % 60;
    const currentStr = hAim > 0 ? `${hAim}h ${mAim}min` : `${mAim}min`;
    
    const newAim = prompt('Adjust daily target (e.g. 45 or 1:30):', currentStr);
    if (newAim !== null) {
        const mins = parseDuration(newAim);
        
        if (mins > 0) {
            aim.targetMinutes = mins;
            saveData();
            renderPlan();
            renderTasks();
            updateTimerDisplay();
            notify('Aim updated');
        } else {
            notify('Invalid duration');
        }
    }
}

window.removeAim = removeAim;

function clearAims() {
    confirmAction('Clear all aims for today?').then(confirmed => {
        if (confirmed) {
            const today = getLogicalDate();
            state.aims = state.aims.filter(a => a.date !== today);
            saveData();
            renderPlan();
            renderTasks();
            updateTimerDisplay();
            notify('Today\'s plan cleared');
        }
    });
}

window.clearAims = clearAims;

document.querySelectorAll('.setting-slider').forEach(s => s.addEventListener('input', () => {
    const valEl = document.getElementById(`${s.id}Value`);
    if (valEl) valEl.textContent = s.id === 'soundVolume' ? `${s.value}%` : `${s.value} min`;
}));

document.querySelectorAll('.setting-toggle').forEach(t => t.addEventListener('click', () => t.classList.toggle('active')));

init();
