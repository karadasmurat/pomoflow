/**
 * PlannerView
 * Handles the logic for the Focus Planner modal, integrating with app state and DB.
 */

import { state } from '../state/store.js';
import { HistoryService } from '../services/history.service.js';
import { FocusService } from '../services/focus.service.js';
import { dbManager } from '../db.js'; // Import dbManager

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
    deadlines: [],
    
    // Drag state
    dragging: { areaId: null, color: null },
    draggingNewDeadline: false,
    draggingDeadline: null,
    pendingDeadlineDay: null,

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
        // Fetch planned blocks from DB
        const dates = this.getWeekDates(this.weekOffset);
        const startStr = dates[0].toISOString().split('T')[0];
        const endStr = dates[6].toISOString().split('T')[0];
        
        let dbBlocks = [];
        if (dbManager.initialized) {
            dbBlocks = await dbManager.getPlannedBlocksForWeek(startStr, endStr);
        }

        // Mock Deadlines for now (since no DB support yet)
        if (this.deadlines.length === 0) {
            this.deadlines = [
                { day: 3, name: 'Report due', areas: ['amber', 'violet'], hour: 17, min: 0 },
                { day: 4, name: 'Sprint end', areas: ['green'], hour: 12, min: 0 },
            ];
        }
        
        // Map DB blocks to UI format
        this.blocks = dbBlocks.map(b => ({
            id: b.id,
            day: new Date(b.planned_date).getDay() === 0 ? 6 : new Date(b.planned_date).getDay() - 1, // Sun=0 in JS, Mon=0 in Planner
            startHour: Math.floor(b.start_minutes / 60),
            startMin: b.start_minutes % 60,
            sessions: this.calcSessionsFromDuration(b.duration_minutes),
            areaId: b.focus_area_id,
            areaName: b.area_name || 'Unknown',
            color: this.mapColor(b.area_color),
            type: 'planned',
            label: b.notes
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
            notes: block.label
        };

        await dbManager.insertPlannedBlock(dbBlock);
        
        // Update local block ID if it was new
        if (!block.id) block.id = dbBlock.id;
    },

    async deleteBlock(blockId) {
        if (dbManager.initialized) {
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
        this.renderDeadlineSidebar();
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
            const dayDeadlines = this.deadlines.filter(d => d.day === i);

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

            // Deadline flags
            const flagsEl = document.createElement('div');
            flagsEl.className = 'deadline-flags';

            if (dayDeadlines.length > 0) {
                const flag = document.createElement('div');
                flag.className = 'deadline-flag';
                flag.innerHTML = `<span class="deadline-flag-icon">⚑</span>${dayDeadlines.length === 1 ? dayDeadlines[0].name : `${dayDeadlines.length} deadlines`}`;
                const chips = document.createElement('div');
                chips.className = 'area-chips';
                dayDeadlines.forEach(dl => dl.areas.forEach(color => {
                    const chip = document.createElement('div');
                    chip.className = `area-chip ${color}`;
                    chips.appendChild(chip);
                }));
                if (chips.children.length) flag.appendChild(chips);
                flagsEl.appendChild(flag);
            }
            dh.appendChild(flagsEl);

            // Drag drop for deadlines
            dh.addEventListener('dragover', e => {
                // Proceed if dragging a deadline (new or existing) OR a block
                if (!(this.draggingNewDeadline || this.draggingDeadline !== null || this.dragging.areaId)) return;
                e.preventDefault();
                dh.classList.add('deadline-drop-target');
            });
            dh.addEventListener('dragleave', e => {
                if (!dh.contains(e.relatedTarget)) dh.classList.remove('deadline-drop-target');
            });
            dh.addEventListener('drop', e => {
                e.preventDefault(); // Prevent default browser behavior
                dh.classList.remove('deadline-drop-target'); // Remove visual highlight

                const droppedData = e.dataTransfer.getData('text/plain');

                if (droppedData === 'new-deadline' && this.draggingNewDeadline) {
                    // This is a new deadline being dropped
                    this.draggingNewDeadline = false; // Reset flag after successful drop
                    this.openDeadlineModal(d, h, m);
                } else if (this.draggingDeadline !== null && droppedData !== 'new-deadline') {
                    // This is an existing deadline being dropped
                    this.deadlines[this.draggingDeadline].day = d;
                    this.deadlines[this.draggingDeadline].hour = h;
                    this.deadlines[this.draggingDeadline].min = m;
                    this.draggingDeadline = null;
                    this.render();
                } else if (this.dragging.areaId && droppedData !== 'new-deadline' && droppedData !== 'deadline') { // Dropping a block
                    this.handleDrop(d, h, m);
                } else {
                    // Fallback or unexpected drop scenario
                    console.warn("Dropped item of unknown type or context mismatch.");
                }
                // Ensure state is reset regardless of successful drop for this specific item
                this.draggingNewDeadline = false;
                this.draggingDeadline = null;
                this.dragging = { areaId: null, color: null }; // Reset block drag state
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

            // Blocks
            const dayBlocks = this.blocks.filter(b => b.day === d && this.shouldShow(b.type));
            dayBlocks.forEach(b => {
                col.appendChild(this.createBlockEl(b));
            });

            // Deadline Markers
            this.deadlines.filter(dl => dl.day === d).forEach(dl => {
                const top = (dl.hour - this.HOURS[0]) * this.ROW_HEIGHT + (dl.min / 60) * this.ROW_HEIGHT;
                if (top < 0 || top > this.HOURS.length * this.ROW_HEIGHT) return;
                
                const marker = document.createElement('div');
                marker.className = 'deadline-marker';
                marker.style.top = `${top}px`;
                marker.innerHTML = `
                    <div class="deadline-marker-line"></div>
                    <div class="deadline-marker-label">
                        ⚑ ${dl.name}
                        <span class="dm-time">${this.formatTime(dl.hour, dl.min)}</span>
                        ${dl.areas.map(c => `<span style="width:5px;height:5px;border-radius:50%;background:var(--${c}-bar);display:inline-block;"></span>`).join('')}
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

    renderDeadlineSidebar() {
        const list = document.getElementById('sidebar-deadlines-list');
        if (!list) return;
        list.innerHTML = '';

        // New deadline chip
        const newChip = document.createElement('div');
        newChip.className = 'creation-chip';
        newChip.draggable = true;
        newChip.ondragstart = (e) => this.startNewDeadlineDrag(e);
        newChip.innerHTML = `
            <span class="creation-chip-icon">⚑</span>
            <div class="creation-chip-text">
                <span class="creation-chip-label">New deadline</span>
                <span class="creation-chip-hint">Drag to a day</span>
            </div>
            <span class="creation-chip-handle">⠿ →</span>
        `;
        list.appendChild(newChip);

        const dates = this.getWeekDates(this.weekOffset);
        
        this.deadlines.forEach((dl, i) => {
            const dayDate = dates[dl.day];
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const dateStr = `${this.DAYS[dl.day]}, ${months[dayDate.getMonth()]} ${dayDate.getDate()}`;

            const chip = document.createElement('div');
            chip.className = 'deadline-chip';
            chip.draggable = true;
            chip.ondragstart = (e) => this.startDeadlineDrag(e, i);

            chip.innerHTML = `
                <div class="deadline-chip-icon">⚑</div>
                <div class="deadline-chip-body">
                    <div class="deadline-chip-name">${dl.name}</div>
                    <div class="deadline-chip-meta">
                        ${dateStr} · ${this.formatTime(dl.hour, dl.min)}
                        ${dl.areas.length > 0 ? `<span style="display:flex;gap:3px;margin-left:2px;">${dl.areas.map(c => `<span style="width:6px;height:6px;border-radius:50%;background:var(--${c}-bar);display:inline-block;"></span>`).join('')}</span>` : ''}
                    </div>
                </div>
                <div class="deadline-chip-drag">⠿</div>
            `;
            list.appendChild(chip);
        });
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
        el.className = `block ${b.type} ${b.color}`;
        el.style.top = `${top}px`;
        el.style.height = `${height}px`;

        if (b.type === 'actual') {
            el.style.left = '10px';
            el.style.right = '3px';
        }

        const endStr = this.addMinutes(b.startHour, b.startMin, dur);
        const startStr = this.formatTime(b.startHour, b.startMin);

        el.innerHTML = `
            <div class="block-name">${b.areaName}${b.label ? ` · ${b.label}` : ''}</div>
            <div class="block-meta">${startStr} – ${endStr} · ${b.sessions} sess</div>
            ${b.type === 'planned' ? `<div class="resize-handle"><div class="resize-handle-bar"></div></div>` : ''}
        `;

        el.addEventListener('click', e => { 
            e.stopPropagation(); 
            // showDetail(b); // TODO: Implement detail view
            if (b.type === 'planned') {
                this.deleteBlock(b.id); // Simple delete on click for now (or open detail)
            }
        });

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

        const updateDeadlineSnapGhost = (h, m, top) => {
            dlSnapGhost.classList.add('visible');
            dlSnapGhost.style.top = `${top}px`;
            dlSnapGhost.innerHTML = `
                <div class="dl-snap-line"></div>
                <div class="dl-snap-label">⚑ <span class="dl-snap-time">${this.formatTime(h, m)}</span></div>
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
            // Only relevant for block drag if it's active, otherwise use timePip
            if (!this.dragging.areaId) { 
                const { h, m, top } = getSnapPos(e);
                updateTimePip(top, h, m);
            } else {
                hideSnapGhost(); // Hide block ghosts if mouse moves off target
            }
            // Keep timePip visible if mouse is over col but not on a draggable item
            if (e.target === col && !this.dragging.areaId && !this.draggingNewDeadline && this.draggingDeadline === null) {
                 const { h, m, top } = getSnapPos(e);
                 updateTimePip(top, h, m);
            }
        });

        col.addEventListener('mouseleave', hideSnapGhost);

        col.addEventListener('dragover', e => {
            // Proceed if dragging a deadline (new or existing) OR a block
            if (!(this.draggingNewDeadline || this.draggingDeadline !== null || this.dragging.areaId)) return;
            e.preventDefault();
            dh.classList.add('deadline-drop-target');
        });
        col.addEventListener('dragleave', e => {
            if (!dh.contains(e.relatedTarget)) dh.classList.remove('deadline-drop-target');
        });
        col.addEventListener('drop', e => {
            e.preventDefault(); // Prevent default browser behavior
            dh.classList.remove('deadline-drop-target'); // Remove visual highlight
            const { h, m } = getSnapPos(e);
            
            const droppedData = e.dataTransfer.getData('text/plain');

            if (droppedData === 'new-deadline' && this.draggingNewDeadline) {
                // This is a new deadline being dropped
                this.draggingNewDeadline = false; // Reset flag after successful drop
                this.openDeadlineModal(d, h, m);
            } else if (this.draggingDeadline !== null && droppedData !== 'new-deadline') {
                // This is an existing deadline being dropped
                this.deadlines[this.draggingDeadline].day = d;
                this.deadlines[this.draggingDeadline].hour = h;
                this.deadlines[this.draggingDeadline].min = m;
                this.draggingDeadline = null;
                this.render();
            } else if (this.dragging.areaId && droppedData !== 'new-deadline' && droppedData !== 'deadline') { // Dropping a block
                this.handleDrop(d, h, m);
            } else {
                // Fallback or unexpected drop scenario
                console.warn("Dropped item of unknown type or context mismatch.");
            }
            // Ensure state is reset regardless of successful drop for this specific item
            this.draggingNewDeadline = false;
            this.draggingDeadline = null;
            this.dragging = { areaId: null, color: null }; // Reset block drag state
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

    startNewDeadlineDrag(e) {
        this.draggingNewDeadline = true;
        this.dragging = { areaId: null, color: null }; // Clear block drag state
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', 'new-deadline');
        
        const img = new Image(); img.src = '';
        e.dataTransfer.setDragImage(img, 0, 0);

        const ghost = document.getElementById('drag-ghost');
        const ghostInner = document.getElementById('drag-ghost-inner');
        if (ghost && ghostInner) {
            ghost.classList.add('active');
            ghostInner.className = 'drag-ghost-inner';
            ghostInner.style.background = 'var(--bg-card)';
            ghostInner.style.borderColor = 'var(--ink-soft)';
            ghostInner.style.color = 'var(--ink)';
            ghostInner.textContent = '⚑ New deadline';
        }

        const moveHandler = (ev) => {
            if (ghost) {
                ghost.style.left = `${ev.clientX + 12}px`;
                ghost.style.top = `${ev.clientY - 16}px`;
            }
        };

        const endHandler = () => {
            // Removed premature flag reset: this.draggingNewDeadline = false;
            if (ghost) ghost.classList.remove('active');
            document.removeEventListener('dragover', moveHandler);
            document.removeEventListener('dragend', endHandler);
            // Clear deadline targets
            document.querySelectorAll('.day-head.deadline-drop-target')
                .forEach(el => el.classList.remove('deadline-drop-target'));
        };

        document.addEventListener('dragover', moveHandler);
        document.addEventListener('dragend', endHandler);
    },

    startDeadlineDrag(e, idx) {
        this.draggingDeadline = idx;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'deadline');
        
        const img = new Image(); img.src = '';
        e.dataTransfer.setDragImage(img, 0, 0);

        const ghost = document.getElementById('drag-ghost');
        const ghostInner = document.getElementById('drag-ghost-inner');
        if (ghost && ghostInner) {
            ghost.classList.add('active');
            ghostInner.className = 'drag-ghost-inner';
            ghostInner.style.background = 'var(--bg-card)';
            ghostInner.style.borderColor = 'var(--ink-soft)';
            ghostInner.style.color = 'var(--ink)';
            ghostInner.textContent = `⚑ ${this.deadlines[idx].name}`;
        }

        const moveHandler = (ev) => {
            if (ghost) {
                ghost.style.left = `${ev.clientX + 12}px`;
                ghost.style.top = `${ev.clientY - 16}px`;
            }
        };

        const endHandler = () => {
            this.draggingDeadline = null; // Reset flag
            if (ghost) ghost.classList.remove('active');
            document.removeEventListener('dragover', moveHandler);
            document.removeEventListener('dragend', endHandler);
            // Clear deadline targets
            document.querySelectorAll('.day-head.deadline-drop-target')
                .forEach(el => el.classList.remove('deadline-drop-target'));
        };

        document.addEventListener('dragover', moveHandler);
        document.addEventListener('dragend', endHandler);
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

        // Simple positioning
        pop.style.top = '130px';
        pop.style.left = '220px';

        overlay.classList.add('visible');
        pop.classList.add('visible');
        this.populateAreaPicker();
    },

    closePopover() {
        document.getElementById('popover-overlay').classList.remove('visible');
        document.getElementById('popover').classList.remove('visible');
    },

    // ── DEADLINE MODAL ──
    openDeadlineModal(dayIndex, hour, min) {
        const modal = document.getElementById('modal-overlay');
        const dateInput = modal.querySelector('input[type="date"]');
        const timeInput = modal.querySelector('input[type="time"]');
        const nameInput = modal.querySelector('input[type="text"]');

        if (dayIndex !== undefined) {
            const dates = this.getWeekDates(this.weekOffset);
            const d = dates[dayIndex];
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            dateInput.value = `${yyyy}-${mm}-${dd}`;
            this.pendingDeadlineDay = dayIndex;
        } else {
            this.pendingDeadlineDay = null;
        }

        if (hour !== undefined && timeInput) {
            timeInput.value = `${String(hour).padStart(2, '0')}:${String(min || 0).padStart(2, '0')}`;
        }

        // populate area list
        const areaList = modal.querySelector('#modal-area-list');
        if (areaList) {
            areaList.innerHTML = '';
            this.getAreas().forEach(a => {
                const row = document.createElement('div');
                row.className = 'modal-area-row';
                row.innerHTML = `
                    <div class="modal-area-dot" style="background:var(--${a.color}-bar)"></div>
                    <div class="modal-area-name">${a.name}</div>
                    <div class="modal-area-check"></div>
                `;
                row.onclick = () => {
                    row.classList.toggle('selected');
                    row.querySelector('.modal-area-check').textContent = row.classList.contains('selected') ? '✓' : '';
                };
                areaList.appendChild(row);
            });
        }

        nameInput.value = '';
        modal.classList.add('visible');
    },

    closeDeadlineModal() {
        document.getElementById('modal-overlay').classList.remove('visible');
    },

    saveDeadline() {
        const modal = document.getElementById('modal-overlay');
        const name = modal.querySelector('input[type="text"]').value.trim();
        const dateVal = modal.querySelector('input[type="date"]').value;
        const timeVal = modal.querySelector('input[type="time"]').value;
        if (!name || !dateVal) return;

        const dates = this.getWeekDates(this.weekOffset);
        const picked = new Date(dateVal + 'T00:00:00');
        let day = this.pendingDeadlineDay !== null ? this.pendingDeadlineDay : 0;
        
        // Find if picked date is in current week view
        dates.forEach((d, i) => {
            if (d.getFullYear() === picked.getFullYear() &&
                d.getMonth() === picked.getMonth() &&
                d.getDate() === picked.getDate()) day = i;
        });

        const [hour, min] = timeVal ? timeVal.split(':').map(Number) : [17, 0];

        const selectedAreas = [...modal.querySelectorAll('.modal-area-row.selected')]
            .map(r => {
                // HACK: Extract color from style because we didn't store it cleanly in dataset
                // Better: use dataset in openDeadlineModal
                const style = r.querySelector('.modal-area-dot').getAttribute('style');
                const match = style.match(/var\(--(.*?)-bar\)/);
                return match ? match[1] : 'blue'; 
            });

        this.deadlines.push({ day, name, areas: selectedAreas, hour, min });

        this.closeDeadlineModal();
        this.render();
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
        window.openDeadlineModal = () => this.openDeadlineModal(); // default arg
        window.closeDeadlineModal = () => this.closeDeadlineModal();
        window.saveDeadline = () => this.saveDeadline();
        window.closeModalIfBg = (e) => {
            if (e.target === document.getElementById('modal-overlay')) this.closeDeadlineModal();
        };
        // Expose openPopover globally to fix ReferenceError
        window.openPopover = () => this.openPopover(); 
        console.log('openPopover exposed globally'); // Added for debugging
        
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
