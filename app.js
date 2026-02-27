const STORAGE_KEYS = {
    TASKS: 'flowtracker_tasks',
    SESSIONS: 'flowtracker_sessions',
    SETTINGS: 'flowtracker_settings',
    STATE: 'flowtracker_state',
    VERSION: 'flowtracker_version',
    NOTIFICATION_PROMPT: 'flowtracker_notification_prompt'
};

const CURRENT_VERSION = 1;

let state = {
    tasks: [],
    sessions: [],
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
        startTime: null,
        activeTaskId: null
    },
    notificationPermission: 'default',
    lastSessionId: null,
    lastTaskId: null
};

let timerInterval = null;
let audioContext = null;
let currentFilter = 'today';
let showAllHistory = false;

function init() {
    loadData();
    setupEventListeners();
    renderTasks();
    renderHistory('today');
    
    // Explicitly activate Today filter btn on init
    const todayBtn = document.querySelector('.filter-btn[data-filter="today"]');
    if (todayBtn) {
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

        const tasks = localStorage.getItem(STORAGE_KEYS.TASKS);
        if (tasks) state.tasks = JSON.parse(tasks);

        const sessions = localStorage.getItem(STORAGE_KEYS.SESSIONS);
        if (sessions) state.sessions = JSON.parse(sessions);

        const settings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
        if (settings) state.settings = { ...state.settings, ...JSON.parse(settings) };

        const savedState = localStorage.getItem(STORAGE_KEYS.STATE);
        if (savedState) {
            const timerState = JSON.parse(savedState);
            state.timerState = { ...state.timerState, ...timerState };
        }
    } catch (e) {
        console.error('Error loading data:', e);
    }
}

function saveData() {
    try {
        localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(state.tasks));
        localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(state.sessions));
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(state.settings));
        localStorage.setItem(STORAGE_KEYS.STATE, JSON.stringify(state.timerState));
        localStorage.setItem(STORAGE_KEYS.VERSION, CURRENT_VERSION);
    } catch (e) {
        console.error('Error saving data:', e);
        if (e.name === 'QuotaExceededError') {
            alert('Storage is full. Consider clearing old session history.');
        }
    }
}

