import { state } from '../state/store.js';

export class TimerView {
    static updateDisplay() {
        const timeEl = document.getElementById('timerTime');
        const modeEl = document.getElementById('timerMode');
        const startPauseText = document.getElementById('startPauseText');
        const playIcon = document.getElementById('playIcon');
        const timerProgress = document.getElementById('timerProgress');
        const textEl = document.getElementById('focusAreaText');
        const prefixEl = document.getElementById('focusAreaPrefix');
        
        const remaining = Math.max(0, state.timerState.remainingTime);
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
        
        if (timeEl) timeEl.textContent = timeStr;
        document.title = `${timeStr} - PomoFlow`;
        
        if (modeEl) modeEl.textContent = state.timerState.mode === 'work' ? '🧠 Focus' : '🏖️ Break';
        
        this._updateSessionDots();
        this._updateControls(startPauseText, playIcon);
        this._updateOrbiters();
        this._updateActiveTask(textEl, prefixEl);
        this._updateProgress(timerProgress);
    }

    static _updateSessionDots() {
        const currentStationIndex = (state.timerState.cycleStation || 1) - 1;
        const sessionProgress = document.getElementById('sessionProgress');
        if (!sessionProgress) return;

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

    static _updateControls(startPauseText, playIcon) {
        if (state.timerState.isRunning) {
            if (startPauseText) startPauseText.textContent = 'Pause';
            if (playIcon) playIcon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
            document.body.classList.add('timer-running');
        } else {
            if (startPauseText) startPauseText.textContent = 'Start';
            if (playIcon) playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
            document.body.classList.remove('timer-running');
        }
    }

    static _updateOrbiters() {
        document.querySelectorAll('.orbiter.option').forEach(btn => {
            if (btn.dataset.mins) {
                const mode = state.timerState.mode;
                const currentDur = mode === 'work' ? state.settings.workDuration : (mode === 'shortBreak' ? state.settings.shortBreakDuration : state.settings.longBreakDuration);
                btn.classList.toggle('active', parseInt(btn.dataset.mins) === currentDur);
            }
        });
    }

    static _updateActiveTask(textEl, prefixEl) {
        const clearBtn = document.getElementById('clearFocusArea');
        const questionEl = document.getElementById('focusAreaQuestion');
        const hudEl = document.getElementById('focusAreaProgressHUD');

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
                // Note: HUD update involves Aim logic which might stay in app.js or FocusView for now
            }
        } else {
            if (questionEl) questionEl.textContent = 'What are you focusing on?';
            if (textEl) {
                textEl.innerHTML = '<span class="focus-area-add-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg></span>';
                textEl.style.color = '';
                textEl.title = '';
            }
            if (prefixEl) prefixEl.style.display = 'none';
            if (clearBtn) clearBtn.style.display = 'none';
            if (hudEl) hudEl.style.display = 'none';
        }
    }

    static _updateProgress(timerProgress) {
        if (!timerProgress) return;
        const total = state.timerState.totalTime;
        const remaining = state.timerState.remainingTime;
        const progress = total > 0 ? (1 - (remaining / total)) * 282.7 : 0;
        timerProgress.style.strokeDashoffset = progress;
    }
}
