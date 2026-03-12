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
                const item = document.createElement('div');
                item.className = 'fa-cat-item'; 
                
                const isCurrent = state.timerState.activeTaskId === task.id;
                const playIconHtml = `
                    <button class="focus-area-play-btn ${isCurrent ? 'active' : ''}" style="margin: 0; pointer-events: none;">
                        <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor">
                            ${isCurrent ? '<path d="M80,48h48V208H80Zm48,0V208h48V48Z"></path>' : '<path d="M228.44,112.64l-144-88A16,16,0,0,0,60,38.62V217.38a16,16,0,0,0,24.44,13.34l144-88A16,16,0,0,0,228.44,112.64Z"></path>'}
                        </svg>
                    </button>
                `;

                item.innerHTML = `
                    <div class="fa-cat-icon">
                        ${playIconHtml}
                    </div>
                    <div class="fa-cat-info">
                        <div class="fa-cat-name" style="color: ${task.color}">${this._highlight(task.name, q)}</div>
                        <div class="fa-cat-meta">${task.category}</div>
                    </div>
                    <button class="fa-more-btn" title="More Actions">
                        <svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor"><path d="M112,60a16,16,0,1,1,16,16A16,16,0,0,1,112,60Zm16,52a16,16,0,1,0,16,16A16,16,0,0,0,128,112Zm0,68a16,16,0,1,0,16,16A16,16,0,0,0,128,180Z"></path></svg>
                    </button>
                `;
                
                item.onclick = (e) => {
                    const moreBtn = e.target.closest('.fa-more-btn');
                    if (moreBtn) {
                        e.stopPropagation();
                        this._showTaskPopover(moreBtn, task, callbacks);
                        return;
                    }
                    if (callbacks.onPlay) callbacks.onPlay(task);
                };
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
                <svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor"><path d="M112,60a16,16,0,1,1,16,16A16,16,0,0,1,112,60Zm16,52a16,16,0,1,0,16,16A16,16,0,0,0,128,112Zm0,68a16,16,0,1,0,16,16A16,16,0,0,0,128,180Z"></path></svg>
            </button>
        ` : '';

        item.innerHTML = `
            <div class="fa-cat-icon">${cat.icon === '📁' || !cat.icon ? '<svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor"><path d="M216,72H131.31L104,44.69A15.86,15.86,0,0,0,92.69,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V88A16,16,0,0,0,216,72Zm0,128H40V56H92.69L120,83.31A15.86,15.86,0,0,0,131.31,88H216Z"></path></svg>' : cat.icon}</div>
            <div class="fa-cat-info">
                <div class="fa-cat-name">${this._highlight(cat.name, q)}</div>
                <div class="fa-cat-meta">
                    <span class="fa-cat-badge">${count}</span>
                    <span>focus area${count !== 1 ? 's' : ''}</span>
                </div>
            </div>
            <div style="display: flex; align-items: center; gap: 4px;">
                ${moreBtnHtml}
                <svg class="fa-cat-chevron" width="14" height="14" fill="none" stroke="currentColor" stroke-width="24" viewBox="0 0 256 256"><polyline points="96 48 176 128 96 208" stroke-linecap="round" stroke-linejoin="round"></polyline></svg>
            </div>
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
        editBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM192,108,148,64l24-24,44,44Zm-101,96H48V160l88-88,44,44Z"></path></svg><span>Rename</span>';
        editBtn.onclick = () => {
            popover.remove();
            if (callbacks.onEditCategory) callbacks.onEditCategory(categoryName);
        };

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'fa-popover-item danger';
        deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"></path></svg><span>Delete</span>';
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
        editBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM192,108,148,64l24-24,44,44Zm-101,96H48V160l88-88,44,44Z"></path></svg><span>Edit</span>';
        editBtn.onclick = () => {
            popover.remove();
            if (callbacks.onEdit) callbacks.onEdit(task);
        };

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'fa-popover-item danger';
        deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"></path></svg><span>Delete</span>';
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
        item.className = 'fa-cat-item';
        
        const panel = document.getElementById('faTaskPanel');
        const isManagement = panel?.classList.contains('management-mode');
        
        if (isManagement) {
            item.setAttribute('draggable', 'true');
        } else {
            item.setAttribute('draggable', 'false');
        }

        const handleDragStart = (e) => {
            if (!isManagement) { e.preventDefault(); return; }
            item.classList.add('is-dragging');
            document.body.classList.add('is-dragging-active');
            e.dataTransfer.setData('taskId', task.id);
            e.dataTransfer.setData('text/plain', task.id);
            e.dataTransfer.effectAllowed = 'move';
            if (e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(item, 24, 24);
            document.querySelectorAll('.fa-cat-item').forEach(g => g.classList.add('can-drop-active'));
        };

        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragend', () => {
            item.classList.remove('is-dragging');
            document.body.classList.remove('is-dragging-active');
            document.querySelectorAll('.can-drop-active').forEach(g => g.classList.remove('can-drop-active'));
        });

        const todayTime = this._getTodayTimeForFocusArea(task.id);
        const totalTime = this._getTotalTimeForFocusArea(task.id);
        const isCurrent = state.timerState.activeTaskId === task.id;
        
        const playIconHtml = `
            <button class="focus-area-play-btn ${isCurrent ? 'active' : ''}" style="margin: 0; pointer-events: none;">
                <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor">
                    ${isCurrent ? '<path d="M80,48h48V208H80Zm48,0V208h48V48Z"></path>' : '<path d="M228.44,112.64l-144-88A16,16,0,0,0,60,38.62V217.38a16,16,0,0,0,24.44,13.34l144-88A16,16,0,0,0,228.44,112.64Z"></path>'}
                </svg>
            </button>
        `;

        item.innerHTML = `
            <div class="fa-cat-icon">
                ${isManagement ? 
                    '<svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor" style="opacity: 0.6;"><path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM192,108,148,64l24-24,44,44Zm-101,96H48V160l88-88,44,44Z"></path></svg>' : 
                    playIconHtml
                }
            </div>
            <div class="fa-cat-info">
                <div class="fa-cat-name" style="color: ${task.color}">${this._highlight(task.name, this.taskSearchQuery || this.unifiedSearchQuery)}</div>
                <div class="fa-cat-meta">
                    <span>Today: ${this.formatDurationHM(todayTime)}</span>
                    <span style="opacity: 0.3;">|</span>
                    <span>Total: ${this.formatDurationHM(totalTime)}</span>
                </div>
            </div>
            <button class="fa-more-btn" title="More Actions">
                <svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor"><path d="M112,60a16,16,0,1,1,16,16A16,16,0,0,1,112,60Zm16,52a16,16,0,1,0,16,16A16,16,0,0,0,128,112Zm0,68a16,16,0,1,0,16,16A16,16,0,0,0,128,180Z"></path></svg>
            </button>
        `;

        item.onclick = (e) => {
            const moreBtn = e.target.closest('.fa-more-btn');
            if (moreBtn) {
                e.stopPropagation();
                this._showTaskPopover(moreBtn, task, callbacks);
                return;
            }
            if (isManagement) return;
            if (callbacks.onPlay) callbacks.onPlay(task);
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

            const editIcon = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM192,108,148,64l24-24,44,44Zm-101,96H48V160l88-88,44,44Z"></path></svg>';
            const deleteIcon = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"></path></svg>';
            const shareIcon = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M216,128a32,32,0,1,0-48,27.75V156a8,8,0,0,0,8,8h32a8,8,0,0,0,8-8V155.75A32.06,32.06,0,0,0,216,128ZM184,144a16,16,0,1,1,16-16A16,16,0,0,1,184,144ZM72,128a32,32,0,1,0-48,27.75V156a8,8,0,0,0,8,8H64a8,8,0,0,0,8-8V155.75A32.06,32.06,0,0,0,72,128ZM40,144a16,16,0,1,1,16-16A16,16,0,0,1,40,144Zm176,16a32,32,0,1,0-48,27.75V188a8,8,0,0,0,8,8h32a8,8,0,0,0,8-8v-.25A32.06,32.06,0,0,0,216,160Zm-32,16a16,16,0,1,1,16-16A16,16,0,0,1,184,176ZM72,160a32,32,0,1,0-48,27.75V188a8,8,0,0,0,8,8H64a8,8,0,0,0,8-8v-.25A32.06,32.06,0,0,0,72,160ZM40,176a16,16,0,1,1,16-16A16,16,0,0,1,40,176Z"></path></svg>';
            const budgetIcon = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm36-88a4,4,0,0,1-4,4H132v28h20a4,4,0,0,1,0,8H132v12a8,8,0,0,1-16,0V176H96a4,4,0,0,1,0-8h20V140H96a4,4,0,0,1,0-8h20V104a8,8,0,0,1,16,0v28h28A4,4,0,0,1,164,132Z"></path></svg>';
            const againIcon = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M240,128a112.12,112.12,0,0,1-112,112A111.09,111.09,0,0,1,41.48,200H64a12,12,0,0,0,0-24H16a12,12,0,0,0-12,12v48a12,12,0,0,0,24,0V216.52A135,135,0,0,0,128,264c75,0,136-61,136-136S203,128-128,128,128A12.06,12.06,0,0,0,240,128ZM128,16a112,112,0,0,1,86.52,40H192a12,12,0,0,0,0,24h48a12,12,0,0,0,12-12V24a12,12,0,0,0-24,0V43.48A135.25,135.25,0,0,0,128,0,136,136,0,0,0,0,136a12,12,0,0,0,24,0A112.12,112.12,0,0,1,128,16Z"></path></svg>';

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