function setupEventListeners() {
    document.getElementById('taskInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addTask();
    });
    
    document.getElementById('addTaskBtn').addEventListener('click', function(e) {
        e.preventDefault();
        addTask();
    });
    
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
        showToast('Settings saved');
        closeSettings();
    });
    document.getElementById('settingsModal').addEventListener('click', (e) => {
        if (e.target.id === 'settingsModal') closeSettings();
    });

    document.getElementById('exportData').addEventListener('click', exportData);
    document.getElementById('importFile').addEventListener('change', handleImportFile);
    document.getElementById('importData').addEventListener('click', () => {
        document.getElementById('importFile').click();
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

    setupSettingsListeners();

    document.getElementById('enableNotifications').addEventListener('click', requestNotificationPermission);
    document.getElementById('denyNotifications').addEventListener('click', dismissNotificationPrompt);

    document.addEventListener('keydown', handleKeyboardShortcuts);
}

function setupSettingsListeners() {
    const sliders = {
        workDuration: { el: document.getElementById('workDuration'), display: document.getElementById('workDurationValue'), suffix: ' min' },
        shortBreakDuration: { el: document.getElementById('shortBreakDuration'), display: document.getElementById('shortBreakDurationValue'), suffix: ' min' },
        longBreakDuration: { el: document.getElementById('longBreakDuration'), display: document.getElementById('longBreakDurationValue'), suffix: ' min' },
        soundVolume: { el: document.getElementById('soundVolume'), display: document.getElementById('soundVolumeValue'), suffix: '%' }
    };

    if (sliders.workDuration.el) {
        sliders.workDuration.el.value = state.settings.workDuration;
        sliders.workDuration.display.textContent = state.settings.workDuration + sliders.workDuration.suffix;
        sliders.workDuration.el.addEventListener('input', (e) => {
            state.settings.workDuration = parseInt(e.target.value);
            sliders.workDuration.display.textContent = e.target.value + sliders.workDuration.suffix;
            if (state.timerState.mode === 'work' && !state.timerState.isRunning) {
                state.timerState.remainingTime = state.settings.workDuration * 60;
                state.timerState.totalTime = state.settings.workDuration * 60;
                updateTimerDisplay();
            }
            saveData();
        });
    }

    if (sliders.shortBreakDuration.el) {
        sliders.shortBreakDuration.el.value = state.settings.shortBreakDuration;
        sliders.shortBreakDuration.display.textContent = state.settings.shortBreakDuration + sliders.shortBreakDuration.suffix;
        sliders.shortBreakDuration.el.addEventListener('input', (e) => {
            state.settings.shortBreakDuration = parseInt(e.target.value);
            sliders.shortBreakDuration.display.textContent = e.target.value + sliders.shortBreakDuration.suffix;
            if (state.timerState.mode === 'shortBreak' && !state.timerState.isRunning) {
                state.timerState.remainingTime = state.settings.shortBreakDuration * 60;
                state.timerState.totalTime = state.settings.shortBreakDuration * 60;
                updateTimerDisplay();
            }
            saveData();
        });
    }

    if (sliders.longBreakDuration.el) {
        sliders.longBreakDuration.el.value = state.settings.longBreakDuration;
        sliders.longBreakDuration.display.textContent = state.settings.longBreakDuration + sliders.longBreakDuration.suffix;
        sliders.longBreakDuration.el.addEventListener('input', (e) => {
            state.settings.longBreakDuration = parseInt(e.target.value);
            sliders.longBreakDuration.display.textContent = e.target.value + sliders.longBreakDuration.suffix;
            if (state.timerState.mode === 'longBreak' && !state.timerState.isRunning) {
                state.timerState.remainingTime = state.settings.longBreakDuration * 60;
                state.timerState.totalTime = state.settings.longBreakDuration * 60;
                updateTimerDisplay();
            }
            saveData();
        });
    }

    if (sliders.soundVolume.el) {
        sliders.soundVolume.el.value = state.settings.soundVolume;
        sliders.soundVolume.display.textContent = state.settings.soundVolume + sliders.soundVolume.suffix;
        sliders.soundVolume.el.addEventListener('input', (e) => {
            state.settings.soundVolume = parseInt(e.target.value);
            sliders.soundVolume.display.textContent = e.target.value + sliders.soundVolume.suffix;
            saveData();
        });
    }

    const sessionsBeforeLongBreak = document.getElementById('sessionsBeforeLongBreak');
    if (sessionsBeforeLongBreak) {
        sessionsBeforeLongBreak.value = state.settings.sessionsBeforeLongBreak;
        sessionsBeforeLongBreak.addEventListener('change', (e) => {
            state.settings.sessionsBeforeLongBreak = Math.min(10, Math.max(1, parseInt(e.target.value) || 4));
            e.target.value = state.settings.sessionsBeforeLongBreak;
            saveData();
            updateTimerDisplay();
        });
    }

    const toggles = {
        autoStartBreaks: document.getElementById('autoStartBreaks'),
        autoStartWork: document.getElementById('autoStartWork'),
        timeFormat: document.getElementById('timeFormat')
    };

    if (toggles.autoStartBreaks && state.settings.autoStartBreaks) toggles.autoStartBreaks.classList.add('active');
    if (toggles.autoStartWork && state.settings.autoStartWork) toggles.autoStartWork.classList.add('active');
    if (toggles.timeFormat && state.settings.use12Hour) toggles.timeFormat.classList.add('active');

    Object.keys(toggles).forEach(key => {
        if (toggles[key]) {
            toggles[key].addEventListener('click', () => {
                toggles[key].classList.toggle('active');
                const isActive = toggles[key].classList.contains('active');
                toggles[key].setAttribute('aria-checked', isActive);
                if (key === 'timeFormat') {
                    state.settings.use12Hour = isActive;
                } else {
                    state.settings[key] = isActive;
                }
                saveData();
                updateDateTime();
            });
        }
    });
}

function handleKeyboardShortcuts(e) {
    if (e.target.tagName === 'INPUT') return;

    switch(e.key.toLowerCase()) {
        case ' ':
            e.preventDefault();
            toggleTimer();
            break;
        case 'r':
            resetTimer();
            break;
        case 'n':
            skipSession();
            break;
        case '1':
            switchMode('work');
            break;
        case '2':
            switchMode('shortBreak');
            break;
        case '3':
            switchMode('longBreak');
            break;
    }
}

function addTask() {
    const input = document.getElementById('taskInput');
    const name = input.value.trim();
    if (!name) {
        input.classList.add('shake');
        input.focus();
        setTimeout(() => input.classList.remove('shake'), 400);
        return;
    }

    const task = {
        id: Date.now(),
        name: name,
        completed: false,
        totalTime: 0,
        createdAt: Date.now()
    };

    state.tasks.push(task);
    state.lastTaskId = task.id;
    input.value = '';
    input.blur();
    saveData();
    renderTasks();
}

function renderTasks() {
    const list = document.getElementById('taskList');
    if (!list) return;

    const activeTasks = state.tasks.filter(t => !t.completed);
    const completedTasks = state.tasks.filter(t => t.completed);
    
    if (state.tasks.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2z"/></svg>
                <p>No tasks yet. Add one above to get started!</p>
            </div>
        `;
        return;
    }

    const renderTaskItem = (task) => {
        const isActive = state.currentTask === task.id;
        const isRunning = isActive && state.timerState.isRunning;
        const isCompleted = task.completed;
        const isNew = task.id === state.lastTaskId;
        return `
        <div class="task-item ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''} ${isNew ? 'slide-in highlight' : ''}" 
             data-id="${task.id}">
            <div class="task-slide-wrapper" onclick="selectTask(${task.id})">
                <div class="task-play-btn" onclick="event.stopPropagation(); toggleTaskTimer(${task.id})" title="${isRunning ? 'Pause timer' : 'Start timer'}">
                    <svg viewBox="0 0 24 24">${isRunning 
                        ? '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>' 
                        : '<path d="M8 5v14l11-7z"/>'}</svg>
                </div>
                <div class="task-info">
                    <div class="task-name" data-task-id="${task.id}">${escapeHtml(task.name)}</div>
                    <div class="task-time">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
                        <span>Total: ${formatTime(task.totalTime)}</span>
                    </div>
                </div>
                <button class="task-more" onclick="event.stopPropagation(); toggleTaskMenu(${task.id})" aria-label="More options">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                </button>
            </div>
            <div class="task-menu">
                <button onclick="event.stopPropagation(); editTask(${task.id})" aria-label="Edit">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                    <span>Edit</span>
                </button>
                <button class="${isCompleted ? 'completed' : ''}" onclick="event.stopPropagation(); toggleTaskComplete(${task.id})" aria-label="${isCompleted ? 'Mark incomplete' : 'Mark complete'}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                    <span>${isCompleted ? 'Undo' : 'Done'}</span>
                </button>
                <button class="danger" onclick="event.stopPropagation(); deleteTask(${task.id})" aria-label="Delete">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                    <span>Delete</span>
                </button>
            </div>
        </div>
    `};

    let html = '';
    
    if (activeTasks.length > 0) {
        html += [...activeTasks].reverse().map(renderTaskItem).join('');
    }
    
    if (completedTasks.length > 0) {
        html += `
            <div class="task-section-header">Completed</div>
        `;
        html += [...completedTasks].reverse().map(renderTaskItem).join('');
    }

    list.innerHTML = html;

    if (state.lastTaskId) {
        const newItem = list.querySelector('.slide-in');
        if (newItem) {
            newItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        state.lastTaskId = null;
    }

    const hint = document.getElementById('taskHint');
    if (hint) hint.style.display = state.currentTask ? 'none' : 'flex';
}

function selectTask(id, shouldStartTimer = false) {
    if (state.currentTask === id && !shouldStartTimer) {
        state.currentTask = null;
    } else {
        state.currentTask = id;
    }
    saveData();
    renderTasks();
    updateTimerDisplay();
    
    if (shouldStartTimer && !state.timerState.isRunning) {
        if (state.timerState.mode !== 'work') {
            switchMode('work');
        }
        setTimeout(() => startTimer(), 50);
    }
}

function toggleTaskTimer(id) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;
    
    if (task.completed) {
        task.completed = false;
    }
    
    const isActive = state.currentTask === id;
    const isRunning = isActive && state.timerState.isRunning;
    
    if (isRunning) {
        pauseTimer();
    } else {
        if (state.timerState.isRunning && id !== state.currentTask) {
            completeSession(true);
        }
        
        state.currentTask = id;
        state.timerState.activeTaskId = id;
        
        if (state.timerState.mode !== 'work') {
            switchMode('work');
        }
        if (!state.timerState.isRunning) {
            startTimer();
        }
    }
    saveData();
    renderTasks();
    updateTimerDisplay();
}

function toggleTaskComplete(id) {
    const task = state.tasks.find(t => t.id === id);
    if (task) {
        task.completed = !task.completed;
        if (task.completed && state.currentTask === id) {
            state.currentTask = null;
        }
        saveData();
        renderTasks();
        updateTimerDisplay();
    }
}

async function deleteTask(id) {
    const taskEl = document.querySelector(`.task-item[data-id="${id}"]`);
    if (!taskEl) return;
    
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;
    
    if (!await confirm(`Delete task "${task.name}"?`)) return;
    
    taskEl.classList.add('slide-out');
    
    setTimeout(() => {
        state.tasks = state.tasks.filter(t => t.id !== id);
        if (state.currentTask === id) {
            state.currentTask = null;
            if (state.timerState.isRunning) {
                resetTimer();
            }
        }
        saveData();
        renderTasks();
        updateTimerDisplay();
    }, 300);
}

function toggleTimer() {
    try {
        if (state.timerState.isRunning) {
            pauseTimer();
        } else {
            startTimer();
        }
    } catch(e) {
        console.error('toggleTimer error:', e);
    }
}

function startTimer() {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume();
        }
    } catch (e) {
        console.log('AudioContext not available:', e);
    }

    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        try { checkNotificationPrompt(); } catch(e) {}
    }

    state.timerState.isRunning = true;
    state.timerState.startTime = Date.now();
    state.timerState.activeTaskId = state.currentTask;

    timerInterval = setInterval(() => {
        state.timerState.remainingTime--;
        
        updateTimerDisplay();
        saveData();

        if (state.timerState.remainingTime <= 0) {
            completeSession();
        }
    }, 1000);

    const startPauseText = document.getElementById('startPauseText');
    if (startPauseText) startPauseText.textContent = 'Pause';
    
    const startPauseBtn = document.getElementById('startPauseBtn');
    if (startPauseBtn) startPauseBtn.classList.add('running');
    
    const playIcon = document.getElementById('playIcon');
    if (playIcon) playIcon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
    
    const timerPanel = document.querySelector('.timer-panel');
    if (timerPanel) timerPanel.classList.add('timer-running');
    
    saveData();
}

function pauseTimer() {
    state.timerState.isRunning = false;
    clearInterval(timerInterval);
    timerInterval = null;

    const startPauseText = document.getElementById('startPauseText');
    if (startPauseText) startPauseText.textContent = 'Start';
    
    const startPauseBtn = document.getElementById('startPauseBtn');
    if (startPauseBtn) startPauseBtn.classList.remove('running');
    
    const playIcon = document.getElementById('playIcon');
    if (playIcon) playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
    
    const timerPanel = document.querySelector('.timer-panel');
    if (timerPanel) timerPanel.classList.remove('timer-running');
    
    saveData();
    renderTasks();
}

function resetTimer() {
    pauseTimer();
    const mode = state.timerState.mode;
    const durations = {
        work: state.settings.workDuration,
        shortBreak: state.settings.shortBreakDuration,
        longBreak: state.settings.longBreakDuration
    };
    state.timerState.remainingTime = durations[mode] * 60;
    state.timerState.totalTime = durations[mode] * 60;
    state.timerState.activeTaskId = null;
    updateTimerDisplay();
    saveData();
}

function skipSession() {
    pauseTimer();
    advanceToNextSession();
}

function completeSession(forceComplete = false) {
    if (!forceComplete && state.timerState.remainingTime > 0) return;
    
    pauseTimer();
    
    if (!forceComplete) {
        playNotificationSound();
    }
    
    const elapsedTime = state.timerState.totalTime - state.timerState.remainingTime;
    
    if (elapsedTime > 0 && state.timerState.mode === 'work') {
        const task = state.tasks.find(t => t.id === state.timerState.activeTaskId);
        
        const session = {
            id: Date.now(),
            taskId: state.timerState.activeTaskId,
            taskName: task ? task.name : 'Untracked',
            type: state.timerState.mode,
            duration: elapsedTime,
            completedAt: new Date().toISOString()
        };
        
        state.sessions.push(session);
        state.lastSessionId = session.id;
        
        if (task) {
            task.totalTime += elapsedTime;
        }
        
        sendNotification(session);
        
        state.timerState.sessionCount++;
        
        saveData();
        renderTasks();
        renderHistory(currentFilter);
        updateStats();
    }
    
    if (forceComplete) {
        state.timerState.remainingTime = state.timerState.totalTime;
        updateTimerDisplay();
        saveData();
    } else {
        advanceToNextSession();

        if ((state.timerState.mode === 'work' && state.settings.autoStartBreaks) ||
            (state.timerState.mode !== 'work' && state.settings.autoStartWork)) {
            setTimeout(() => startTimer(), 1000);
        }
    }
}

function advanceToNextSession() {
    if (state.timerState.mode === 'work') {
        if (state.timerState.sessionCount >= state.settings.sessionsBeforeLongBreak) {
            switchMode('longBreak');
            state.timerState.sessionCount = 0;
        } else {
            switchMode('shortBreak');
        }
    } else {
        switchMode('work');
    }
    saveData();
}

function switchMode(mode) {
    pauseTimer();
    state.timerState.mode = mode;
    
    const durations = {
        work: state.settings.workDuration,
        shortBreak: state.settings.shortBreakDuration,
        longBreak: state.settings.longBreakDuration
    };

    state.timerState.remainingTime = durations[mode] * 60;
    state.timerState.totalTime = durations[mode] * 60;

    document.querySelectorAll('.mode-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.mode === mode);
    });

    updateTimerDisplay();
    saveData();
}

function updateTimerDisplay() {
    const minutes = Math.floor(state.timerState.remainingTime / 60);
    const seconds = state.timerState.remainingTime % 60;
    const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    const timerTime = document.getElementById('timerTime');
    if (timerTime) timerTime.textContent = timeStr;
    
    const timerAnnouncer = document.getElementById('timerAnnouncer');
    if (timerAnnouncer) timerAnnouncer.textContent = timeStr;

    const currentTaskEl = document.getElementById('timerTask');
    if (currentTaskEl) {
        if (state.currentTask) {
            const task = state.tasks.find(t => String(t.id) === String(state.currentTask));
            currentTaskEl.textContent = task ? `Current Focus: ${task.name}` : '';
        } else if (state.timerState.isRunning && state.timerState.mode === 'work') {
            currentTaskEl.textContent = 'Focus mode - select a task';
        } else {
            currentTaskEl.textContent = '';
        }
    }

    const modeLabels = {
        work: 'Focus',
        shortBreak: 'Short Break',
        longBreak: 'Long Break'
    };
    const timerMode = document.getElementById('timerMode');
    if (timerMode) timerMode.textContent = modeLabels[state.timerState.mode];

    const sessionInfo = state.timerState.mode === 'work' 
        ? `Session ${state.timerState.sessionCount + 1} of ${state.settings.sessionsBeforeLongBreak}`
        : '';
    const timerSession = document.getElementById('timerSession');
    if (timerSession) timerSession.textContent = sessionInfo;

    const progress = state.timerState.remainingTime / state.timerState.totalTime;
    const circumference = 2 * Math.PI * 45;
    const offset = circumference * (1 - progress);
    
    const progressRing = document.getElementById('timerProgress');
    if (progressRing) {
        progressRing.style.strokeDashoffset = offset;
        
        progressRing.classList.remove('break', 'long-break');
        if (state.timerState.mode === 'shortBreak') {
            progressRing.classList.add('break');
        } else if (state.timerState.mode === 'longBreak') {
            progressRing.classList.add('long-break');
        }
    }
}

function renderHistory(filter = 'all') {
    const list = document.getElementById('historyList');
    const chart = document.getElementById('historyChart');
    if (!list || !chart) return;

    let sessions = [...state.sessions].reverse();

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    if (filter === 'today') {
        const todayStr = today.toDateString();
        sessions = sessions.filter(s => new Date(s.completedAt).toDateString() === todayStr);
    } else if (filter === 'week') {
        sessions = sessions.filter(s => new Date(s.completedAt) >= weekAgo);
    }

    renderChart(chart, filter);

    const showAllBtn = document.querySelector('.history-show-all-container .filter-btn');
    if (showAllBtn) {
        showAllBtn.parentElement.style.display = sessions.length > 3 ? 'flex' : 'none';
        showAllBtn.classList.toggle('active', showAllHistory);
        showAllBtn.innerHTML = showAllHistory 
            ? '<span>Show Less</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>' 
            : '<span>Show All</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
    }

    if (sessions.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
                <p>No sessions recorded for this period.</p>
            </div>
        `;
        return;
    }

    if (!showAllHistory) {
        sessions = sessions.slice(0, 3);
    }

    const headerHtml = `
        <div class="history-header-grid">
            <div class="history-header-indicator"></div>
            <div class="history-header-info">
                <div>Task</div>
                <div>Duration</div>
                <div>Completed</div>
            </div>
            <div class="history-header-more"></div>
        </div>
    `;

    list.innerHTML = headerHtml + sessions.map(session => {
        const isNew = session.id === state.lastSessionId;
        return `
        <div class="history-item${isNew ? ' slide-in highlight' : ''}" data-session-id="${session.id}">
            <div class="history-slide-wrapper">
                <div class="history-type-indicator"></div>
                <div class="history-info">
                    <div class="history-task">${escapeHtml(session.taskName)}</div>
                    <div class="history-duration">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
                        <span>${formatTime(session.duration)}</span>
                    </div>
                    <div class="history-time">${formatTimestamp(session.completedAt)}</div>
                </div>
                <button class="history-more" onclick="event.stopPropagation(); toggleSessionMenu(${session.id})" aria-label="More options">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                </button>
            </div>
            <div class="history-menu">
                <button onclick="event.stopPropagation(); editSession(${session.id})" aria-label="Edit">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                    <span>Edit</span>
                </button>
                <button class="danger" onclick="event.stopPropagation(); deleteSession(${session.id})" aria-label="Delete">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                    <span>Delete</span>
                </button>
            </div>
        </div>
    `}).join('');
}

function renderChart(chartEl, filter) {
    if (!chartEl) return;
    
    let filteredSessions = [];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    if (filter === 'today') {
        filteredSessions = state.sessions.filter(s => {
            const sDate = new Date(s.completedAt);
            return s.type === 'work' && sDate.toDateString() === today.toDateString();
        });
    } else if (filter === 'week') {
        filteredSessions = state.sessions.filter(s => {
            const sDate = new Date(s.completedAt);
            return s.type === 'work' && sDate >= weekAgo;
        });
    } else {
        filteredSessions = state.sessions.filter(s => s.type === 'work');
    }

    if (filteredSessions.length === 0) {
        chartEl.innerHTML = `
            <div class="empty-state small">
                <p>No focus data for this period</p>
            </div>
        `;
        return;
    }

    const taskTotals = {};
    filteredSessions.forEach(s => {
        const name = s.taskName || 'Untracked';
        taskTotals[name] = (taskTotals[name] || 0) + s.duration;
    });

    const total = Object.values(taskTotals).reduce((a, b) => a + b, 0);
    const colors = ['#58a6ff', '#3fb950', '#d29922', '#f85149', '#a371f7', '#79c0ff', '#56d364'];
    
    const sortedEntries = Object.entries(taskTotals).sort((a, b) => b[1] - a[1]);
    const displayEntries = sortedEntries.slice(0, 4);
    
    if (sortedEntries.length > 4) {
        const othersDuration = sortedEntries.slice(4).reduce((sum, entry) => sum + entry[1], 0);
        displayEntries.push(['Others', othersDuration]);
    }

    let cumulative = 0;
    const segments = displayEntries.map(([name, seconds], i) => {
        const percent = (seconds / total) * 100;
        const start = cumulative;
        cumulative += percent;
        return { name, percent, start, seconds, color: colors[i % colors.length] };
    });

    const circumference = 75.4;

    chartEl.innerHTML = `
        <div class="pie-chart-container">
            <svg class="pie-chart" viewBox="0 0 32 32">
                ${segments.map(s => {
                    const dashLen = (s.percent / 100) * circumference;
                    const dashOffset = (-s.start / 100) * circumference;
                    return `<circle cx="16" cy="16" r="12" fill="transparent" stroke="${s.color}" 
                        stroke-width="6" stroke-dasharray="${dashLen} ${circumference - dashLen}"
                        stroke-dashoffset="${dashOffset}" 
                        transform="rotate(-90 16 16)"/>`;
                }).join('')}
            </svg>
            <div class="pie-legend">
                ${segments.map(s => `
                    <div class="legend-item">
                        <span class="legend-color" style="background: ${s.color}"></span>
                        <span class="legend-label">${escapeHtml(s.name)}</span>
                        <span class="legend-value">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
                            ${formatTime(s.seconds)}
                        </span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

async function clearHistory() {
    if (!await confirm('Are you sure you want to clear all session history?')) return;
    
    state.sessions = [];
    saveData();
    renderHistory();
    updateStats();
}

function updateStats() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const todaySessions = state.sessions.filter(s => 
        s.type === 'work' && new Date(s.completedAt) >= today
    );

    const totalSeconds = todaySessions.reduce((sum, s) => sum + s.duration, 0);
    const focusTimeEl = document.getElementById('todayFocusTime');
    if (focusTimeEl) focusTimeEl.textContent = formatTime(totalSeconds);
    
    const todaySessionsEl = document.getElementById('todaySessions');
    if (todaySessionsEl) todaySessionsEl.textContent = todaySessions.length;

    const streak = calculateStreak();
    const streakEl = document.getElementById('currentStreak');
    if (streakEl) streakEl.textContent = streak === 0 ? '--' : streak;
}

function calculateStreak() {
    if (state.sessions.filter(s => s.type === 'work').length === 0) return 0;

    const dates = [...new Set(state.sessions
        .filter(s => s.type === 'work')
        .map(s => {
            const d = new Date(s.completedAt);
            return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        })
    )].sort((a, b) => b - a);

    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();

    if (dates[0] === todayMs || dates[0] === todayMs - 86400000) {
        let checkDate = dates[0] === todayMs ? today : new Date(dates[0]);
        
        for (const dateMs of dates) {
            if (dateMs === checkDate.getTime()) {
                streak++;
                checkDate.setDate(checkDate.getDate() - 1);
            } else {
                break;
            }
        }
    }

    return streak;
}

function updateDateTime() {
    const now = new Date();
    const options = { 
        weekday: 'short', 
        month: 'short', 
        day: 'numeric',
        hour: state.settings.use12Hour ? 'numeric' : '2-digit',
        minute: '2-digit',
        hour12: state.settings.use12Hour
    };
    const datetimeEl = document.getElementById('datetime');
    if (datetimeEl) datetimeEl.textContent = now.toLocaleDateString('en-US', options);
}

function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    
    if (h > 0) {
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatTimestamp(isoString) {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return 'Unknown date';
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const sessionDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    let prefix = '';
    if (sessionDate.getTime() === today.getTime()) {
        prefix = 'Today ';
    } else if (sessionDate.getTime() === yesterday.getTime()) {
        prefix = 'Yesterday ';
    } else {
        return date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric'
        });
    }
    
    const time = date.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: state.settings.use12Hour 
    });
    
    return prefix + time;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function openSettings() {
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) settingsModal.classList.add('open');
}

