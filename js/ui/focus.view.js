import { state } from '../state/store.js';
import { HistoryService } from '../services/history.service.js';
import { FocusService } from '../services/focus.service.js';

export class FocusView {
    static formatDurationHM(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    }

    static updateLevelUI(previousTotalXp = null) {
        const xpEl = document.getElementById('userXP');
        const rankEl = document.getElementById('userRank');
        const headerAvatar = document.getElementById('headerAvatar');
        const levelContainer = document.getElementById('levelContainer');
        
        if (!xpEl || !rankEl) return;
        
        xpEl.textContent = state.totalXp.toLocaleString();
        if (levelContainer) levelContainer.title = `Level ${state.level}`;
        if (headerAvatar) headerAvatar.textContent = state.avatar || '🦉';
        
        const personaCircle = document.getElementById('personaCircle');
        const currentMoodLabel = document.getElementById('currentMoodLabel');
        if (personaCircle) personaCircle.textContent = state.avatar || '🦉';
        
        rankEl.textContent = FocusService.getRank(state.level);
    }

    static renderFocusAreas(callbacks = {}) {
        const list = document.getElementById('focusAreaList');
        if (!list) return;
        list.innerHTML = '';

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

        categories.forEach((cat, idx) => {
            const isActive = idx === state.activeCategoryIndex;
            const group = this._createCategoryGroup(cat, isActive, icons[cat], () => {
                state.activeCategoryIndex = (state.activeCategoryIndex === idx) ? -1 : idx;
                if (callbacks.onStateChange) callbacks.onStateChange();
                this.renderFocusAreas(callbacks);
            });

            if (isActive) {
                const content = group.querySelector('.focus-area-category-content');
                const tasksToShow = cat === 'Completed' ? completed : grouped[cat];
                if (tasksToShow) {
                    tasksToShow.forEach(t => content.appendChild(this._createTaskItem(t, callbacks)));
                }
            }
            list.appendChild(group);
        });
    }

    static _createCategoryGroup(name, isActive, icon, toggleFn) {
        const group = document.createElement('div');
        group.className = `focus-area-category-group ${isActive ? 'active' : 'collapsed'}`;
        
        const header = document.createElement('div');
        header.className = `focus-area-category-header ${isActive ? 'active' : ''}`;
        header.innerHTML = `
            <div class="category-title-wrapper">
                <span class="category-icon">${icon || '📁'}</span>
                <span>${name}</span>
            </div>
            <svg class="category-chevron" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
            </svg>
        `;
        header.onclick = toggleFn;
        group.appendChild(header);

        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'focus-area-category-wrapper';
        contentWrapper.innerHTML = '<div class="focus-area-category-content"></div>';
        group.appendChild(contentWrapper);
        
        return group;
    }

    static _createTaskItem(task, callbacks) {
        const item = document.createElement('sliding-card');
        item.setAttribute('variant', state.settings.cardVariant || 'glass');
        const todayTime = this._getTodayTimeForFocusArea(task.id);
        const totalTime = this._getTotalTimeForFocusArea(task.id);

        item.setAttribute('menu-width', '150px');
        if (state.timerState.activeTaskId === task.id) item.setAttribute('active', '');

        const clockIcon = '<svg viewBox="0 0 24 24" fill="currentColor" style="opacity: 0.7;"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>';
        
        const isBreak = state.timerState.mode !== 'work';
        const modeClass = isBreak ? (state.timerState.mode === 'longBreak' ? 'long-break' : 'break') : 'work';
        const sessionColor = isBreak ? 'var(--success)' : 'var(--danger)';

        item.innerHTML = `
            <button slot="menu" class="edit-btn"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg><span>Edit</span></button>
            <button slot="menu" class="completed-btn"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg><span>${task.completed ? 'Undo' : 'Done'}</span></button>
            <button slot="menu" class="danger delete-btn"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg><span>Delete</span></button>
            <button slot="indicator" class="focus-area-play-btn" style="color: ${task.color}">
                <svg class="focus-area-ring" viewBox="0 0 100 100">
                    <circle class="focus-area-ring-bg" cx="50" cy="50" r="45"></circle>
                    <circle class="focus-area-ring-progress ${modeClass}" cx="50" cy="50" r="45" stroke-dasharray="282.7" stroke-dashoffset="282.7" id="focusAreaRing-${task.id}" style="stroke: ${sessionColor}"></circle>
                </svg>
                ${state.timerState.activeTaskId === task.id && state.timerState.isRunning ? '⏸' : '▶'}
            </button>
            <div class="focus-area-info">
                <div class="focus-area-name" style="color: ${task.color}">${this._escapeHtml(task.name)}</div>
                <div class="focus-area-stats-row">
                    <span>${clockIcon}Today: ${this.formatDurationHM(todayTime)}</span>
                    <span class="stats-divider">|</span>
                    <span>${clockIcon}Total: ${this.formatDurationHM(totalTime)}</span>
                </div>
            </div>
        `;

        // Task Selection Logic
        item.onclick = (e) => {
            // Only trigger if we aren't clicking a specific button or sliding
            if (!e.target.closest('button') && !item.isOpen) {
                if (callbacks.onPlay) callbacks.onPlay(task);
            }
        };

        item.querySelector('.focus-area-play-btn').onclick = (e) => {
            e.stopPropagation();
            if (callbacks.onPlay) callbacks.onPlay(task);
        };
        item.querySelector('.edit-btn').onclick = () => {
            item.isOpen = false;
            if (callbacks.onEdit) callbacks.onEdit(task);
        };
        item.querySelector('.completed-btn').onclick = () => {
            item.isOpen = false;
            if (callbacks.onToggleComplete) callbacks.onToggleComplete(task.id);
        };
        item.querySelector('.delete-btn').onclick = () => {
            item.isOpen = false;
            if (callbacks.onDelete) callbacks.onDelete(task.id);
        };

        return item;
    }

