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
    lastTaskId: null,
    selectedTaskColor: '#58a6ff',
    editTaskColor: '#58a6ff'
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

    document.getElementById('enableNotifications').addEventListener('click', () => {
        requestNotificationPermission();
    });
    document.getElementById('denyNotifications').addEventListener('click', () => {
        state.notificationPermission = 'denied';
        localStorage.setItem(STORAGE_KEYS.NOTIFICATION_PROMPT, 'denied');
        document.getElementById('notificationPrompt').style.display = 'none';
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
        } else if (e.key === '1') {
            switchMode('work');
        } else if (e.key === '2') {
            switchMode('shortBreak');
        } else if (e.key === '3') {
            switchMode('longBreak');
        }
    });
}

function switchMode(mode) {
    if (state.timerState.mode === mode) return;
    
    if (state.timerState.isRunning) {
        confirmAction('Switching modes will reset the current timer. Continue?').then(confirmed => {
            if (confirmed) {
                applyMode(mode);
            }
        });
    } else {
        applyMode(mode);
    }
}

function applyMode(mode) {
    state.timerState.mode = mode;
    state.timerState.isRunning = false;
    
    if (mode === 'work') {
        state.timerState.totalTime = state.settings.workDuration * 60;
    } else if (mode === 'shortBreak') {
        state.timerState.totalTime = state.settings.shortBreakDuration * 60;
    } else if (mode === 'longBreak') {
        state.timerState.totalTime = state.settings.longBreakDuration * 60;
    }
    
    state.timerState.remainingTime = state.timerState.totalTime;
    
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
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

    state.timerState.isRunning = true;
    state.timerState.startTime = Date.now();
    
    updateTimerDisplay();
    
    timerInterval = setInterval(() => {
        state.timerState.remainingTime--;
        
        if (state.timerState.remainingTime <= 0) {
            handleSessionComplete();
        } else {
            updateTimerDisplay();
            if (state.timerState.remainingTime % 10 === 0) saveData();
        }
    }, 1000);
}

function pauseTimer() {
    state.timerState.isRunning = false;
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    updateTimerDisplay();
    saveData();
}

function resetTimer() {
    pauseTimer();
    applyMode(state.timerState.mode);
}

function skipSession() {
    handleSessionComplete(true);
}

function handleSessionComplete(skipped = false) {
    pauseTimer();
    
    const wasWork = state.timerState.mode === 'work';
    
    if (wasWork && !skipped) {
        state.timerState.sessionCount++;
        saveSession();
        updateStats();
        playTone(440, 0.1, 0);
        setTimeout(() => playTone(880, 0.2, 0.1), 100);
        showNotification('Focus session complete!', 'Time for a break.');
    } else if (!wasWork && !skipped) {
        playTone(880, 0.1, 0);
        setTimeout(() => playTone(440, 0.2, 0.1), 100);
        showNotification('Break is over!', 'Ready to get back to work?');
    }

    let nextMode;
    if (wasWork) {
        if (state.timerState.sessionCount % state.settings.sessionsBeforeLongBreak === 0) {
            nextMode = 'longBreak';
        } else {
            nextMode = 'shortBreak';
        }
    } else {
        nextMode = 'work';
    }
    
    applyMode(nextMode);
    
    const autoStart = (nextMode === 'work' && state.settings.autoStartWork) || 
                      (nextMode !== 'work' && state.settings.autoStartBreaks);
                      
    if (autoStart) {
        setTimeout(startTimer, 1000);
    }
}

