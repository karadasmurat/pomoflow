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
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                            ${isCurrent ? '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>' : '<path d="M8 5v14l11-7z"/>'}
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
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
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
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
            </button>
        ` : '';

        item.innerHTML = `
            <div class="fa-cat-icon">${cat.icon || '📁'}</div>
            <div class="fa-cat-info">
                <div class="fa-cat-name">${this._highlight(cat.name, q)}</div>
                <div class="fa-cat-meta">
                    <span class="fa-cat-badge">${count}</span>
                    <span>focus area${count !== 1 ? 's' : ''}</span>
                </div>
            </div>
            <div style="display: flex; align-items: center; gap: 4px;">
                ${moreBtnHtml}
                <svg class="fa-cat-chevron" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
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
        editBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg><span>Rename</span>';
        editBtn.onclick = () => {
            popover.remove();
            if (callbacks.onEditCategory) callbacks.onEditCategory(categoryName);
        };

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'fa-popover-item danger';
        deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg><span>Delete</span>';
        deleteBtn.onclick = () => {
            popover.remove();
            // Category deletion not fully implemented in app.js yet, but adding placeholder
            alert('Category deletion is managed by editing focus areas.');
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
        editBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg><span>Edit</span>';
        editBtn.onclick = () => {
            popover.remove();
            if (callbacks.onEdit) callbacks.onEdit(task);
        };

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'fa-popover-item danger';
        deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg><span>Delete</span>';
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
        const item = document.createElement('sliding-card');
        item.setAttribute('variant', state.settings.cardVariant || 'glass');
        
        const panel = document.getElementById('faTaskPanel');
        const isManagement = panel?.classList.contains('management-mode');
        
        if (isManagement) {
            item.setAttribute('locked', '');
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
        
        const playBtnHtml = !isManagement ? `
            <button class="focus-area-play-btn ${isCurrent ? 'active' : ''}">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    ${isCurrent ? '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>' : '<path d="M8 5v14l11-7z"/>'}
                </svg>
            </button>
        ` : '';

        const clockIcon = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 4px; opacity: 0.5;"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>';

        item.innerHTML = `
            <button slot="menu" class="edit-btn"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/></svg><span>Edit</span></button>
            <button slot="menu" class="completed-btn"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg><span>${task.completed ? 'Undo' : 'Done'}</span></button>
            <button slot="menu" class="danger delete-btn"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg><span>Delete</span></button>
            
            <div class="drag-handle-vertical" slot="indicator">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="opacity: 0.6;"><path d="M10 9h4V6h3l-5-5-5 5h3v3zm-1 1H6V7l-5 5 5 5v-3h3v-4zm14 2l-5-5v3h-3v4h3v3l5-5zm-9 3h-4v3H7l5 5 5-5h-3v-3z"/></svg>
            </div>

            ${playBtnHtml}

            <div class="focus-area-info">
                <div class="focus-area-name" style="color: ${task.color}">${this._highlight(task.name, this.taskSearchQuery || this.unifiedSearchQuery)}</div>
                <div class="focus-area-stats-row">
                    <span>${clockIcon}Today: ${this.formatDurationHM(todayTime)}</span>
                    <span class="stats-divider">|</span>
                    <span>${clockIcon}Total: ${this.formatDurationHM(totalTime)}</span>
                </div>
            </div>
        `;

        item.onclick = (e) => {
            if (isManagement) return;
            if (!e.target.closest('button') && !item.isOpen) {
                if (callbacks.onPlay) callbacks.onPlay(task);
            }
        };

        const playBtn = item.querySelector('.focus-area-play-btn');
        if (playBtn) playBtn.onclick = (e) => { e.stopPropagation(); if (callbacks.onPlay) callbacks.onPlay(task); };
        item.querySelector('.edit-btn').onclick = () => { item.isOpen = false; if (callbacks.onEdit) callbacks.onEdit(task); };
        item.querySelector('.completed-btn').onclick = () => { item.isOpen = false; if (callbacks.onToggleComplete) callbacks.onToggleComplete(task.id); };
        item.querySelector('.delete-btn').onclick = () => { item.isOpen = false; if (callbacks.onDelete) callbacks.onDelete(task.id); };

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

    static _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
