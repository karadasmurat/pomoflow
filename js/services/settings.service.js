import { state, mutations } from '../state/store.js';
import { dbManager } from '../db.js';

export class SettingsService {
    static updateSettings(newSettings) {
        mutations.updateSettings(newSettings);
        return state.settings;
    }

    static toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
        const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', nextTheme);
        
        if (typeof dbManager !== 'undefined' && dbManager.initialized) {
            dbManager.setAppState('theme', nextTheme);
        } else {
            localStorage.setItem('flowtracker_theme', nextTheme);
        }
        
        return nextTheme;
    }

    static resolveTemplate(template, data) {
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

    static handleShare(platform, context = 'intent', customData = {}, notifyFn) {
        const activeTask = state.tasks.find(t => t.id === state.timerState.activeTaskId);
        
        const defaultData = {
            focusArea: activeTask ? activeTask.name : '',
            duration: Math.round(state.timerState.totalTime / 60),
            time: new Date(Date.now() + state.timerState.remainingTime * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: state.settings.use12Hour }),
            xp: Math.floor(state.timerState.totalTime / 60) * 10
        };

        const data = { ...defaultData, ...customData };
        const template = state.settings.shareTemplates[context] || state.settings.shareTemplates.intent;
        const message = this.resolveTemplate(template, data);

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
                if (notifyFn) notifyFn('Status copied to clipboard! 📋');
            });
        }
        
        document.querySelectorAll('.expand-group.open').forEach(g => g.classList.remove('open'));
    }

    static sendNotification(title, body) {
        if (!("Notification" in window) || Notification.permission !== "granted") return;
        new Notification(title, { body, icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🎯</text></svg>' });
    }
}