function closeSettings() {
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) settingsModal.classList.remove('open');
}

let importDataCache = null;

function exportData() {
    const data = {
        exportedAt: new Date().toISOString(),
        version: CURRENT_VERSION,
        tasks: state.tasks,
        sessions: state.sessions,
        settings: state.settings
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().split('T')[0];
    a.href = url;
    a.download = `pomoflow-backup-${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast('Data exported successfully');
}

function handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            
            if (!data.tasks || !data.sessions || !data.settings) {
                showToast('Invalid backup file');
                return;
            }
            
            importDataCache = data;
            
            const taskCount = data.tasks.length;
            const sessionCount = data.sessions.length;
            
            const importInfo = document.getElementById('importInfo');
            if (importInfo) {
                importInfo.innerHTML = `
                    Found <strong>${taskCount} tasks</strong> and <strong>${sessionCount} sessions</strong> in the backup file.
                `;
            }
            
            const importModal = document.getElementById('importModal');
            if (importModal) importModal.classList.add('open');
        } catch (err) {
            showToast('Error reading backup file');
            console.error(err);
        }
    };
    reader.readAsText(file);
    
    event.target.value = '';
}

function performImport(mode) {
    if (!importDataCache) return;
    
    const data = importDataCache;
    
    if (mode === 'replace') {
        state.tasks = data.tasks || [];
        state.sessions = data.sessions || [];
        state.settings = { ...state.settings, ...data.settings };
    } else if (mode === 'merge') {
        const existingTaskIds = new Set(state.tasks.map(t => t.id));
        const newTasks = (data.tasks || []).filter(t => !existingTaskIds.has(t.id));
        state.tasks = [...state.tasks, ...newTasks];
        
        const existingSessionKeys = new Set(state.sessions.map(s => `${s.completedAt}-${s.taskName}`));
        const newSessions = (data.sessions || []).filter(s => !existingSessionKeys.has(`${s.completedAt}-${s.taskName}`));
        state.sessions = [...state.sessions, ...newSessions];
        
        state.settings = { ...state.settings, ...data.settings };
    }
    
    state.currentTask = null;
    state.timerState = {
        mode: 'work',
        isRunning: false,
        remainingTime: state.settings.workDuration * 60,
        totalTime: state.settings.workDuration * 60,
        sessionCount: 0,
        startTime: null,
        activeTaskId: null
    };
    
    saveData();
    importDataCache = null;
    
    const importModal = document.getElementById('importModal');
    if (importModal) importModal.classList.remove('open');
    closeSettings();
    
    init();
    showToast('Data imported successfully');
}

function closeImportModal() {
    const importModal = document.getElementById('importModal');
    if (importModal) importModal.classList.remove('open');
    importDataCache = null;
}

let confirmResolve = null;

function confirm(message) {
    return new Promise((resolve) => {
        confirmResolve = resolve;
        const confirmMessage = document.getElementById('confirmMessage');
        if (confirmMessage) confirmMessage.textContent = message;
        const confirmModal = document.getElementById('confirmModal');
        if (confirmModal) confirmModal.classList.add('open');
    });
}

function closeConfirmModal() {
    const confirmModal = document.getElementById('confirmModal');
    if (confirmModal) confirmModal.classList.remove('open');
    if (confirmResolve) {
        confirmResolve(false);
        confirmResolve = null;
    }
}

function checkNotificationPrompt() {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default' && 
        !localStorage.getItem(STORAGE_KEYS.NOTIFICATION_PROMPT)) {
        const prompt = document.getElementById('notificationPrompt');
        if (prompt) prompt.style.display = 'flex';
    }
}

function dismissNotificationPrompt() {
    const prompt = document.getElementById('notificationPrompt');
    if (prompt) prompt.style.display = 'none';
    localStorage.setItem(STORAGE_KEYS.NOTIFICATION_PROMPT, 'dismissed');
}

function requestNotificationPermission() {
    if (typeof Notification === 'undefined') return;
    Notification.requestPermission().then(permission => {
        state.notificationPermission = permission;
        dismissNotificationPrompt();
    });
}

function sendNotification(session) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    
    const titles = {
        work: 'Focus session complete!',
        shortBreak: 'Break is over!',
        longBreak: 'Long break is over!'
    };
    new Notification('PomoFlow', {
        body: titles[session.type],
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="%2358a6ff" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>'
    });
}

function playNotificationSound() {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume();
        }
        
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(state.settings.soundVolume / 100 * 0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5);
    } catch (e) {
        console.error('Error playing sound:', e);
    }
}

function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.style.display = 'block';
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.style.display = 'none', 200);
    }, 2000);
}

function toggleTaskMenu(taskId) {
    const taskItem = document.querySelector(`.task-item[data-id="${taskId}"]`);
    if (!taskItem) return;
    const wasOpen = taskItem.classList.contains('menu-open');
    document.querySelectorAll('.task-item.menu-open').forEach(item => {
        item.classList.remove('menu-open');
    });
    if (!wasOpen) {
        taskItem.classList.add('menu-open');
    }
}

let currentEditingTaskId = null;
function editTask(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    const taskItem = document.querySelector(`.task-item[data-id="${taskId}"]`);
    if (taskItem) {
        taskItem.classList.remove('menu-open');
    }
    currentEditingTaskId = taskId;
    const taskEditName = document.getElementById('taskEditName');
    if (taskEditName) {
        taskEditName.value = task.name;
        const taskEditModal = document.getElementById('taskEditModal');
        if (taskEditModal) {
            taskEditModal.classList.add('open');
            taskEditName.focus();
        }
    }
}

function closeTaskEditModal() {
    const taskEditModal = document.getElementById('taskEditModal');
    if (taskEditModal) taskEditModal.classList.remove('open');
    currentEditingTaskId = null;
}

function saveTaskFromModal() {
    if (!currentEditingTaskId) return;
    const task = state.tasks.find(t => t.id === currentEditingTaskId);
    if (!task) return;
    const taskEditName = document.getElementById('taskEditName');
    if (!taskEditName) return;
    const newName = taskEditName.value.trim();
    if (!newName) return;
    task.name = newName;
    state.sessions.forEach(s => {
        if (s.taskId === task.id) {
            s.taskName = newName;
        }
    });
    saveData();
    closeTaskEditModal();
    renderTasks();
    renderHistory(currentFilter);
}

function toggleSessionMenu(sessionId) {
    const sessionItem = document.querySelector(`.history-item[data-session-id="${sessionId}"]`);
    if (!sessionItem) return;
    const wasOpen = sessionItem.classList.contains('menu-open');
    document.querySelectorAll('.history-item.menu-open').forEach(item => {
        item.classList.remove('menu-open');
    });
    if (!wasOpen) {
        sessionItem.classList.add('menu-open');
    }
}

let currentEditingSessionId = null;
function editSession(sessionId) {
    const session = state.sessions.find(s => s.id === sessionId);
    if (!session) return;
    const sessionItem = document.querySelector(`.history-item[data-session-id="${sessionId}"]`);
    if (sessionItem) {
        sessionItem.classList.remove('menu-open');
    }
    currentEditingSessionId = sessionId;
    const sessionEditTaskName = document.getElementById('sessionEditTaskName');
    if (sessionEditTaskName) sessionEditTaskName.textContent = session.taskName;
    
    const sessionEditDuration = document.getElementById('sessionEditDuration');
    if (sessionEditDuration) {
        sessionEditDuration.value = Math.floor(session.duration / 60);
        const sessionEditModal = document.getElementById('sessionEditModal');
        if (sessionEditModal) {
            sessionEditModal.classList.add('open');
            sessionEditDuration.focus();
        }
    }
}

function closeSessionEditModal() {
    const sessionEditModal = document.getElementById('sessionEditModal');
    if (sessionEditModal) sessionEditModal.classList.remove('open');
    currentEditingSessionId = null;
}

function saveSessionFromModal() {
    if (!currentEditingSessionId) return;
    const session = state.sessions.find(s => s.id === currentEditingSessionId);
    if (!session) return;
    const sessionEditDuration = document.getElementById('sessionEditDuration');
    if (!sessionEditDuration) return;
    const newMinutes = parseInt(sessionEditDuration.value, 10);
    if (isNaN(newMinutes) || newMinutes < 1) return;
    const oldDuration = session.duration;
    session.duration = newMinutes * 60;
    const task = state.tasks.find(t => t.id === session.taskId);
    if (task) {
        task.totalTime = task.totalTime - oldDuration + session.duration;
    }
    saveData();
    closeSessionEditModal();
    renderHistory(currentFilter);
    updateStats();
}

function restoreTimerState() {
    if (state.timerState.startTime && state.timerState.isRunning) {
        const elapsed = Math.floor((Date.now() - state.timerState.startTime) / 1000);
        state.timerState.remainingTime = Math.max(0, state.timerState.remainingTime - elapsed);
        
        if (state.timerState.remainingTime > 0) {
            startTimer();
        } else {
            completeSession();
        }
    }
}

function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle && savedTheme === 'light') {
        themeToggle.classList.add('dark');
    }
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) themeToggle.classList.toggle('dark');
}

init();