    static _getTodayTimeForFocusArea(id) {
        const today = HistoryService.getLogicalDate();
        return state.sessions.filter(s => s.taskId === id && HistoryService.getLogicalDate(new Date(s.timestamp)) === today).reduce((acc, s) => acc + s.duration, 0);
    }

    static _getTotalTimeForFocusArea(id) {
        return state.sessions.filter(s => s.taskId === id).reduce((acc, s) => acc + s.duration, 0);
    }

    static renderPlan(callbacks = {}) {
        const list = document.getElementById('todayPlanList');
        const past = document.getElementById('pastPlanList');
        if (!list || !past) return;

        const active = [];
        const done = [];
        
        state.aims.forEach(a => {
            if (this._getTimeSpentOnAim(a) >= a.targetMinutes * 60) done.push(a);
            else active.push(a);
        });

        const renderAim = (a) => {
            const t = state.tasks.find(x => x.id === a.focusAreaId);
            const name = t ? t.name : 'Unknown Focus Area';
            const color = t ? t.color : '#58a6ff';
            const spent = this._getTimeSpentOnAim(a);
            const target = a.targetMinutes * 60;
            const h = Math.floor(a.targetMinutes / 60);
            const m = a.targetMinutes % 60;
            const str = h > 0 ? `${h}h ${m}m` : `${m}m`;
            
            let dl = 'Until Done';
            let exp = false;
            if (a.deadline) {
                const today = HistoryService.getLogicalDate();
                dl = a.deadline === today ? 'by Today' : `by ${new Date(a.deadline).toLocaleDateString('en-US', {month:'short', day:'numeric'})}`;
                if (a.deadline < today) exp = true;
            }

            const item = document.createElement('sliding-card');
            item.setAttribute('variant', state.settings.cardVariant || 'glass');
            const reached = spent >= target;
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
                        <div class="aim-name" title="${this._escapeHtml(name)}">${this._escapeHtml(name)}</div>
                    </div>
                    <div class="aim-bottom-row">
                        <progress-compact value="${spent}" max="${target}" color="${color}" label="${str}"></progress-compact>
                        <div class="aim-meta"><span>${str}</span></div>
                        <div class="aim-deadline-badge ${exp ? 'expired' : ''}">${dl}</div>
                    </div>
                </div>
            `;

            if (item.querySelector('.edit-btn')) item.querySelector('.edit-btn').onclick = () => {
                item.isOpen = false;
                if (callbacks.onEditAim) callbacks.onEditAim(a.id);
            };
            if (item.querySelector('.go-again-btn')) item.querySelector('.go-again-btn').onclick = () => {
                item.isOpen = false;
                if (callbacks.onGoAgain) callbacks.onGoAgain(a);
            };
            if (item.querySelector('.share-milestone-btn')) item.querySelector('.share-milestone-btn').onclick = () => {
                item.isOpen = false;
                if (callbacks.onShare) callbacks.onShare(name, a.targetMinutes);
            };
            item.querySelector('.delete-btn').onclick = () => {
                item.isOpen = false;
                if (callbacks.onDeleteAim) callbacks.onDeleteAim(a.id);
            };
            return item;
        };

        list.innerHTML = '';
        active.forEach(a => list.appendChild(renderAim(a)));
        past.innerHTML = '';
        done.forEach(a => past.appendChild(renderAim(a)));
    }

    static _getTimeSpentOnAim(aim) {
        return state.sessions
            .filter(s => s.taskId === aim.focusAreaId && (!aim.deadline || HistoryService.getLogicalDate(new Date(s.timestamp)) <= aim.deadline))
            .reduce((acc, s) => acc + s.duration, 0);
    }

    static getActiveAimForFocusArea(focusAreaId) {
        const today = HistoryService.getLogicalDate();
        return state.aims.find(a => a.focusAreaId === focusAreaId && (!a.deadline || a.deadline >= today));
    }

    static parseDuration(val) {
        val = val.toLowerCase().trim(); if (!val) return 0; let m = 0;
        if (val.includes(':')) { const p = val.split(':'); m = (parseInt(p[0]) || 0) * 60 + (parseInt(p[1]) || 0); }
        else if (val.includes('h')) { const p = val.split('h'); m += (parseFloat(p[0]) || 0) * 60; if (p[1]) m += parseFloat(p[1].replace('min', '').replace('m', '').trim()) || 0; }
        else m = parseFloat(val) || 0; return Math.round(m);
    }

    static _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
