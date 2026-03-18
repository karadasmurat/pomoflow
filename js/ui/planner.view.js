/**
 * PlannerView
 * Handles the logic for the Focus Planner modal, integrating with app state and DB.
 */

import { state } from '../state/store.js';
import { HistoryService } from '../services/history.service.js';
import { FocusService } from '../services/focus.service.js';
import { dbManager } from '../db.js';
import { uuidv7 } from '../utils/uuid.js';

export const PlannerView = {
    // ── STATE ──
    SESSION_DURATION: 40,   // minutes
    SHORT_BREAK: 5,
    LONG_BREAK: 20,

    weekOffset: 0,  // 0 = current week
    sessionCount: 2,
    pendingAreaId: null, // Stores ID now, not just name
    pendingColor: 'green',
    pendingDay: 0,
    pendingHour: 9,
    pendingMinutes: 0,
    activeFilter: 'all',

    DAYS: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    HOURS: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19], // 8am – 7pm
    ROW_HEIGHT: 72, // px per hour

    blocks: [],
    paths: [],        // loaded from DB
    activePath: null, // currently selected path filter (id string or null)
    pendingPathId: null, // path selected in block popover
    selectedPathColor: '#3D8F5A', // for path creation modal

    // Drag state
    dragging: { areaId: null, color: null },
    draggingPath: null,     // { id, name, color } when dragging a path card
    draggingDeadline: false, // true when dragging the "set deadline" card

    // ── INIT ──
    init() {
        console.log('PlannerView setupEventListeners called'); // Added for debugging
        this.setupEventListeners();
    },

    open() {
        console.log('PlannerView open called'); // Debugging log
        document.getElementById('focusPlannerOverlay').style.display = 'block';
        this.weekOffset = 0;
        this.loadData().then(() => this.render());
    },

    close() {
        document.getElementById('focusPlannerOverlay').style.display = 'none';
        this.closePopover();
    },

    // ── DATA LOADING ──
    async loadData() {
        const dates = this.getWeekDates(this.weekOffset);
        const startStr = dates[0].toISOString().split('T')[0];
        const endStr = dates[6].toISOString().split('T')[0];

        // Load paths
        if (dbManager.initialized) {
            this.paths = await dbManager.getAllPaths();
            // Auto-archive paths whose deadline has passed
            const today = new Date().toISOString().split('T')[0];
            for (const p of this.paths) {
                if (p.status === 'active' && p.deadline && p.deadline < today) {
                    console.log('[archivePath] auto-archiving expired path:', p.id, p.name);
                    await dbManager.archivePath(p.id);
                    p.status = 'archived';
                }
            }
        }

        // Load planned blocks
        let dbBlocks = [];
        if (dbManager.initialized) {
            dbBlocks = await dbManager.getPlannedBlocksForWeek(startStr, endStr);
        }

        this.blocks = dbBlocks.map(b => ({
            id: b.id,
            day: new Date(b.planned_date + 'T00:00:00').getDay() === 0 ? 6 : new Date(b.planned_date + 'T00:00:00').getDay() - 1,
            startHour: Math.floor(b.start_minutes / 60),
            startMin: b.start_minutes % 60,
            sessions: this.calcSessionsFromDuration(b.duration_minutes),
            areaId: b.focus_area_id,
            areaName: b.area_name || 'Unknown',
            color: this.mapColor(b.area_color),
            type: 'planned',
            label: b.notes,
            pathId: b.path_id || null,
            pathName: b.path_name || null,
            pathColor: b.path_color || null,
            walked: !!b.walked_session_id
        }));
    },

    async saveBlock(block) {
        if (!dbManager.initialized) return;

        const date = this.getWeekDates(this.weekOffset)[block.day];
        const dateStr = date.toISOString().split('T')[0];
        const startMins = block.startHour * 60 + block.startMin;
        const durationMins = this.calcDuration(block.sessions);

        const dbBlock = {
            id: block.id || uuidv7(),
            focusAreaId: block.areaId,
            plannedDate: dateStr,
            startMinutes: startMins,
            durationMinutes: durationMins,
            notes: block.label,
            pathId: block.pathId || null
        };

        console.log('[saveBlock] inserting planned block:', dbBlock);
        await dbManager.insertPlannedBlock(dbBlock);
        if (!block.id) block.id = dbBlock.id;
        console.log('[saveBlock] saved with id:', dbBlock.id);
    },

    async deleteBlock(blockId) {
        if (dbManager.initialized) {
            console.log('[deleteBlock]', blockId);
            await dbManager.deletePlannedBlock(blockId);
        }
        this.blocks = this.blocks.filter(b => b.id !== blockId);
        this.render();
    },

    // ── HELPERS ──
    getAreas() {
        // Return active tasks from global state
        return state.tasks.filter(t => !t.completed).map(t => ({
            id: t.id,
            name: t.name,
            color: this.mapColor(t.color)
        }));
    },

    mapColor(hex) {
        // Simple mapping from hex to our CSS variable names if needed
        const map = {
            '#58a6ff': 'blue',
            '#38bdf8': 'blue',
            '#6366f1': 'violet',
            '#a855f7': 'violet',
            '#ec4899': 'violet',
            '#f97316': 'amber',
            '#fbbf24': 'amber',
            '#22c55e': 'green',
            '#4ade80': 'green'
        };
        return map[hex] || 'blue';
    },

    calcDuration(n) {
        if (n <= 0) return 0;
        return (n * this.SESSION_DURATION) + ((n - 1) * this.SHORT_BREAK) + (Math.floor(n / 4) * (this.LONG_BREAK - this.SHORT_BREAK));
    },

    calcSessionsFromDuration(mins) {
        return Math.round(mins / (this.SESSION_DURATION + this.SHORT_BREAK)) || 1;
    },

    formatDuration(mins) {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        if (h === 0) return `${m} min`;
        if (m === 0) return `${h}h`;
        return `${h}h ${m}m`;
    },

    addMinutes(h, m, mins) {
        const total = h * 60 + m + mins;
        const rh = Math.floor(total / 60) % 24;
        const rm = total % 60;
        return `${String(rh).padStart(2, '0')}:${String(rm).padStart(2, '0')}`;
    },

    formatTime(h, m) {
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    },

    getWeekDates(offset) {
        const today = new Date();
        const currentDay = today.getDay(); // 0=Sun, 1=Mon
        const mondayIndex = currentDay === 0 ? -6 : 1 - currentDay; // Distance to Monday
        const monday = new Date(today);
        monday.setDate(today.getDate() + mondayIndex + (offset * 7));
        
        return Array.from({ length: 7 }, (_, i) => {
            const d = new Date(monday);
            d.setDate(d.getDate() + i);
            return d;
        });
    },

    shiftWeek(dir) {
        this.weekOffset += dir;
        this.loadData().then(() => this.render());
    },

    goToday() {
        this.weekOffset = 0;
        this.loadData().then(() => this.render());
    },

    // ── RENDER ──
    render() {
        this.renderHead();
        this.renderBody();
        this.renderSidebarAreas();
        this.renderPathsSidebar();
    },

    renderHead() {
        const dates = this.getWeekDates(this.weekOffset);
        const head = document.getElementById('cal-head');
        const wl = document.getElementById('week-label');
        
        const d0 = dates[0], d6 = dates[6];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        
        if (d0.getMonth() === d6.getMonth()) {
            wl.textContent = `${months[d0.getMonth()]} ${d0.getDate()} – ${d6.getDate()}, ${d0.getFullYear()}`;
        } else {
            wl.textContent = `${months[d0.getMonth()]} ${d0.getDate()} – ${months[d6.getMonth()]} ${d6.getDate()}`;
        }

        // Keep gutter (first child)
        while (head.children.length > 1) head.removeChild(head.lastChild);

        const today = new Date();
        const isCurrentWeek = this.weekOffset === 0;

        dates.forEach((date, i) => {
            const isToday = isCurrentWeek && date.getDate() === today.getDate() && date.getMonth() === today.getMonth();
            const dateStr = date.toISOString().split('T')[0];
            const pathsEndingToday = this.paths.filter(p => p.status === 'active' && p.deadline === dateStr);

            const dh = document.createElement('div');
            dh.className = 'day-head' + (isToday ? ' today' : '');

            const row = document.createElement('div');
            row.className = 'day-head-row';

            const nameEl = document.createElement('div');
            nameEl.className = 'day-name';
            nameEl.textContent = this.DAYS[i];

            const numEl = document.createElement('div');
            numEl.className = 'day-num';
            numEl.textContent = date.getDate();
            if (isToday) {
                const dot = document.createElement('span');
                dot.className = 'today-indicator';
                numEl.appendChild(dot);
            }

            row.appendChild(nameEl);
            row.appendChild(numEl);
            dh.appendChild(row);

            // Path deadline flags
            const flagsEl = document.createElement('div');
            flagsEl.className = 'deadline-flags';
            pathsEndingToday.forEach(p => {
                const flag = document.createElement('div');
                flag.className = 'deadline-flag path-deadline-flag';
                flag.style.setProperty('--path-color', p.color);
                flag.innerHTML = `<span class="deadline-flag-icon" style="color:${p.color}">◎</span>${p.name}`;
                flagsEl.appendChild(flag);
            });
            dh.appendChild(flagsEl);

            // Deadline drag target on day header
            dh.addEventListener('dragover', e => {
                if (!this.draggingDeadline) return;
                e.preventDefault();
                dh.classList.add('deadline-drop-target');
            });
            dh.addEventListener('dragleave', () => dh.classList.remove('deadline-drop-target'));
            dh.addEventListener('drop', e => {
                e.preventDefault();
                dh.classList.remove('deadline-drop-target');
                if (this.draggingDeadline) this.handleDeadlineDrop(i);
            });

            head.appendChild(dh);
        });
    },

    renderBody() {
        const body = document.getElementById('cal-body');
        body.innerHTML = '';

        // Time gutter
        const gutter = document.createElement('div');
        gutter.className = 'time-gutter';
        this.HOURS.forEach(h => {
            const lbl = document.createElement('div');
            lbl.className = 'time-label';
            lbl.textContent = `${h}:00`;
            gutter.appendChild(lbl);
        });
        body.appendChild(gutter);

        const today = new Date();
        const isCurrentWeek = this.weekOffset === 0;

        // Day columns
        for (let d = 0; d < 7; d++) {
            const isToday = isCurrentWeek && (d === (today.getDay() === 0 ? 6 : today.getDay() - 1));
            const col = document.createElement('div');
            col.className = 'day-col' + (isToday ? ' today' : '');
            col.dataset.day = d;

            this.setupColumnEvents(col, d, isToday);

            // Hour lines
            this.HOURS.forEach((_, idx) => {
                const line = document.createElement('div');
                line.className = 'hour-line';
                line.style.top = `${idx * this.ROW_HEIGHT}px`;
                col.appendChild(line);

                const half = document.createElement('div');
                half.className = 'hour-line half';
                half.style.top = `${idx * this.ROW_HEIGHT + this.ROW_HEIGHT / 2}px`;
                col.appendChild(half);
            });

            // Now line
            if (isToday) {
                const nowH = today.getHours();
                const nowM = today.getMinutes();
                const nowTop = (nowH - this.HOURS[0]) * this.ROW_HEIGHT + (nowM / 60) * this.ROW_HEIGHT;
                if (nowTop >= 0 && nowTop <= this.HOURS.length * this.ROW_HEIGHT) {
                    const nl = document.createElement('div');
                    nl.className = 'now-line';
                    nl.style.top = `${nowTop}px`;
                    col.appendChild(nl);
                }
            }

            // Blocks (with filter awareness)
            const dayBlocks = this.blocks.filter(b => b.day === d && this.shouldShow(b.type));
            dayBlocks.forEach(b => {
                const el = this.createBlockEl(b);
                // Apply filter dim: if a path is active, dim blocks not in that path
                if (this.activePath && b.pathId !== this.activePath) {
                    el.classList.add('path-dimmed');
                }
                col.appendChild(el);
            });

            // Path deadline markers (paths ending on this day at 17:00 default)
            const dateStr = this.getWeekDates(this.weekOffset)[d].toISOString().split('T')[0];
            this.paths.filter(p => p.status === 'active' && p.deadline === dateStr).forEach(p => {
                const markerHour = 17;
                const top = (markerHour - this.HOURS[0]) * this.ROW_HEIGHT;
                const marker = document.createElement('div');
                marker.className = 'deadline-marker path-deadline-marker';
                marker.style.top = `${top}px`;
                marker.style.setProperty('--path-color', p.color);
                marker.innerHTML = `
                    <div class="deadline-marker-line" style="background:${p.color};"></div>
                    <div class="deadline-marker-label">
                        <span style="color:${p.color}">◎</span> ${p.name}
                        <span class="dm-time">end of day</span>
                    </div>
                `;
                col.appendChild(marker);
            });

            body.appendChild(col);
        }
        
        body.style.minHeight = `${this.HOURS.length * this.ROW_HEIGHT}px`;
    },

    renderSidebarAreas() {
        const container = document.getElementById('sidebar-areas');
        // Keep the first static element (New Block chip)
        const staticEl = container.firstElementChild;
        container.innerHTML = '';
        if (staticEl) container.appendChild(staticEl);

        const areas = this.getAreas();
        if (areas.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'sidebar-areas-empty';
            empty.textContent = 'No active focus areas found. Create some in the main app!';
            container.appendChild(empty);
            return;
        }

        areas.forEach(area => {
            const card = document.createElement('div');
            card.className = `area-card ${area.color}`;
            card.draggable = true;
            card.ondragstart = (e) => this.startDrag(e, area.id, area.name, area.color);
            card.innerHTML = `
                <div class="area-card-header">
                    <div class="area-card-name">${area.name}</div>
                </div>
                <div class="area-card-stats">
                    <div class="area-drag-hint">Drag to plan</div>
                </div>
                <div class="area-bar-track"><div class="area-bar-fill" style="width: 0%"></div></div>
            `;
            container.appendChild(card);
        });
    },

    renderPathsSidebar() {
        const list = document.getElementById('sidebar-paths-list');
        if (!list) return;
        list.innerHTML = '';

        const activePaths = this.paths.filter(p => p.status === 'active');
        const archivedPaths = this.paths.filter(p => p.status === 'archived');

        // Drag-to-deadline card
        const deadlineDragCard = document.createElement('div');
        deadlineDragCard.className = 'path-deadline-drag-card';
        deadlineDragCard.draggable = true;
        deadlineDragCard.innerHTML = `
            <div class="path-deadline-drag-icon">◎</div>
            <div class="path-deadline-drag-text">
                <div class="path-deadline-drag-label">New Path</div>
                <div class="path-deadline-drag-hint">Drag to set deadline</div>
            </div>
        `;
        deadlineDragCard.addEventListener('dragstart', e => this.startDeadlineDrag(e));
        list.appendChild(deadlineDragCard);


        // Active paths
        if (activePaths.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'path-empty';
            empty.textContent = 'No active paths. Create one to get started.';
            list.appendChild(empty);
        } else {
            activePaths.forEach(p => list.appendChild(this.createPathCard(p)));
        }

        // Archived section
        if (archivedPaths.length > 0) {
            const archiveHeader = document.createElement('div');
            archiveHeader.className = 'path-archive-header';
            archiveHeader.textContent = '── Archived ──';
            list.appendChild(archiveHeader);
            archivedPaths.forEach(p => {
                const card = this.createPathCard(p);
                card.classList.add('archived');
                list.appendChild(card);
            });
        }
    },

    createPathCard(p) {
        const card = document.createElement('div');
        card.className = 'path-card' + (this.activePath === p.id ? ' active' : '');
        card.onclick = () => this.setActivePath(p.id);

        if (p.status === 'active') {
            card.draggable = true;
            card.addEventListener('dragstart', e => this.startPathDrag(e, p));
        }

        const daysLeft = p.deadline ? this.daysUntil(p.deadline) : null;
        const deadlineStr = daysLeft === null ? '' :
            daysLeft < 0 ? 'past deadline' :
            daysLeft === 0 ? 'due today' :
            daysLeft === 1 ? '1 day left' :
            `${daysLeft} days left`;

        const progress = p.totalPlanned > 0 ? `${p.totalWalked}/${p.totalPlanned}` : '0 sessions';
        const pct = p.totalPlanned > 0 ? Math.round((p.totalWalked / p.totalPlanned) * 100) : 0;

        card.innerHTML = `
            <div class="path-card-top">
                <div class="path-card-dot" style="background:${p.color};"></div>
                <div class="path-card-name">${p.name}</div>
                <div class="path-card-actions">
                    <button class="path-card-archive-btn" title="Archive path" onclick="archivePath('${p.id}', event)">↓</button>
                </div>
            </div>
            <div class="path-card-meta">
                ${deadlineStr ? `<span class="path-card-deadline${daysLeft !== null && daysLeft <= 2 ? ' urgent' : ''}">${deadlineStr}</span>` : ''}
                <span class="path-card-progress">${progress}</span>
            </div>
            ${p.totalPlanned > 0 ? `<div class="path-card-bar"><div class="path-card-bar-fill" style="width:${pct}%;background:${p.color};"></div></div>` : ''}
        `;
        return card;
    },

    setActivePath(pathId) {
        this.activePath = pathId;
        this.pendingPathId = pathId;
        this.updatePathFilterChip();
        this.renderPathsSidebar();
        this.renderBody();
    },

    updatePathFilterChip() {
        const chip = document.getElementById('path-filter-chip');
        if (!chip) return;
        if (this.activePath) {
            const path = this.paths.find(p => p.id === this.activePath);
            if (path) {
                chip.style.display = 'flex';
                chip.style.setProperty('--chip-color', path.color);
                chip.innerHTML = `
                    <span class="path-filter-chip-label">Filtering:</span>
                    <span class="path-filter-chip-dot" style="background:${path.color}"></span>
                    <span class="path-filter-chip-name">${path.name}</span>
                    <span class="path-filter-chip-clear" title="Clear filter">×</span>
                `;
            }
        } else {
            chip.style.display = 'none';
        }
    },

    daysUntil(dateStr) {
        const today = new Date(); today.setHours(0,0,0,0);
        const target = new Date(dateStr + 'T00:00:00');
        return Math.round((target - today) / 86400000);
    },

    shouldShow(type) {
        if (this.activeFilter === 'all') return true;
        if (this.activeFilter === 'planned') return type === 'planned';
        if (this.activeFilter === 'actual') return type === 'actual';
        return true;
    },

    createBlockEl(b) {
        const dur = this.calcDuration(b.sessions);
        const top = (b.startHour - this.HOURS[0]) * this.ROW_HEIGHT + (b.startMin / 60) * this.ROW_HEIGHT;
        const height = Math.max((dur / 60) * this.ROW_HEIGHT, 28);

        const el = document.createElement('div');
        el.className = `block ${b.type} ${b.color}${b.walked ? ' walked' : ''}`;
        el.style.top = `${top}px`;
        el.style.height = `${height}px`;

        // Path stripe
        if (b.pathColor) {
            el.style.setProperty('--block-path-color', b.pathColor);
            el.classList.add('has-path');
        }

        if (b.type === 'actual') {
            el.style.left = '10px';
            el.style.right = '3px';
        }

        const endStr = this.addMinutes(b.startHour, b.startMin, dur);
        const startStr = this.formatTime(b.startHour, b.startMin);
        const walkedMark = b.walked ? '<span class="block-walked-mark">✓</span>' : '';

        el.innerHTML = `
            ${b.pathColor ? `<div class="block-path-stripe" style="background:${b.pathColor};"></div>` : ''}
            <div class="block-name">${b.areaName}${b.label ? ` · ${b.label}` : ''}${walkedMark}</div>
            <div class="block-meta">${startStr} – ${endStr} · ${b.sessions} sess</div>
            ${b.type === 'planned' ? `<div class="resize-handle"><div class="resize-handle-bar"></div></div>` : ''}
        `;

        el.addEventListener('click', e => {
            e.stopPropagation();
            if (b.type === 'planned') {
                this.deleteBlock(b.id);
            }
        });

        // Path drag-and-drop target
        if (b.type === 'planned') {
            el.addEventListener('dragover', e => {
                if (!this.draggingPath) return;
                e.preventDefault();
                e.stopPropagation();
                el.classList.add('path-drop-target');
                el.style.setProperty('--drop-path-color', this.draggingPath.color);
            });
            el.addEventListener('dragleave', () => {
                el.classList.remove('path-drop-target');
            });
            el.addEventListener('drop', e => {
                if (!this.draggingPath) return;
                e.preventDefault();
                e.stopPropagation();
                el.classList.remove('path-drop-target');
                this.assignPathToBlock(b.id, this.draggingPath.id);
            });
        }

        return el;
    },

    setupColumnEvents(col, d, isToday) {
        // Snap ghost elements
        const snapGhost = document.createElement('div');
        snapGhost.className = 'snap-ghost';
        col.appendChild(snapGhost);

        const dlSnapGhost = document.createElement('div');
        dlSnapGhost.className = 'deadline-snap-ghost';
        col.appendChild(dlSnapGhost);

        const timePip = document.createElement('div');
        timePip.className = 'time-pip';
        const pipLine = document.createElement('div');
        pipLine.className = 'time-pip-line';
        const pipLabel = document.createElement('div');
        pipLabel.className = 'time-pip-label';
        timePip.appendChild(pipLine);
        timePip.appendChild(pipLabel);
        col.appendChild(timePip);

        const getSnapPos = (e) => {
            const rect = col.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const totalMins = (y / this.ROW_HEIGHT) * 60;
            const snappedMins = Math.round(totalMins / 30) * 30;
            const snappedH = this.HOURS[0] + Math.floor(snappedMins / 60);
            const snappedM = snappedMins % 60;
            const clampedH = Math.max(this.HOURS[0], Math.min(this.HOURS[this.HOURS.length - 1], snappedH));
            const top = (clampedH - this.HOURS[0]) * this.ROW_HEIGHT + (snappedM / 60) * this.ROW_HEIGHT;
            return { h: clampedH, m: snappedM, top };
        };

        const updateSnapGhost = (h, m, top, area, color) => {
            const dur = this.calcDuration(2);
            const blockH = Math.max((dur / 60) * this.ROW_HEIGHT, 32);
            const startStr = this.formatTime(h, m);
            const endStr = this.addMinutes(h, m, dur);
            
            snapGhost.className = `snap-ghost ${color} visible`;
            snapGhost.style.top = `${top}px`;
            snapGhost.style.height = `${blockH}px`;
            snapGhost.innerHTML = `
                <div class="snap-ghost-name">${area}</div>
                <div class="snap-ghost-time">${startStr} – ${endStr}</div>
            `;
        };

        const updateTimePip = (top, h, m) => {
            timePip.classList.add('visible');
            pipLine.style.top = `${top}px`;
            pipLabel.style.top = `${top}px`;
            pipLabel.textContent = this.formatTime(h, m);
        };

        const hideSnapGhost = () => {
            snapGhost.classList.remove('visible');
            dlSnapGhost.classList.remove('visible');
            timePip.classList.remove('visible');
        };

        col.addEventListener('mousemove', e => {
            if (!this.dragging.areaId) {
                const { h, m, top } = getSnapPos(e);
                updateTimePip(top, h, m);
            }
        });

        col.addEventListener('mouseleave', hideSnapGhost);

        const showDeadlineGhost = (e) => {
            const { h, m, top } = getSnapPos(e);
            const timeStr = this.formatTime(h, m);
            dlSnapGhost.className = 'deadline-snap-ghost visible';
            dlSnapGhost.style.top = `${top}px`;
            dlSnapGhost.innerHTML = `
                <div class="deadline-snap-line"></div>
                <div class="deadline-snap-label">◎ New Path deadline · ${timeStr}</div>
            `;
        };

        col.addEventListener('dragover', e => {
            if (this.draggingDeadline) { e.preventDefault(); showDeadlineGhost(e); return; }
            if (this.draggingPath) { e.preventDefault(); return; }
            if (!this.dragging.areaId) return;
            e.preventDefault();
            const { h, m, top } = getSnapPos(e);
            updateSnapGhost(h, m, top, this.dragging.areaName || 'Block', this.dragging.color || 'green');
        });
        col.addEventListener('dragleave', e => {
            if (!col.contains(e.relatedTarget)) {
                snapGhost.classList.remove('visible');
                dlSnapGhost.classList.remove('visible');
            }
        });
        col.addEventListener('drop', e => {
            e.preventDefault();
            dlSnapGhost.classList.remove('visible');
            if (this.draggingDeadline) {
                this.handleDeadlineDrop(d);
            } else if (this.dragging.areaId) {
                const { h, m } = getSnapPos(e);
                this.handleDrop(d, h, m);
            }
            this.dragging = { areaId: null, color: null };
        });
        
        col.addEventListener('click', e => {
            if (e.target === col || e.target.classList.contains('hour-line')) {
                const { h, m } = getSnapPos(e);
                this.openPopover(d, h, m);
            }
        });
    },

    // ── DRAG & DROP ──
    startDrag(e, areaId, areaName, color) {
        this.dragging = { areaId, areaName, color };
        this.pendingAreaId = areaId;
        this.pendingColor = color;
        
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', areaId); // fallback
        
        const ghost = document.getElementById('drag-ghost');
        const ghostInner = document.getElementById('drag-ghost-inner');
        if (ghost && ghostInner) {
            ghost.classList.add('active');
            ghostInner.className = `drag-ghost-inner`; 
            ghostInner.classList.add(color); 
            ghostInner.textContent = `${areaName} · 2 sessions`;
        }

        const img = new Image(); img.src = '';
        e.dataTransfer.setDragImage(img, 0, 0);

        let moveHandler;
        let endHandler;

        moveHandler = (ev) => {
            if (ghost) {
                ghost.style.left = `${ev.clientX + 12}px`;
                ghost.style.top = `${ev.clientY - 16}px`;
            }
        };

        endHandler = () => {
            // Removed premature flag reset: this.dragging = { areaId: null, color: null };
            if (ghost) ghost.classList.remove('active');
            document.removeEventListener('dragover', moveHandler);
            document.removeEventListener('dragend', endHandler);
        };

        document.addEventListener('dragover', moveHandler);
        document.addEventListener('dragend', endHandler);
    },

    startNewBlockDrag(e) {
        // Called from HTML for the "New Block" chip
        this.startDrag(e, null, 'New Block', 'green');
    },

    startPathDrag(e, path) {
        this.draggingPath = { id: path.id, name: path.name, color: path.color };
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', `path:${path.id}`);

        const ghost = document.getElementById('drag-ghost');
        const ghostInner = document.getElementById('drag-ghost-inner');
        if (ghost && ghostInner) {
            ghost.classList.add('active');
            ghostInner.className = 'drag-ghost-inner path-ghost';
            ghostInner.style.setProperty('--path-ghost-color', path.color);
            ghostInner.textContent = path.name;
        }

        const img = new Image(); img.src = '';
        e.dataTransfer.setDragImage(img, 0, 0);

        const moveHandler = (ev) => {
            if (ghost) {
                ghost.style.left = `${ev.clientX + 12}px`;
                ghost.style.top = `${ev.clientY - 16}px`;
            }
        };
        const endHandler = () => {
            if (ghost) ghost.classList.remove('active');
            this.draggingPath = null;
            document.removeEventListener('dragover', moveHandler);
            document.removeEventListener('dragend', endHandler);
        };
        document.addEventListener('dragover', moveHandler);
        document.addEventListener('dragend', endHandler);
    },

    startDeadlineDrag(e) {
        this.draggingDeadline = true;
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', 'deadline');

        const ghost = document.getElementById('drag-ghost');
        const ghostInner = document.getElementById('drag-ghost-inner');
        if (ghost && ghostInner) {
            ghost.classList.add('active');
            ghostInner.className = 'drag-ghost-inner deadline-ghost';
            ghostInner.textContent = 'Set deadline →';
        }

        const img = new Image(); img.src = '';
        e.dataTransfer.setDragImage(img, 0, 0);

        const moveHandler = (ev) => {
            if (ghost) {
                ghost.style.left = `${ev.clientX + 12}px`;
                ghost.style.top = `${ev.clientY - 16}px`;
            }
        };
        const endHandler = () => {
            if (ghost) ghost.classList.remove('active');
            this.draggingDeadline = false;
            document.removeEventListener('dragover', moveHandler);
            document.removeEventListener('dragend', endHandler);
        };
        document.addEventListener('dragover', moveHandler);
        document.addEventListener('dragend', endHandler);
    },

    handleDeadlineDrop(dayIndex) {
        const date = this.getWeekDates(this.weekOffset)[dayIndex];
        const dateStr = date.toISOString().split('T')[0];
        this.draggingDeadline = false;
        this.openPathModal(dateStr);
    },

    async assignPathToBlock(blockId, pathId) {
        const block = this.blocks.find(b => b.id === blockId);
        if (!block) return;

        const path = this.paths.find(p => p.id === pathId);
        block.pathId = pathId;
        block.pathName = path?.name || null;
        block.pathColor = path?.color || null;

        if (dbManager.initialized) {
            const dateStr = this.getWeekDates(this.weekOffset)[block.day].toISOString().split('T')[0];
            console.log('[assignPathToBlock] block:', blockId, '→ path:', pathId);
            await dbManager.insertPlannedBlock({
                id: block.id,
                focusAreaId: block.areaId,
                plannedDate: dateStr,
                startMinutes: block.startHour * 60 + block.startMin,
                durationMinutes: this.calcDuration(block.sessions),
                notes: block.label,
                pathId: pathId
            });
        }

        this.renderBody();
        this.renderPathsSidebar();
    },

    handleDrop(day, h, m) {
        this.pendingDay = day;
        this.pendingHour = h;
        this.pendingMinutes = m;
        this.openPopover(day, h, m);
    },

    // ── POPOVER ──
    openPopover(day, hour, mins) {
        const overlay = document.getElementById('popover-overlay');
        const pop = document.getElementById('popover');

        this.pendingDay = day;
        this.pendingHour = hour;
        this.pendingMinutes = mins || 0;

        // Ensure we have a pending area selected
        const areas = this.getAreas();
        if (!this.pendingAreaId && areas.length > 0) {
            this.pendingAreaId = areas[0].id;
            this.pendingColor = areas[0].color;
        }

        const currentArea = areas.find(a => a.id === this.pendingAreaId) || areas[0];
        if (currentArea) {
            document.getElementById('popover-area-name').textContent = currentArea.name;
            document.getElementById('popover-area-dot').className = `popover-area-dot ${currentArea.color}`;
        }

        document.getElementById('popover-time').value =
            `${String(hour).padStart(2, '0')}:${String(this.pendingMinutes).padStart(2, '0')}`;
        
        this.sessionCount = 2;
        this.updateSessionDisplay();

        // Pre-select active path
        if (this.activePath) {
            this.pendingPathId = this.activePath;
        }
        this.updatePathDisplay();

        pop.style.top = '130px';
        pop.style.left = '220px';

        overlay.classList.add('visible');
        pop.classList.add('visible');
        this.populateAreaPicker();
        this.populatePathPicker();
    },

    closePopover() {
        document.getElementById('popover-overlay').classList.remove('visible');
        document.getElementById('popover').classList.remove('visible');
    },

    // ── PATH MODAL ──
    openPathModal(presetDeadline = null) {
        console.log('[openPathModal] called');
        const nameEl = document.getElementById('path-modal-name');
        const descEl = document.getElementById('path-modal-desc');
        const deadlineEl = document.getElementById('path-modal-deadline');
        const overlayEl = document.getElementById('modal-overlay');
        console.log('[openPathModal] elements:', { nameEl, descEl, deadlineEl, overlayEl });
        if (nameEl) nameEl.value = '';
        if (descEl) descEl.value = '';
        if (deadlineEl) deadlineEl.value = presetDeadline || '';
        this.selectedPathColor = '#3D8F5A';
        document.querySelectorAll('.path-color-swatch').forEach(s => {
            s.classList.toggle('active', s.dataset.color === '#3D8F5A');
        });
        if (overlayEl) {
            overlayEl.classList.add('visible');
            console.log('[openPathModal] overlay classes after:', overlayEl.className, 'computed display:', getComputedStyle(overlayEl).display);
        } else {
            console.error('[openPathModal] #modal-overlay not found in DOM!');
        }
    },

    closePathModal() {
        document.getElementById('modal-overlay').classList.remove('visible');
    },

    selectPathColor(color, el) {
        this.selectedPathColor = color;
        document.querySelectorAll('.path-color-swatch').forEach(s => s.classList.remove('active'));
        el.classList.add('active');
    },

    async savePath() {
        const name = document.getElementById('path-modal-name').value.trim();
        if (!name) { document.getElementById('path-modal-name').focus(); return; }

        const path = {
            id: uuidv7(),
            name,
            description: document.getElementById('path-modal-desc').value.trim() || null,
            deadline: document.getElementById('path-modal-deadline').value || null,
            color: this.selectedPathColor,
            status: 'active'
        };

        if (dbManager.initialized) {
            console.log('[insertPath]', path);
            await dbManager.insertPath(path);
        }

        this.paths.push({ ...path, totalPlanned: 0, totalWalked: 0 });
        this.closePathModal();

        // Auto-select the new path (like git checkout -b)
        this.setActivePath(path.id);
        this.render();
    },

    async archivePath(pathId, e) {
        e.stopPropagation();
        if (dbManager.initialized) { console.log('[archivePath] manual:', pathId); await dbManager.archivePath(pathId); }
        const p = this.paths.find(p => p.id === pathId);
        if (p) p.status = 'archived';
        if (this.activePath === pathId) this.setActivePath(null);
        else this.renderPathsSidebar();
    },

    populateAreaPicker() {
        const picker = document.getElementById('popover-area-picker');
        if (!picker) return;
        picker.innerHTML = '';
        this.getAreas().forEach(a => {
            const opt = document.createElement('div');
            opt.className = `popover-area-option${a.id === this.pendingAreaId ? ' active' : ''}`;
            opt.innerHTML = `
                <div class="popover-area-option-dot" style="background:var(--${a.color}-bar)"></div>
                ${a.name}
            `;
            opt.onclick = (e) => {
                e.stopPropagation();
                this.pendingAreaId = a.id;
                this.pendingColor = a.color;
                document.getElementById('popover-area-name').textContent = a.name;
                document.getElementById('popover-area-dot').className = `popover-area-dot ${a.color}`;
                picker.classList.remove('open');
            };
            picker.appendChild(opt);
        });
    },

    toggleAreaPicker() {
        document.getElementById('popover-area-picker').classList.toggle('open');
        document.getElementById('popover-path-picker').classList.remove('open');
    },

    populatePathPicker() {
        const picker = document.getElementById('popover-path-picker');
        if (!picker) return;
        picker.innerHTML = '';

        // "No path" option
        const noneOpt = document.createElement('div');
        noneOpt.className = `popover-area-option${!this.pendingPathId ? ' active' : ''}`;
        noneOpt.innerHTML = `<div class="popover-area-option-dot" style="background:var(--ink-soft)"></div> No path`;
        noneOpt.onclick = (e) => {
            e.stopPropagation();
            this.pendingPathId = null;
            this.updatePathDisplay();
            picker.classList.remove('open');
        };
        picker.appendChild(noneOpt);

        this.paths.filter(p => p.status === 'active').forEach(p => {
            const opt = document.createElement('div');
            opt.className = `popover-area-option${p.id === this.pendingPathId ? ' active' : ''}`;
            opt.innerHTML = `<div class="popover-area-option-dot" style="background:${p.color}"></div> ${p.name}`;
            opt.onclick = (e) => {
                e.stopPropagation();
                this.pendingPathId = p.id;
                this.updatePathDisplay();
                picker.classList.remove('open');
            };
            picker.appendChild(opt);
        });
    },

    togglePathPicker() {
        document.getElementById('popover-path-picker').classList.toggle('open');
        document.getElementById('popover-area-picker').classList.remove('open');
    },

    updatePathDisplay() {
        const path = this.paths.find(p => p.id === this.pendingPathId);
        const dot = document.getElementById('popover-path-dot');
        const name = document.getElementById('popover-path-name');
        if (!dot || !name) return;
        if (path) {
            dot.style.background = path.color;
            dot.style.display = 'inline-block';
            name.textContent = path.name;
        } else {
            dot.style.display = 'none';
            name.textContent = 'No path';
        }
    },

    confirmBlock() {
        const areas = this.getAreas();
        const area = areas.find(a => a.id === this.pendingAreaId) || areas[0];
        if (!area) return;

        const timeVal = document.getElementById('popover-time').value;
        const [h, m] = timeVal ? timeVal.split(':').map(Number) : [this.pendingHour, this.pendingMinutes];
        const label = document.getElementById('popover-label')?.value.trim() || null;

        const path = this.paths.find(p => p.id === this.pendingPathId);

        const block = {
            id: uuidv7(),
            day: this.pendingDay,
            startHour: h,
            startMin: m,
            sessions: this.sessionCount,
            areaId: area.id,
            areaName: area.name,
            color: area.color,
            type: 'planned',
            label: label || null,
            pathId: this.pendingPathId || null,
            pathName: path?.name || null,
            pathColor: path?.color || null,
            walked: false
        };

        this.blocks.push(block);
        this.saveBlock(block);

        // Update path progress count in memory
        if (path) path.totalPlanned = (path.totalPlanned || 0) + this.sessionCount;

        this.closePopover();
        if (document.getElementById('popover-label')) document.getElementById('popover-label').value = '';
        this.renderBody();
        this.renderPathsSidebar();
    },

    adjustSessions(delta) {
        this.sessionCount = Math.max(1, Math.min(8, this.sessionCount + delta));
        this.updateSessionDisplay();
    },

    updateSessionDisplay() {
        document.getElementById('stepper-val').textContent = `${this.sessionCount} session${this.sessionCount !== 1 ? 's' : ''}`;
        this.updateDerivedTime();
    },

    updateDerivedTime() {
        const timeVal = document.getElementById('popover-time').value;
        const [h, m] = timeVal.split(':').map(Number);
        const dur = this.calcDuration(this.sessionCount);
        document.getElementById('derived-end').textContent = this.addMinutes(h, m, dur);
        document.getElementById('derived-duration').textContent = this.formatDuration(dur);
    },

    setupEventListeners() {
        // Bind HTML buttons to class methods
        // Note: HTML onclicks won't work with module methods directly unless exposed to window
        // So we attach listeners here or expose to window.
        // For simplicity in refactoring, we'll attach to window for now or bind IDs.
        
        console.log('PlannerView setupEventListeners called'); // Added for debugging
        window.shiftWeek = (d) => this.shiftWeek(d);
        window.goToday = () => this.goToday();
        window.setFilter = (f, el) => {
            this.activeFilter = f;
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            el.classList.add('active');
            this.render();
        };
        window.closePopover = () => this.closePopover();
        window.toggleNewMenu = () => document.getElementById('new-menu').classList.toggle('open');
        window.closeNewMenu = () => document.getElementById('new-menu').classList.remove('open');
        window.toggleAreaPicker = () => this.toggleAreaPicker();
        window.adjustSessions = (d) => this.adjustSessions(d);
        window.updateDerivedTime = () => this.updateDerivedTime();
        window.confirmBlock = () => this.confirmBlock();
        window.startNewBlockDrag = (e) => this.startNewBlockDrag(e);
        window.openPathModal = () => this.openPathModal();
        window.closePathModal = () => this.closePathModal();
        window.savePath = () => this.savePath();
        window.archivePath = (id, e) => this.archivePath(id, e);
        window.selectPathColor = (color, el) => this.selectPathColor(color, el);
        window.togglePathPicker = () => this.togglePathPicker();
        window.closePathModalIfBg = (e) => {
            if (e.target === document.getElementById('modal-overlay')) this.closePathModal();
        };
        window.openPopover = () => this.openPopover();
        window.setActivePath = (id) => this.setActivePath(id);
        
        // Navigation buttons
        document.getElementById('focusPlannerNavBtn')?.addEventListener('click', () => {
            document.getElementById('menuDropdown').classList.remove('open');
            this.open();
        });
        document.getElementById('focusPlannerClose')?.addEventListener('click', () => this.close());
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && document.getElementById('focusPlannerOverlay').style.display === 'block') {
                this.close();
            }
        });
    }
};