function updateTimerDisplay() {
    const timeDisplay = document.getElementById('timerTime');
    const modeDisplay = document.getElementById('timerMode');
    const sessionDisplay = document.getElementById('timerSession');
    const startPauseText = document.getElementById('startPauseText');
    const playIcon = document.getElementById('playIcon');
    const timerProgress = document.getElementById('timerProgress');
    const timerTaskDisplay = document.getElementById('timerTask');
    
    const minutes = Math.floor(state.timerState.remainingTime / 60);
    const seconds = state.timerState.remainingTime % 60;
    const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    if (timeDisplay) timeDisplay.textContent = formattedTime;
    document.title = `${formattedTime} - PomoFlow`;
    
    const modeLabels = {
        work: 'Focus',
        shortBreak: 'Short Break',
        longBreak: 'Long Break'
    };
    
    if (modeDisplay) modeDisplay.textContent = modeLabels[state.timerState.mode];
    
    const currentSession = (state.timerState.sessionCount % state.settings.sessionsBeforeLongBreak) + 1;
    if (sessionDisplay) sessionDisplay.textContent = `Session ${currentSession} of ${state.settings.sessionsBeforeLongBreak}`;
    
    if (state.timerState.isRunning) {
        if (startPauseText) startPauseText.textContent = 'Pause';
        if (playIcon) playIcon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
        document.body.classList.add('timer-running');
    } else {
        if (startPauseText) startPauseText.textContent = 'Start';
        if (playIcon) playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
        document.body.classList.remove('timer-running');
    }
    
    if (state.timerState.activeTaskId) {
        const task = state.tasks.find(t => t.id === state.timerState.activeTaskId);
        if (task) {
            if (timerTaskDisplay) {
                timerTaskDisplay.textContent = task.name;
                timerTaskDisplay.style.color = task.color;
            }
            if (state.timerState.mode === 'work' && timerProgress) {
                timerProgress.style.stroke = task.color;
            } else if (timerProgress) {
                timerProgress.style.stroke = '';
            }
        }
    } else {
        if (timerTaskDisplay) timerTaskDisplay.textContent = '';
        if (timerProgress) timerProgress.style.stroke = '';
    }
    
    const percent = (state.timerState.remainingTime / state.timerState.totalTime);
    const offset = 282.7 * (1 - percent);
    if (timerProgress) {
        timerProgress.style.strokeDashoffset = offset;
        timerProgress.className = 'timer-ring-progress';
        if (state.timerState.mode === 'shortBreak') timerProgress.classList.add('break');
        if (state.timerState.mode === 'longBreak') timerProgress.classList.add('long-break');
    }

    if (state.timerState.activeTaskId) {
        const taskRing = document.getElementById(`taskRing-${state.timerState.activeTaskId}`);
        if (taskRing) {
            taskRing.style.strokeDashoffset = offset;
            taskRing.className = 'task-ring-progress';
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

function renderTasks() {
    const list = document.getElementById('taskList');
    const hint = document.getElementById('taskHint');
    if (!list) return;
    list.innerHTML = '';
    
    if (state.tasks.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/></svg>
                <p>No tasks yet. Add one above to start focusing.</p>
            </div>
        `;
        if (hint) hint.style.display = 'none';
        return;
    }
    
    if (hint) hint.style.display = 'flex';
    
    const activeTasks = state.tasks.filter(t => !t.completed).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const completedTasks = state.tasks.filter(t => t.completed).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    const renderTaskItem = (task) => {
        const item = document.createElement('div');
        const isNew = task.id === state.lastTaskId;
        item.className = `task-item ${isNew ? 'slide-in' : ''} ${task.completed ? 'completed' : ''} ${state.timerState.activeTaskId === task.id ? 'active' : ''}`;
        
        const minutes = Math.floor(task.totalTime / 60);
        
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
                    <span>Del</span>
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
                    <div class="task-name">${escapeHtml(task.name)}</div>
                    <div class="task-time">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zM12.5 7H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
                        ${minutes}m focused
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
            item.classList.toggle('menu-open');
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
        });

        item.querySelector('.edit-btn').addEventListener('click', () => {
            openTaskEditModal(task);
            item.classList.remove('menu-open');
        });

        item.querySelector('.completed-btn').addEventListener('click', () => {
            toggleTaskComplete(task.id);
            item.classList.remove('menu-open');
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
        completedHeader.textContent = 'Completed';
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
    confirmAction('Are you sure you want to delete this task?').then(confirmed => {
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
        taskName: 'Unknown Task',
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
        }
    }
    
    state.sessions.push(session);
    saveData();
    renderTasks();
    renderHistory(currentFilter);
}

function renderHistory(filter = 'today') {
    const list = document.getElementById('historyList');
    if (!list) return;
    list.innerHTML = '';
    
    let sessions = filterSessions(state.sessions, filter);
    
    if (sessions.length === 0) {
        list.innerHTML = '<div class="empty-state"><p>No sessions found for this period.</p></div>';
        renderChart([]);
        return;
    }
    
    sessions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    renderChart(sessions);
    
    const displaySessions = showAllHistory ? sessions : sessions.slice(0, 10);
    
    const header = document.createElement('div');
    header.className = 'history-header-grid';
    header.innerHTML = `
        <div class="history-header-indicator"></div>
        <div class="history-header-info">
            <div>TASK</div>
            <div>DURATION</div>
            <div>COMPLETED</div>
        </div>
        <div class="history-header-more"></div>
    `;
    list.appendChild(header);

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
                    <span>Del</span>
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
            item.classList.toggle('menu-open');
        });

        item.querySelector('.edit-btn').addEventListener('click', () => {
            openSessionEditModal(session);
            item.classList.remove('menu-open');
        });

        item.querySelector('.delete-btn').addEventListener('click', () => {
            deleteSession(session.id);
        });

        list.appendChild(item);
    });

    const showAllBtn = document.querySelector('.history-show-all-container .filter-btn');
    if (showAllBtn) {
        showAllBtn.textContent = showAllHistory ? 'Show Less' : 'Show All';
        showAllBtn.style.display = sessions.length > 10 ? 'block' : 'none';
    }
}

function filterSessions(sessions, filter) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    
    if (filter === 'today') {
        return sessions.filter(s => new Date(s.timestamp).getTime() >= todayStart);
    } else if (filter === 'week') {
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
    const today = new Date().toDateString();
    const todaySessions = state.sessions.filter(s => new Date(s.timestamp).toDateString() === today);
    const totalSeconds = todaySessions.reduce((acc, s) => acc + s.duration, 0);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    
    document.getElementById('todayFocusTime').textContent = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    document.getElementById('todaySessions').textContent = todaySessions.length;
    
    const streak = calculateStreak(state.sessions);
    document.getElementById('currentStreak').textContent = streak > 0 ? `${streak} days` : '--';
}

function calculateStreak(sessions) {
    if (sessions.length === 0) return 0;
    const dates = [...new Set(sessions.map(s => new Date(s.timestamp).toDateString()))]
        .map(d => new Date(d))
        .sort((a, b) => b - a);
    let streak = 0;
    let currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);
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
    el.textContent = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: state.settings.use12Hour }).replace(',', '');
}

function formatTimestamp(date) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: state.settings.use12Hour });
}

function openSettings() {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;
    modal.classList.add('open');
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
    document.getElementById('settingsModal').classList.remove('open');
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
        task.name = name; task.color = state.editTaskColor;
        state.sessions.forEach(s => { if (s.taskId === task.id) { s.taskName = task.name; s.taskColor = task.color; } });
        saveData(); renderTasks(); renderHistory(currentFilter); updateTimerDisplay(); closeTaskEditModal();
    }
}

function checkNotificationPrompt() {
    if (Notification.permission === 'default' && localStorage.getItem(STORAGE_KEYS.NOTIFICATION_PROMPT) !== 'denied') {
        document.getElementById('notificationPrompt').style.display = 'flex';
    }
}

function requestNotificationPermission() {
    Notification.requestPermission().then(permission => {
        state.notificationPermission = permission;
        document.getElementById('notificationPrompt').style.display = 'none';
        if (permission === 'granted') showNotification('Notifications enabled', 'You will be alerted when focus ends.');
    });
}

function showNotification(title, body) {
    if (Notification.permission === 'granted') new Notification(title, { body });
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
            document.getElementById('importInfo').innerHTML = `<p>Found <strong>${data.tasks.length}</strong> tasks and <strong>${data.sessions.length}</strong> sessions.</p><p>Proceed?</p>`;
            document.getElementById('importModal').classList.add('open');
        } catch (err) { alert('Error: ' + err.message); }
    };
    reader.readAsText(file);
}

function closeImportModal() { document.getElementById('importModal').classList.remove('open'); pendingImportData = null; document.getElementById('importFile').value = ''; }

function performImport(mode) {
    if (!pendingImportData) return;
    if (mode === 'replace') { state.tasks = pendingImportData.tasks; state.sessions = pendingImportData.sessions; if (pendingImportData.settings) state.settings = { ...state.settings, ...pendingImportData.settings }; }
    else {
        const taskIds = new Set(state.tasks.map(t => t.id));
        pendingImportData.tasks.forEach(t => { if (!taskIds.has(t.id)) state.tasks.push(t); });
        const sessionIds = new Set(state.sessions.map(s => s.id));
        pendingImportData.sessions.forEach(s => { if (!sessionIds.has(s.id)) state.sessions.push(s); });
    }
    saveData(); renderTasks(); renderHistory(currentFilter); updateStats(); closeImportModal(); showToast('Data imported');
}

function initTheme() {
    const theme = localStorage.getItem('flowtracker_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    document.getElementById('themeToggle').classList.toggle('dark', theme === 'dark');
}

function toggleTheme() {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('flowtracker_theme', next);
    document.getElementById('themeToggle').classList.toggle('dark', next === 'dark');
}

function showToast(message) {
    const t = document.getElementById('toast'); t.textContent = message; t.style.display = 'block'; t.classList.add('show');
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.style.display = 'none', 200); }, 3000);
}

function restoreTimerState() {
    if (state.timerState.isRunning && state.timerState.startTime) {
        const elapsed = Math.floor((Date.now() - state.timerState.startTime) / 1000);
        state.timerState.remainingTime = Math.max(0, state.timerState.remainingTime - elapsed);
        if (state.timerState.remainingTime > 0) startTimer(); else handleSessionComplete();
    } else updateTimerDisplay();
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

document.querySelectorAll('.setting-slider').forEach(s => s.addEventListener('input', () => {
    document.getElementById(`${s.id}Value`).textContent = s.id === 'soundVolume' ? `${s.value}%` : `${s.value} min`;
}));

document.querySelectorAll('.setting-toggle').forEach(t => t.addEventListener('click', () => t.classList.toggle('active')));

init();
