import { state, mutations } from '../state/store.js';

class TimerEngine {
    constructor() {
        this.worker = null;
        this.audioContext = null;
        this.callbacks = {
            onTick: () => {},
            onComplete: () => {},
            onSave: () => {}
        };
    }

    init(callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks };
        this._initWorker();
        this._initAudio();
    }

    _initWorker() {
        if (this.worker) return;
        const workerCode = `
            let timerInterval = null;
            self.onmessage = function(e) {
                if (e.data.action === 'start') {
                    const endTime = e.data.endTime;
                    if (timerInterval) clearInterval(timerInterval);
                    timerInterval = setInterval(() => {
                        const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
                        self.postMessage({ action: 'tick', remaining });
                        if (remaining <= 0) clearInterval(timerInterval);
                    }, 500);
                } else if (e.data.action === 'stop') {
                    if (timerInterval) clearInterval(timerInterval);
                }
            };
        `;
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        this.worker = new Worker(URL.createObjectURL(blob));
        this.worker.onmessage = (e) => this._handleWorkerMessage(e);
    }

    _handleWorkerMessage(e) {
        if (e.data.action === 'tick') {
            mutations.updateTimer({ remainingTime: e.data.remaining });
            if (state.timerState.remainingTime <= 0) {
                this.stop();
                this.callbacks.onComplete();
            } else {
                this.callbacks.onTick();
                if (state.timerState.remainingTime % 10 === 0) this.callbacks.onSave();
            }
        }
    }

    _initAudio() {
        if (!this.audioContext) {
            try { this.audioContext = new (window.AudioContext || window.webkitAudioContext)(); }
            catch (e) { console.warn('AudioContext failed', e); }
        }
    }

    playTone(freq, duration, delay) {
        this._initAudio();
        if (!this.audioContext) return;
        
        const osc = this.audioContext.createOscillator(); 
        const gain = this.audioContext.createGain(); 
        const vol = state.settings.soundVolume / 100;
        
        osc.type = 'sine'; 
        osc.frequency.setValueAtTime(freq, this.audioContext.currentTime + delay);
        
        gain.gain.setValueAtTime(0, this.audioContext.currentTime + delay);
        gain.gain.linearRampToValueAtTime(vol * 0.1, this.audioContext.currentTime + delay + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + delay + duration);
        
        osc.connect(gain); 
        gain.connect(this.audioContext.destination);
        
        osc.start(this.audioContext.currentTime + delay); 
        osc.stop(this.audioContext.currentTime + delay + duration);
    }

    start() {
        if (this.audioContext && this.audioContext.state === 'suspended') this.audioContext.resume();
        
        mutations.updateTimer({ 
            isRunning: true, 
            startTime: Date.now(),
            targetEndTime: Date.now() + (state.timerState.remainingTime * 1000)
        });

        this._initWorker();
        this.worker.postMessage({ action: 'start', endTime: state.timerState.targetEndTime });
        this.callbacks.onTick(); // Immediate update
        this.callbacks.onSave();
    }

    stop() {
        mutations.updateTimer({ isRunning: false, targetEndTime: null });
        if (this.worker) this.worker.postMessage({ action: 'stop' });
        this.callbacks.onTick();
        this.callbacks.onSave();
    }

    toggle() {
        if (state.timerState.isRunning) this.stop();
        else this.start();
    }

    reset() {
        this.stop();
        this.applyMode(state.timerState.mode);
    }

    applyMode(mode) {
        let duration = state.settings.workDuration;
        if (mode === 'shortBreak') duration = state.settings.shortBreakDuration;
        else if (mode === 'longBreak') duration = state.settings.longBreakDuration;

        mutations.updateTimer({ 
            mode, 
            totalTime: duration * 60, 
            remainingTime: duration * 60 
        });
        
        this.callbacks.onTick();
        this.callbacks.onSave();
    }
}

export const timer = new TimerEngine();
