import { state } from '../state/store.js';
import { HistoryService } from '../services/history.service.js';
import { FocusService } from '../services/focus.service.js';

export class FocusView {
    static activeCategory = null;
    static unifiedSearchQuery = '';
    static taskSearchQuery = '';
    static callbacks = {};

    static formatDurationHM(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    }

    static parseDuration(str) {
        if (!str) return 0;
        if (str.includes(':')) {
            const [h, m] = str.split(':').map(Number);
            return (h || 0) * 60 + (m || 0);
        }
        if (str.includes('h')) {
            const h = parseFloat(str);
            return Math.round(h * 60);
        }
        return parseInt(str) || 0;
    }

    static updateLevelUI(previousTotalXp = null) {
        const xpEl = document.getElementById('userXP');
        const rankEl = document.getElementById('userRank');
        const headerAvatar = document.getElementById('headerAvatar');
        const levelContainer = document.getElementById('levelContainer');
        
        if (!xpEl || !rankEl) return;
        
        xpEl.textContent = state.totalXp.toLocaleString();
        const sidenavUserXP = document.getElementById('sidenavUserXP');
        if (sidenavUserXP) sidenavUserXP.textContent = `${state.totalXp.toLocaleString()} XP`;
        if (levelContainer) levelContainer.title = `Level ${state.level}`;
        if (headerAvatar) headerAvatar.textContent = state.avatar || '🦉';
        
        const personaCircle = document.getElementById('personaCircle');
        if (personaCircle) personaCircle.textContent = state.avatar || '🦉';
        
        rankEl.textContent = FocusService.getRank(state.level);
    }

    static init(callbacks = {}) {
        this.callbacks = callbacks;
        const unifiedSearch = document.getElementById('faUnifiedSearch');
        const unifiedClear = document.getElementById('faUnifiedClear');
        const taskSearch = document.getElementById('faTaskSearch');
        const backBtn = document.getElementById('faBackToCats');

        if (unifiedSearch) {
            unifiedSearch.oninput = (e) => {
                this.unifiedSearchQuery = e.target.value.trim().toLowerCase();
                if (unifiedClear) unifiedClear.classList.toggle('visible', this.unifiedSearchQuery.length > 0);
                this.renderCategories(this.callbacks);
            };
        }

        if (unifiedClear) {
            unifiedClear.onclick = () => {
                if (unifiedSearch) {
                    unifiedSearch.value = '';
                    this.unifiedSearchQuery = '';
                    unifiedClear.classList.remove('visible');
                    this.renderCategories(this.callbacks);
                    unifiedSearch.focus();
                }
            };
        }

        if (taskSearch) {
            taskSearch.oninput = (e) => {
                this.taskSearchQuery = e.target.value.trim().toLowerCase();
                if (this.activeCategory) {
                    this.renderTasks(this.activeCategory, this.callbacks);
                }
            };
        }

        if (backBtn) {
            backBtn.onclick = () => this.goBack();
        }

        this.renderFocusAreas(callbacks);
    }

    static renderFocusAreas(callbacks = this.callbacks) {
        if (this.activeCategory) {
            this.renderTasks(this.activeCategory, callbacks);
        } else {
            this.renderCategories(callbacks);
        }
    }

    static renderCategories(callbacks = this.callbacks) {
        const body = document.getElementById('faCatBody');
        if (!body) return;
        body.innerHTML = '';

        const q = this.unifiedSearchQuery;
        
        // --- 1. DEFAULT STATE (No Query) ---
        if (!q) {
            const categories = [...state.categories];
            const hasCompleted = state.tasks.some(t => t.completed);
            if (hasCompleted) {
                if (!categories.find(c => c.name === 'Completed')) {
                    categories.push({ name: 'Completed', icon: '✅', isVirtual: true });
                }
            }

            categories.forEach(cat => {
                const count = state.tasks.filter(t => 
                    (cat.name === 'Completed') ? t.completed : (t.category === cat.name && !t.completed)
                ).length;
                body.appendChild(this._createCategoryItem(cat, count, q, callbacks));
            });
            return;
        }

        // --- 2. SEARCH STATE ---
        const matchedCats = state.categories.filter(c => c.name.toLowerCase().includes(q));
        if ('completed'.includes(q) && state.tasks.some(t => t.completed)) {
            matchedCats.push({ name: 'Completed', icon: '✅', isVirtual: true });
        }

        const matchedTasks = state.tasks.filter(t => 
            t.name.toLowerCase().includes(q)
        );

        if (matchedCats.length === 0 && matchedTasks.length === 0) {
            body.innerHTML = `<div class="empty-state"><strong>No matches found</strong>Try a different search</div>`;
            return;
        }

        // Section: Categories
        if (matchedCats.length > 0) {
            const label = document.createElement('div');
            label.className = 'fa-results-label';
            label.textContent = `Categories · ${matchedCats.length}`;
            body.appendChild(label);

            matchedCats.forEach(cat => {
                const count = state.tasks.filter(t => 
                    (cat.name === 'Completed') ? t.completed : (t.category === cat.name && !t.completed)
                ).length;
                
                const item = this._createCategoryItem(cat, count, q, callbacks);
                body.appendChild(item);
            });
        }

        // Section: Focus Areas
        if (matchedTasks.length > 0) {
            const label = document.createElement('div');
            label.className = 'fa-results-label';
            label.textContent = `Focus Areas · ${matchedTasks.length}`;
            body.appendChild(label);

            matchedTasks.forEach(task => {
                const item = this._createTaskItem(task, callbacks);
                body.appendChild(item);
            });
        }
    }

