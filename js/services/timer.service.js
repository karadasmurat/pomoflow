import { state, mutations } from '../state/store.js';

export class TimerService {
    static getNextMode() {
        const currentMode = state.timerState.mode;
        const wasWork = currentMode === 'work';
        
        if (wasWork) {
            if (state.timerState.cycleStation >= state.settings.sessionsBeforeLongBreak) {
                return 'longBreak';
            } else {
                return 'shortBreak';
            }
        } else {
            return 'work';
        }
    }

    static advanceCycle(currentMode) {
        if (currentMode === 'longBreak') {
            state.timerState.cycleStation = 1;
        } else if (currentMode !== 'work') {
            state.timerState.cycleStation++;
        }
    }

    static handleSessionEnd(skipped = false) {
        const currentMode = state.timerState.mode;
        const wasWork = currentMode === 'work';
        const nextMode = this.getNextMode();
        
        if (!wasWork) {
            this.advanceCycle(currentMode);
        }

        if (wasWork && !skipped) {
            state.timerState.sessionCount++;
        }

        return {
            wasWork,
            nextMode,
            sessionCount: state.timerState.sessionCount,
            cycleStation: state.timerState.cycleStation
        };
    }
}