    static _createCategoryItem(cat, count, q, callbacks = this.callbacks) {
        const item = document.createElement('div');
        item.className = 'fa-cat-item';
        
        const isDefault = cat.isDefault || cat.isVirtual;
        const moreBtnHtml = !isDefault ? `
            <button class="fa-more-btn" title="Category Actions">
                <i class="ph ph-dots-three-vertical"></i>
            </button>
        ` : '';

        item.innerHTML = `
            <span class="fa-cat-icon">${cat.icon === '📁' || !cat.icon ? '<i class="ph ph-folder"></i>' : cat.icon}</span>
            <div class="fa-cat-info">
                <span class="fa-cat-name">${this._highlight(cat.name, q)}</span>
                <div class="fa-cat-subtitle">
                    <span class="fa-mini-badge">${count}</span>
                    <span>Focus Area${count !== 1 ? 's' : ''}</span>
                </div>
            </div>
            ${moreBtnHtml}
            <i class="ph ph-caret-right fa-cat-chevron"></i>
        `;

        item.onclick = (e) => {
            const moreBtn = e.target.closest('.fa-more-btn');
            if (moreBtn) {
                e.stopPropagation();
                this._showCategoryPopover(moreBtn, cat.name, callbacks);
                return;
            }
            this.drillInto(cat.name);
        };

        if (cat.name !== 'Completed') {
            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                item.classList.add('draggable-over');
            });
            item.addEventListener('dragenter', (e) => {
                e.preventDefault();
                item.classList.add('draggable-over');
            });
            item.addEventListener('dragleave', () => {
                item.classList.remove('draggable-over');
            });
            item.addEventListener('drop', (e) => {
                e.preventDefault();
                item.classList.remove('draggable-over');
                const taskId = e.dataTransfer.getData('taskId') || e.dataTransfer.getData('text/plain');
                if (taskId && callbacks.onMoveToCategory) {
                    callbacks.onMoveToCategory(taskId, cat.name);
                }
            });
        }
        return item;
    }

    static drillInto(categoryName) {
        this.activeCategory = categoryName;
        this.taskSearchQuery = '';
        const searchInput = document.getElementById('faTaskSearch');
        if (searchInput) searchInput.value = '';

        const cat = state.categories.find(c => c.name === categoryName) || { name: categoryName, icon: '✅' };
        document.getElementById('faTaskPanelTitle').textContent = cat.name;
        
        const count = state.tasks.filter(t => 
            (categoryName === 'Completed') ? t.completed : (t.category === categoryName && !t.completed)
        ).length;
        document.getElementById('faTaskPanelSub').textContent = `${count} focus area${count !== 1 ? 's' : ''}`;

        this.renderTasks(categoryName, this.callbacks);
        document.getElementById('faPanels').classList.add('show-tasks');
    }

    static goBack() {
        this.activeCategory = null;
        document.getElementById('faPanels').classList.remove('show-tasks');
        this.renderCategories(this.callbacks);
    }

    static renderTasks(categoryName, callbacks = this.callbacks) {
        const body = document.getElementById('faTaskBody');
        if (!body) return;
        body.innerHTML = '';

        const q = this.taskSearchQuery;
        const tasks = state.tasks.filter(t => 
            (categoryName === 'Completed') ? t.completed : (t.category === categoryName && !t.completed)
        ).filter(t => t.name.toLowerCase().includes(q));

        if (tasks.length === 0) {
            body.innerHTML = `<div class="empty-state"><strong>No tasks found</strong></div>`;
            return;
        }

        tasks.forEach(task => {
            const item = this._createTaskItem(task, callbacks);
            body.appendChild(item);
        });
    }

    static _highlight(text, query) {
        if (!query) return text;
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
    }

    static populateCategorySelects() {
        const select = document.getElementById('focusAreaCategorySelect');
        const editSelect = document.getElementById('focusAreaEditCategory');
        if (!select) return;

        const options = state.categories
            .filter(c => !c.isDefault)
            .map(c => `<option value="${c.name}">${c.icon} ${c.name}</option>`)
            .join('');

        const uncategorized = state.categories.find(c => c.isDefault) || { name: 'Uncategorized', icon: '📁' };
        
        const finalHtml = `
            <option value="${uncategorized.name}">${uncategorized.icon} ${uncategorized.name}</option>
            ${options}
            <option value="__new__">+ Add New Category...</option>
        `;
        
        select.innerHTML = finalHtml;
        if (editSelect) editSelect.innerHTML = finalHtml;
    }

    static _showCategoryPopover(anchorEl, categoryName, callbacks) {
        document.querySelectorAll('.fa-popover').forEach(p => p.remove());

        const popover = document.createElement('div');
        popover.className = 'fa-popover';
        
        const editBtn = document.createElement('button');
        editBtn.className = 'fa-popover-item';
        editBtn.innerHTML = '<i class="ph ph-pencil"></i><span>Rename</span>';
        editBtn.onclick = () => {
            popover.remove();
            if (callbacks.onEditCategory) callbacks.onEditCategory(categoryName);
        };

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'fa-popover-item danger';
        deleteBtn.innerHTML = '<i class="ph ph-trash"></i><span>Delete</span>';
        deleteBtn.onclick = () => {
            popover.remove();
            if (callbacks.onDeleteCategory) callbacks.onDeleteCategory(categoryName);
        };

        popover.appendChild(editBtn);
        popover.appendChild(deleteBtn);
        document.body.appendChild(popover);

        const rect = anchorEl.getBoundingClientRect();
        popover.style.top = `${rect.bottom + window.scrollY + 5}px`;
        popover.style.left = `${rect.right + window.scrollX - popover.offsetWidth}px`;

        const closePopover = (e) => {
            if (!popover.contains(e.target) && !anchorEl.contains(e.target)) {
                popover.remove();
                document.removeEventListener('mousedown', closePopover);
            }
        };
        setTimeout(() => document.addEventListener('mousedown', closePopover), 0);
    }

    static _showTaskPopover(anchorEl, task, callbacks) {
        document.querySelectorAll('.fa-popover').forEach(p => p.remove());

        const popover = document.createElement('div');
        popover.className = 'fa-popover';
        
        const editBtn = document.createElement('button');
        editBtn.className = 'fa-popover-item';
        editBtn.innerHTML = '<i class="ph ph-pencil"></i><span>Edit</span>';
        editBtn.onclick = () => {
            popover.remove();
            if (callbacks.onEdit) callbacks.onEdit(task);
        };

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'fa-popover-item danger';
        deleteBtn.innerHTML = '<i class="ph ph-trash"></i><span>Delete</span>';
        deleteBtn.onclick = () => {
            popover.remove();
            if (callbacks.onDelete) callbacks.onDelete(task.id);
        };

        popover.appendChild(editBtn);
        popover.appendChild(deleteBtn);
        document.body.appendChild(popover);

        const rect = anchorEl.getBoundingClientRect();
        popover.style.top = `${rect.bottom + window.scrollY + 5}px`;
        popover.style.left = `${rect.right + window.scrollX - popover.offsetWidth}px`;

        const closePopover = (e) => {
            if (!popover.contains(e.target) && !anchorEl.contains(e.target)) {
                popover.remove();
                document.removeEventListener('mousedown', closePopover);
            }
        };
        setTimeout(() => document.addEventListener('mousedown', closePopover), 0);
    }

    static _createTaskItem(task, callbacks) {
        const item = document.createElement('div');
        const isCurrent = state.timerState.activeTaskId === task.id;
        item.className = `fa-row ${isCurrent ? 'active' : ''}`;

        const panel = document.getElementById('faTaskPanel');
        const isManagement = panel?.classList.contains('management-mode');

        item.innerHTML = `
            <button class="fa-row-play ${isCurrent ? 'active' : ''}" title="Start focus" tabindex="-1">
                <i class="ph ${isCurrent ? 'ph-pause' : 'ph-play'}"></i>
            </button>
            <span class="fa-row-color" style="background:${task.color || 'var(--border)'}"></span>
            <span class="fa-row-name">${this._highlight(task.name, this.taskSearchQuery || this.unifiedSearchQuery)}</span>
            <button class="fa-more-btn fa-row-more" title="More Actions">
                <i class="ph ph-dots-three-vertical"></i>
            </button>
        `;

        item.onclick = (e) => {
            if (e.target.closest('.fa-row-more')) {
                e.stopPropagation();
                this._showTaskPopover(e.target.closest('.fa-row-more'), task, callbacks);
                return;
            }
            if (e.target.closest('.fa-row-play')) {
                e.stopPropagation();
                if (!isManagement && callbacks.onPlay) callbacks.onPlay(task);
                return;
            }
            if (!isManagement && callbacks.onPlay) callbacks.onPlay(task);
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

            const editIcon = '<i class="ph ph-pencil"></i>';
            const deleteIcon = '<i class="ph ph-trash"></i>';
            const shareIcon = '<i class="ph ph-share-network"></i>';
            const budgetIcon = '<i class="ph ph-plus-circle"></i>';
            const againIcon = '<i class="ph ph-arrow-clockwise"></i>';

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

    static _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
