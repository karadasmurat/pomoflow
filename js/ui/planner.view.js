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

    weekOffset: 0,  // 0 = current week (week view)
    dayOffset: 0,   // 0 = today (today view)
    viewMode: 'week',       // 'week' | 'today'
    todaySubView: 'calendar', // 'calendar' | 'list'
    sessionCount: 2,
    pendingAreaId: null, // Stores ID now, not just name
    pendingColor: 'green',
    pendingDay: 0,
    pendingHour: 9,
    pendingMinutes: 0,
    activeFilter: 'all',

    DAYS: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    ROW_HEIGHT: 72, // px per hour
    calHoursMode: 'active', // 'active' | 'full'

    getHours() {
        if (this.calHoursMode === 'full') {
            return Array.from({ length: 24 }, (_, i) => i); // 0–23
        }
        const start = state.settings.activeHoursStart ?? 8;
        const end   = state.settings.activeHoursEnd   ?? 22;
        const hours = [];
        for (let h = start; h < end; h++) hours.push(h);
        return hours.length ? hours : [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
    },

    toggleCalHoursMode() {
        this.calHoursMode = this.calHoursMode === 'active' ? 'full' : 'active';
        this.renderHead();
        this.renderBody();
    },

    blocks: [],
    paths: [],
    activePathSet: null,   // null=show all ☑ | Set (non-empty)=filter ⊟ | Set (empty)=dim all ☐
    _pathsFromAll: true,   // origin when entering filter: true=came from ☑, false=came from ☐
    pendingPathId: null,
    selectedPathColor: '#3D8F5A',
    selectedAreaColor: '#58a6ff',

    // Sidebar search state
    areaSearchQuery: '',
    pathSearchQuery: '',

    // Drag state
    dragging: { areaId: null, color: null },
    draggingPath: null,     // { id, name, color } when dragging a path card
    draggingDeadline: false, // true when dragging the "set deadline" card
    draggingBlock: null,    // { id, ... } when dragging an existing planned block

    // Edit state
    editingBlockId: null,   // block id being edited in the popover

    // ── INIT ──
    init() {
        console.log('PlannerView setupEventListeners called'); // Added for debugging
        this.setupEventListeners();
    },

    open() {
        document.getElementById('focusPlannerOverlay').style.display = 'flex';
        this.weekOffset = 0;
        this.dayOffset = 0;
        const isMobile = window.matchMedia('(max-width: 480px)').matches;
        this.viewMode = 'week';
        this.todaySubView = 'calendar';
        this.weekSubView = isMobile ? 'list' : 'calendar';
        this.areaSearchQuery = '';
        this.pathSearchQuery = '';
        const areaSearch = document.getElementById('area-search');
        const pathSearch = document.getElementById('path-search');
        if (areaSearch) areaSearch.value = '';
        if (pathSearch) pathSearch.value = '';
        this.loadData().then(() => this.render());
    },

    close() {
        document.getElementById('focusPlannerOverlay').style.display = 'none';
        this.closePopover();
    },

    // ── DATA LOADING ──
    async loadData() {
        if (this.viewMode === 'today') {
            await this.loadDayData();
        } else {
            await this.loadWeekData();
        }
    },

    async _loadPaths() {
        if (!dbManager.initialized) return;
        this.paths = await dbManager.getAllPaths();
        const today = new Date().toISOString().split('T')[0];
        for (const p of this.paths) {
            if (p.status === 'active' && p.deadline && p.deadline < today) {
                await dbManager.archivePath(p.id);
                p.status = 'archived';
            }
        }
    },

    async loadWeekData() {
        const dates = this.getWeekDates(this.weekOffset);
        const startStr = dates[0].toISOString().split('T')[0];
        const endStr = dates[6].toISOString().split('T')[0];

        await this._loadPaths();

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

    async loadDayData() {
        const date = this.getDayDate(this.dayOffset);
        const dateStr = date.toISOString().split('T')[0];

        await this._loadPaths();

        let dbBlocks = [];
        if (dbManager.initialized) {
            dbBlocks = await dbManager.getPlannedBlocksForWeek(dateStr, dateStr);
        }

        const planned = dbBlocks.map(b => ({
            id: b.id,
            day: 0,
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

        let actual = [];
        if (dbManager.initialized) {
            const dbSessions = await dbManager.getSessionsForWeek(dateStr, dateStr);
            actual = dbSessions.map(s => {
                const durationSecs = s.duration_seconds || 0;
                const endTs = new Date(s.created_at);
                const startTs = new Date(endTs.getTime() - durationSecs * 1000);
                return {
                    id: s.id,
                    day: 0,
                    startHour: startTs.getHours(),
                    startMin: startTs.getMinutes(),
                    durationMins: Math.round(durationSecs / 60),
                    sessions: this.calcSessionsFromDuration(Math.round(durationSecs / 60)),
                    areaId: s.focus_area_id,
                    areaName: s.display_name || s.area_name || 'Session',
                    color: this.mapColor(s.display_color || '#58a6ff'),
                    type: 'actual',
                    label: null,
                    pathId: null,
                    pathName: null,
                    pathColor: null,
                    walked: false
                };
            });
        }

        this.blocks = [...planned, ...actual];
    },

    async saveBlock(block) {
        if (!dbManager.initialized) return;

        const date = this.viewMode === 'today'
            ? this.getDayDate(this.dayOffset)
            : this.getWeekDates(this.weekOffset)[block.day];
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
        this.closeDetail();
        this.render();
    },

    openDetail(b, anchorEl) {
        this.closePopover();
        const panel = document.getElementById('detail-panel');
        if (!panel) return;

        document.getElementById('detail-area-name').textContent = b.areaName;
        document.getElementById('detail-dot').className = `area-chip ${b.color} detail-dot`;

        const dur = this.calcDuration(b.sessions);
        const endStr = this.addMinutes(b.startHour, b.startMin, dur);
        const startStr = this.formatTime(b.startHour, b.startMin);
        document.getElementById('detail-time').textContent = `${startStr} – ${endStr}`;

        const date = this.viewMode === 'today'
            ? this.getDayDate(this.dayOffset)
            : this.getWeekDates(this.weekOffset)[b.day];
        const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        document.getElementById('detail-date').textContent = `${dateStr} · planned`;

        document.getElementById('detail-sessions').textContent = b.sessions;
        document.getElementById('detail-duration').textContent = this.formatDuration(dur);

        // Reset confirmation state each time panel opens
        document.getElementById('detail-actions')?.classList.remove('confirming');
        document.getElementById('detail-confirm')?.classList.remove('visible');

        document.getElementById('detail-delete-btn').onclick = () => {
            document.getElementById('detail-actions').classList.add('confirming');
            document.getElementById('detail-confirm').classList.add('visible');
            this._positionPanelNearBlock(panel, this._detailAnchorEl); // reflow height
        };
        document.getElementById('detail-edit-btn').onclick = () => { this.closeDetail(); this.openPopoverForEdit(b); };
        document.getElementById('detail-cancel-btn').onclick = () => {
            document.getElementById('detail-actions').classList.remove('confirming');
            document.getElementById('detail-confirm').classList.remove('visible');
            this._positionPanelNearBlock(panel, this._detailAnchorEl); // reflow height
        };
        document.getElementById('detail-confirm-btn').onclick = () => this.deleteBlock(b.id);

        this._detailAnchorEl = anchorEl || null;

        // Show first (triggers display:flex) so offsetHeight is measurable
        panel.classList.add('visible');
        this._positionPanelNearBlock(panel, anchorEl);
    },

    _positionPanelNearBlock(panel, anchorEl) {
        if (!anchorEl) return;

        const PANEL_W = panel.offsetWidth  || 240;
        const PANEL_H = panel.offsetHeight || 220;
        const GAP    = 8;   // gap between block edge and panel
        const MARGIN = 8;   // min distance from any visible edge

        const anchor  = anchorEl.getBoundingClientRect();
        const overlay = document.getElementById('focusPlannerOverlay')?.getBoundingClientRect();
        if (!overlay) return;

        // Use visualViewport when available — it excludes the browser's bottom bar,
        // on-screen keyboard, and iOS home indicator from the usable area.
        const vv = window.visualViewport;
        const visibleTop    = vv ? vv.offsetTop             : 0;
        const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
        const visibleLeft   = vv ? vv.offsetLeft            : 0;
        const visibleRight  = vv ? vv.offsetLeft + vv.width : window.innerWidth;

        // Account for the app's own mobile bottom bar (56px, visible on small screens)
        const mobileBar = document.querySelector('#focusPlannerOverlay .mobile-bottom-bar');
        const mobileBarH = (mobileBar && getComputedStyle(mobileBar).display !== 'none')
            ? mobileBar.offsetHeight : 0;

        // Effective safe bounds = intersection of overlay rect and visual viewport,
        // minus the in-app bottom bar
        const boundsTop    = Math.max(overlay.top,    visibleTop)    + MARGIN;
        const boundsBottom = Math.min(overlay.bottom, visibleBottom) - mobileBarH - MARGIN;
        const boundsLeft   = Math.max(overlay.left,   visibleLeft)   + MARGIN;
        const boundsRight  = Math.min(overlay.right,  visibleRight)  - MARGIN;

        // Horizontal: prefer right side of block, flip to left if it would clip
        let left = anchor.right + GAP;
        if (left + PANEL_W > boundsRight) {
            left = anchor.left - PANEL_W - GAP;
        }
        left = Math.max(boundsLeft, Math.min(left, boundsRight - PANEL_W));

        // Vertical: align panel top to block top, clamp within safe bounds
        let top = anchor.top;
        top = Math.max(boundsTop, Math.min(top, boundsBottom - PANEL_H));

        panel.style.left  = `${left}px`;
        panel.style.top   = `${top}px`;
        panel.style.right = 'auto'; // override CSS `right: 20px`
    },

    closeDetail() {
        const panel = document.getElementById('detail-panel');
        if (!panel) return;
        panel.classList.remove('visible');
        // Reset inline position so CSS defaults apply on next open before anchor is known
        panel.style.left = '';
        panel.style.top  = '';
        panel.style.right = '';
    },

    openPopoverForEdit(b) {
        this.editingBlockId = b.id;
        this.pendingDay = b.day;
        this.pendingHour = b.startHour;
        this.pendingMinutes = b.startMin;
        this.pendingAreaId = b.areaId;
        this.pendingColor = b.color;
        this.pendingPathId = b.pathId || null;
        this.sessionCount = b.sessions;

        const overlay = document.getElementById('popover-overlay');
        const pop = document.getElementById('popover');

        const areas = this.getAreas();
        const currentArea = areas.find(a => a.id === b.areaId) || areas[0];
        if (currentArea) {
            document.getElementById('popover-area-name').textContent = currentArea.name;
            document.getElementById('popover-area-dot').className = `popover-area-dot ${currentArea.color}`;
        }

        document.getElementById('popover-time').value =
            `${String(b.startHour).padStart(2, '0')}:${String(b.startMin).padStart(2, '0')}`;
        if (document.getElementById('popover-label')) {
            document.getElementById('popover-label').value = b.label || '';
        }

        const titleSpan = document.getElementById('popover-title-text');
        if (titleSpan) titleSpan.textContent = 'Edit block';

        this.updateSessionDisplay();
        this.updatePathDisplay();

        overlay.classList.add('visible');
        pop.classList.add('visible');
        this._positionPanelNearBlock(pop, this._detailAnchorEl);
        this.populateAreaPicker();
        this.populatePathPicker();
    },

    // ── Block drag helpers (pointer-based, works on touch + mouse) ──

    _updateBlockDragPreview(clientX, clientY, b, excludeEl) {
        this._clearBlockDragPreview();
        excludeEl.style.pointerEvents = 'none';
        const target = document.elementFromPoint(clientX, clientY);
        excludeEl.style.pointerEvents = '';
        const col = target?.closest?.('.day-col');
        if (!col) return;
        const rect = col.getBoundingClientRect();
        const y = Math.max(0, clientY - rect.top);
        const hours = this.getHours();
        const snapped = Math.round((y / this.ROW_HEIGHT) * 60 / 30) * 30;
        const absH = hours[0] + Math.floor(snapped / 60);
        const h = Math.max(hours[0], Math.min(hours[hours.length - 1], absH));
        const m = snapped % 60;
        const dur = this.calcDuration(b.sessions);
        const top = (h - hours[0]) * this.ROW_HEIGHT + (m / 60) * this.ROW_HEIGHT;
        const height = Math.max((dur / 60) * this.ROW_HEIGHT, 32);
        const preview = document.createElement('div');
        preview.id = 'block-drag-preview';
        preview.className = `block-drag-preview ${b.color}`;
        preview.style.cssText = `top:${top}px;height:${height}px;`;
        col.appendChild(preview);
    },

    _clearBlockDragPreview() {
        document.getElementById('block-drag-preview')?.remove();
    },

    _dropBlock(b, el, clientX, clientY) {
        el.style.pointerEvents = 'none';
        const target = document.elementFromPoint(clientX, clientY);
        el.style.pointerEvents = '';
        const col = target?.closest?.('.day-col');
        if (!col) return;
        const day = parseInt(col.dataset.day, 10);
        const rect = col.getBoundingClientRect();
        const y = Math.max(0, clientY - rect.top);
        const hours = this.getHours();
        const snapped = Math.round((y / this.ROW_HEIGHT) * 60 / 30) * 30;
        const absH = hours[0] + Math.floor(snapped / 60);
        const h = Math.max(hours[0], Math.min(hours[hours.length - 1], absH));
        const m = snapped % 60;
        this.moveBlock(b.id, day, h, m);
    },

    async moveBlock(blockId, newDay, newH, newM) {
        const block = this.blocks.find(b => b.id === blockId);
        if (!block) return;
        block.day = newDay;
        block.startHour = newH;
        block.startMin = newM;
        await this.saveBlock(block);
        this.renderBody();
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

    getDayDate(offset) {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return d;
    },

    shiftWeek(dir) {
        this.weekOffset += dir;
        this.loadData().then(() => this.render());
    },

    shiftPeriod(dir) {
        if (this.viewMode === 'today') {
            this.dayOffset += dir;
        } else {
            this.weekOffset += dir;
        }
        this.loadData().then(() => this.render());
    },

    goToday() {
        this.weekOffset = 0;
        this.dayOffset = 0;
        this.loadData().then(() => this.render());
    },

    setViewMode(mode) {
        this.viewMode = mode;
        if (mode === 'today') this.dayOffset = 0;
        document.getElementById('btn-view-today')?.classList.toggle('active', mode === 'today');
        document.getElementById('btn-view-week')?.classList.toggle('active', mode === 'week');
        this.loadData().then(() => this.render());
    },

    setTodaySubView(mode) {
        this.todaySubView = mode;
        this._syncSubViewButtons(mode);
        this.renderBody();
    },

    setWeekSubView(mode) {
        this.weekSubView = mode;
        this._syncSubViewButtons(mode);
        this.renderBody();
    },

    _syncSubViewButtons(mode) {
        document.getElementById('btn-sub-calendar')?.classList.toggle('active', mode === 'calendar');
        document.getElementById('btn-sub-list')?.classList.toggle('active', mode === 'list');
    },

    updateNavDisplay() {
        const isToday = this.viewMode === 'today';
        const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        // Sub-view toggle (shown for both modes)
        const subToggle = document.getElementById('sub-view-toggle');
        if (subToggle) subToggle.style.display = 'flex';
        const activeSubView = isToday ? this.todaySubView : this.weekSubView;
        this._syncSubViewButtons(activeSubView);

        const single = document.getElementById('cal-icon-widget');
        const start  = document.getElementById('cal-icon-widget-start');
        const dash   = document.getElementById('cal-icon-dash');
        const end    = document.getElementById('cal-icon-widget-end');

        if (isToday) {
            const date = this.getDayDate(this.dayOffset);
            document.getElementById('cal-icon-month').textContent = MONTHS[date.getMonth()].toUpperCase();
            document.getElementById('cal-icon-day').textContent = date.getDate();
            if (single) single.style.display = 'flex';
            if (start)  start.style.display  = 'none';
            if (dash)   dash.style.display   = 'none';
            if (end)    end.style.display    = 'none';
        } else {
            const dates = this.getWeekDates(this.weekOffset);
            const d0 = dates[0], d6 = dates[6];
            document.getElementById('cal-icon-month-start').textContent = MONTHS[d0.getMonth()].toUpperCase();
            document.getElementById('cal-icon-day-start').textContent   = d0.getDate();
            document.getElementById('cal-icon-month-end').textContent   = MONTHS[d6.getMonth()].toUpperCase();
            document.getElementById('cal-icon-day-end').textContent     = d6.getDate();
            if (single) single.style.display = 'none';
            if (start)  start.style.display  = 'flex';
            if (dash)   dash.style.display   = 'inline';
            if (end)    end.style.display    = 'flex';
        }
    },

    // ── RENDER ──
    render() {
        this.updateNavDisplay();
        this.renderHead();
        this.renderBody();
        this.renderSidebarAreas(this.areaSearchQuery);
        this.renderPathsSidebar(this.pathSearchQuery);
    },

    renderHead() {
        if (this.viewMode === 'today') {
            this.renderTodayHead();
        } else {
            this.renderWeekHead();
        }
        this._updateGutterHead();
    },

    renderTodayHead() {
        const head = document.getElementById('cal-head');
        head.className = 'cal-head today-mode';
        while (head.children.length > 1) head.removeChild(head.lastChild);

        const date = this.getDayDate(this.dayOffset);
        const isActuallyToday = this.dayOffset === 0;
        const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

        const dh = document.createElement('div');
        dh.className = 'day-head' + (isActuallyToday ? ' today' : '');

        const row = document.createElement('div');
        row.className = 'day-head-row';

        const nameEl = document.createElement('div');
        nameEl.className = 'day-name';
        nameEl.textContent = isActuallyToday ? 'Today' : DAYS_SHORT[date.getDay()];

        const numEl = document.createElement('div');
        numEl.className = 'day-num';
        numEl.textContent = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
        if (isActuallyToday) {
            const dot = document.createElement('span');
            dot.className = 'today-indicator';
            numEl.appendChild(dot);
        }

        row.appendChild(nameEl);
        row.appendChild(numEl);
        dh.appendChild(row);

        const dateStr = date.toISOString().split('T')[0];
        const pathsEndingToday = this.paths.filter(p => p.status === 'active' && p.deadline === dateStr);
        if (pathsEndingToday.length > 0) {
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
        }

        head.appendChild(dh);
    },

    renderWeekHead() {
        const dates = this.getWeekDates(this.weekOffset);
        const head = document.getElementById('cal-head');
        head.className = 'cal-head';

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
        const calEl = document.getElementById('calendar');
        const listEl = document.getElementById('today-list-view');

        const showList = (this.viewMode === 'today' && this.todaySubView === 'list')
                      || (this.viewMode === 'week'  && this.weekSubView  === 'list');

        if (showList) {
            if (calEl) calEl.style.display = 'none';
            if (listEl) listEl.style.display = 'flex';
            if (this.viewMode === 'today') {
                this.renderTodayList();
            } else {
                this.renderWeekList();
            }
        } else {
            if (calEl) calEl.style.display = '';
            if (listEl) listEl.style.display = 'none';
            if (this.viewMode === 'today') {
                this.renderTodayCalendarBody();
            } else {
                this.renderWeekBody();
            }
        }
    },

    _buildTimeGutter() {
        const gutter = document.createElement('div');
        gutter.className = 'time-gutter';
        this.getHours().forEach(h => {
            const lbl = document.createElement('div');
            lbl.className = 'time-label';
            lbl.textContent = `${h}:00`;
            gutter.appendChild(lbl);
        });
        return gutter;
    },

    _updateGutterHead() {
        const gutterHead = document.querySelector('#focusPlannerOverlay .cal-time-gutter-head');
        if (!gutterHead) return;
        gutterHead.innerHTML = '';
        const btn = document.createElement('button');
        btn.className = 'hours-mode-btn' + (this.calHoursMode === 'full' ? ' active' : '');
        btn.title = this.calHoursMode === 'active' ? 'Show full 24h' : 'Show active hours';
        btn.textContent = this.calHoursMode === 'active' ? '24h' : 'act';
        btn.setAttribute('onclick', 'toggleCalHoursMode()');
        gutterHead.appendChild(btn);
    },

    _addHourLines(col) {
        this.getHours().forEach((_, idx) => {
            const line = document.createElement('div');
            line.className = 'hour-line';
            line.style.top = `${idx * this.ROW_HEIGHT}px`;
            col.appendChild(line);
            const half = document.createElement('div');
            half.className = 'hour-line half';
            half.style.top = `${idx * this.ROW_HEIGHT + this.ROW_HEIGHT / 2}px`;
            col.appendChild(half);
        });
    },

    _addNowLine(col) {
        const now = new Date();
        const hours = this.getHours();
        const nowTop = (now.getHours() - hours[0]) * this.ROW_HEIGHT + (now.getMinutes() / 60) * this.ROW_HEIGHT;
        if (nowTop >= 0 && nowTop <= hours.length * this.ROW_HEIGHT) {
            const nl = document.createElement('div');
            nl.className = 'now-line';
            nl.style.top = `${nowTop}px`;
            col.appendChild(nl);
        }
    },

    _addDeadlineMarkers(col, dateStr) {
        this.paths.filter(p => p.status === 'active' && p.deadline === dateStr).forEach(p => {
            const top = (17 - this.getHours()[0]) * this.ROW_HEIGHT;
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
    },

    renderTodayCalendarBody() {
        const body = document.getElementById('cal-body');
        body.innerHTML = '';
        body.className = 'cal-body today-mode';
        body.appendChild(this._buildTimeGutter());

        const date = this.getDayDate(this.dayOffset);
        const isActuallyToday = this.dayOffset === 0;

        const col = document.createElement('div');
        col.className = 'day-col' + (isActuallyToday ? ' today' : '');
        col.dataset.day = 0;
        this.setupColumnEvents(col, 0, isActuallyToday);
        this._addHourLines(col);
        if (isActuallyToday) this._addNowLine(col);

        this.blocks.filter(b => this.shouldShow(b.type)).forEach(b => {
            const el = this.createBlockEl(b);
            if (this.activePathSet !== null && (!b.pathId || !this.activePathSet.has(b.pathId))) {
                el.classList.add('path-dimmed');
            }
            col.appendChild(el);
        });

        this._addDeadlineMarkers(col, date.toISOString().split('T')[0]);
        body.appendChild(col);
        const h = this.getHours();
        const totalH = h.length * this.ROW_HEIGHT;
        body.style.minHeight = `${totalH}px`;
        col.style.minHeight = `${totalH}px`;
    },

    renderWeekBody() {
        const body = document.getElementById('cal-body');
        body.innerHTML = '';
        body.className = 'cal-body';
        body.appendChild(this._buildTimeGutter());

        const today = new Date();
        const isCurrentWeek = this.weekOffset === 0;

        for (let d = 0; d < 7; d++) {
            const isToday = isCurrentWeek && (d === (today.getDay() === 0 ? 6 : today.getDay() - 1));
            const col = document.createElement('div');
            col.className = 'day-col' + (isToday ? ' today' : '');
            col.dataset.day = d;
            this.setupColumnEvents(col, d, isToday);
            this._addHourLines(col);
            if (isToday) this._addNowLine(col);

            this.blocks.filter(b => b.day === d && this.shouldShow(b.type)).forEach(b => {
                const el = this.createBlockEl(b);
                if (this.activePathSet !== null && (!b.pathId || !this.activePathSet.has(b.pathId))) {
                    el.classList.add('path-dimmed');
                }
                col.appendChild(el);
            });

            const dateStr = this.getWeekDates(this.weekOffset)[d].toISOString().split('T')[0];
            this._addDeadlineMarkers(col, dateStr);
            const totalH = this.getHours().length * this.ROW_HEIGHT;
            col.style.minHeight = `${totalH}px`;
            body.appendChild(col);
        }

        body.style.minHeight = `${this.getHours().length * this.ROW_HEIGHT}px`;
    },

    renderTodayList() {
        const listEl = document.getElementById('today-list-view');
        if (!listEl) return;
        listEl.innerHTML = '';

        const blocks = this.blocks
            .filter(b => this.shouldShow(b.type))
            .sort((a, b) => (a.startHour * 60 + a.startMin) - (b.startHour * 60 + b.startMin));

        if (blocks.length === 0) {
            listEl.innerHTML = `
                <div class="today-list-empty">
                    <div class="today-list-empty-icon">▭</div>
                    <div>No sessions for this day.</div>
                    <div style="font-size:12px;margin-top:2px">Switch to Calendar view and drag a focus area to plan one.</div>
                </div>
            `;
            return;
        }

        blocks.forEach(b => {
            listEl.appendChild(this._buildListItem(b));
        });
    },

    _buildListItem(b) {
        const dur = b.type === 'planned' ? this.calcDuration(b.sessions) : (b.durationMins || 0);
        const endStr = this.addMinutes(b.startHour, b.startMin, dur);
        const startStr = this.formatTime(b.startHour, b.startMin);
        const barColor = `var(--${b.color}-bar)`;

        const pathHtml = b.pathName
            ? `<span class="tli-path" style="color:${b.pathColor};border-color:${b.pathColor}40">◎ ${b.pathName}</span>`
            : '';
        const sessionsHtml = b.sessions > 1
            ? `<span class="block-session-chip">${b.sessions}×</span>`
            : '';

        const item = document.createElement('div');
        item.className = `today-list-item ${b.type}`;
        item.innerHTML = `
            <div class="tli-bar" style="background:${barColor}"></div>
            <div class="tli-content">
                <div class="tli-row1">
                    <div class="tli-dot" style="background:${barColor}"></div>
                    <div class="tli-name">${b.areaName}${b.label ? ` · ${b.label}` : ''}</div>
                </div>
                <div class="tli-row2">
                    <div class="tli-time">${startStr} – ${endStr}</div>
                    <div class="tli-meta">${this.formatDuration(dur)}${sessionsHtml ? ' · ' + sessionsHtml : ''}</div>
                    ${pathHtml}
                    <div class="tli-badge ${b.type}">${b.type === 'planned' ? 'Planned' : 'Done'}</div>
                </div>
            </div>
        `;

        if (b.type === 'planned') {
            item.addEventListener('click', () => this.openDetail(b, item));
        }

        if (this.activePathSet !== null && (!b.pathId || !this.activePathSet.has(b.pathId))) {
            item.classList.add('path-dimmed');
        }

        return item;
    },

    renderWeekList() {
        const listEl = document.getElementById('today-list-view');
        if (!listEl) return;
        listEl.innerHTML = '';

        const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        const weekDates = this.getWeekDates(this.weekOffset);
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];

        const blocks = this.blocks.filter(b => this.shouldShow(b.type));

        // Check if there's anything at all this week
        if (blocks.length === 0) {
            listEl.innerHTML = `
                <div class="today-list-empty">
                    <div class="today-list-empty-icon">▭</div>
                    <div>No sessions this week.</div>
                    <div style="font-size:12px;margin-top:2px">Switch to Calendar view and drag a focus area to plan one.</div>
                </div>
            `;
            return;
        }

        // Group by day index (0=Mon … 6=Sun)
        const byDay = Array.from({ length: 7 }, () => []);
        blocks.forEach(b => byDay[b.day].push(b));
        byDay.forEach(dayBlocks => dayBlocks.sort((a, b) => (a.startHour * 60 + a.startMin) - (b.startHour * 60 + b.startMin)));

        for (let d = 0; d < 7; d++) {
            const dayBlocks = byDay[d];
            if (dayBlocks.length === 0) continue;

            const dateStr = weekDates[d].toISOString().split('T')[0];
            const isToday = dateStr === todayStr;
            const dateNum = weekDates[d].getDate();
            const monthShort = weekDates[d].toLocaleString('default', { month: 'short' });

            const header = document.createElement('div');
            header.className = 'week-list-day-header' + (isToday ? ' today' : '');
            header.innerHTML = `<span class="wldh-name">${DAY_NAMES[d]}</span><span class="wldh-date">${monthShort} ${dateNum}</span>${isToday ? '<span class="wldh-today-pill">Today</span>' : ''}`;
            listEl.appendChild(header);

            dayBlocks.forEach(b => {
                listEl.appendChild(this._buildListItem(b));
            });
        }
    },

    renderSidebarAreas(query = '') {
        const container = document.getElementById('sidebar-areas');
        if (!container) return;
        container.innerHTML = '';

        let areas = this.getAreas();
        areas.sort((a, b) => a.name.localeCompare(b.name));

        const q = query.toLowerCase().trim();
        if (q) areas = areas.filter(a => a.name.toLowerCase().includes(q));

        if (areas.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'sidebar-areas-empty';
            empty.textContent = q
                ? 'No areas match your search.'
                : 'No active focus areas. Create one with + New.';
            container.appendChild(empty);
            return;
        }

        areas.forEach(area => {
            const card = document.createElement('div');
            card.className = `area-card ${area.color}`;

            const handle = document.createElement('i');
            handle.className = 'ph ph-dots-six-vertical area-card-drag-handle';
            handle.setAttribute('draggable', 'true');
            handle.addEventListener('dragstart', e => {
                e.stopPropagation();
                this.startDrag(e, area.id, area.name, area.color);
            });

            card.innerHTML = `<div class="area-card-header"><div class="area-card-name">${area.name}</div></div>`;
            card.querySelector('.area-card-header').prepend(handle);

            // On mobile: tap area → pre-select it and open session creation
            if (window.innerWidth <= 480) {
                card.style.cursor = 'pointer';
                card.addEventListener('click', () => {
                    this.pendingAreaId = area.id;
                    this.pendingColor = area.color;
                    this.closeMobileSheet();
                    const now = new Date();
                    this.openPopover(0, now.getHours(), 0);
                });
            }

            container.appendChild(card);
        });
    },

    renderPathsSidebar(query = '') {
        const list = document.getElementById('sidebar-paths-list');
        if (!list) return;
        list.innerHTML = '';

        const today = new Date(); today.setHours(0, 0, 0, 0);
        const weekEnd = new Date(today); weekEnd.setDate(today.getDate() + 7);
        const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

        let activePaths = this.paths.filter(p => p.status === 'active');
        const totalActive = activePaths.length;

        const q = query.toLowerCase().trim();
        if (q) activePaths = activePaths.filter(p => p.name.toLowerCase().includes(q));

        const thisWeek = [], thisMonth = [], other = [];
        activePaths.forEach(p => {
            if (!p.deadline) { other.push(p); return; }
            const dl = new Date(p.deadline + 'T00:00:00');
            if (dl <= weekEnd) thisWeek.push(p);
            else if (dl <= monthEnd) thisMonth.push(p);
            else other.push(p);
        });

        const byDeadlineAsc = (a, b) => {
            if (!a.deadline && !b.deadline) return a.name.localeCompare(b.name);
            if (!a.deadline) return 1;
            if (!b.deadline) return -1;
            return a.deadline.localeCompare(b.deadline);
        };
        thisWeek.sort(byDeadlineAsc);
        thisMonth.sort(byDeadlineAsc);
        other.sort((a, b) => a.name.localeCompare(b.name));

        const appendGroup = (label, paths) => {
            if (paths.length === 0) return;
            const header = document.createElement('div');
            header.className = 'sidebar-group-label';
            header.textContent = label;
            list.appendChild(header);
            paths.forEach(p => list.appendChild(this.createPathCard(p)));
        };

        if (activePaths.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'path-empty';
            empty.textContent = q ? 'No paths match your search.' : 'No active paths. Create one with + New.';
            list.appendChild(empty);
        } else {
            appendGroup('Deadlines: This Week', thisWeek);
            appendGroup('Deadlines: This Month', thisMonth);
            appendGroup('Other Paths', other);
        }

        // Archived section
        let archivedPaths = this.paths.filter(p => p.status === 'archived');
        if (q) archivedPaths = archivedPaths.filter(p => p.name.toLowerCase().includes(q));
        if (archivedPaths.length > 0) {
            const archiveHeader = document.createElement('div');
            archiveHeader.className = 'sidebar-group-label';
            archiveHeader.textContent = 'Archived';
            list.appendChild(archiveHeader);
            archivedPaths.forEach(p => {
                const card = this.createPathCard(p);
                card.classList.add('archived');
                list.appendChild(card);
            });
        }

        // Counter
        const counter = document.getElementById('sidebar-paths-counter');
        if (counter) {
            const shown = activePaths.length + archivedPaths.length;
            const total = this.paths.length;
            counter.textContent = q
                ? `Showing ${shown} of ${total} paths`
                : `${totalActive} active path${totalActive !== 1 ? 's' : ''}${archivedPaths.length ? ` · ${archivedPaths.length} archived` : ''}`;
        }
    },

    createPathCard(p) {
        const card = document.createElement('div');
        const isChecked = this.activePathSet === null
            ? true
            : this.activePathSet.has(p.id);
        card.className = 'path-card' + (isChecked ? ' active' : '');
        card.style.setProperty('--path-color', p.color);
        card.onclick = () => this.togglePath(p.id);

        if (p.status === 'active') {
            card.draggable = true;
            card.addEventListener('dragstart', e => this.startPathDrag(e, p));
        }

        const daysLeft = p.deadline ? this.daysUntil(p.deadline) : null;
        const deadlineStr = daysLeft === null ? '' :
            daysLeft < 0 ? 'overdue' :
            daysLeft === 0 ? 'today' :
            `${daysLeft}d`;

        const pct = p.totalPlanned > 0 ? Math.round((p.totalWalked / p.totalPlanned) * 100) : 0;

        card.innerHTML = `
            <div class="path-card-top">
                <div class="path-card-check"></div>
                <div class="path-card-dot" style="background:${p.color};"></div>
                <div class="path-card-name">${p.name}</div>
                ${deadlineStr ? `<span class="path-card-deadline${daysLeft !== null && daysLeft <= 2 ? ' urgent' : ''}">${deadlineStr}</span>` : ''}
                <button class="path-card-archive-btn" title="Archive path" onclick="archivePath('${p.id}', event)">↓</button>
            </div>
            ${p.totalPlanned > 0 ? `<div class="path-card-bar"><div class="path-card-bar-fill" style="width:${pct}%;background:${p.color};"></div></div>` : ''}
        `;
        return card;
    },

    togglePath(pathId) {
        const activePaths = this.paths.filter(p => p.status === 'active');
        if (this.activePathSet === null) {
            // ☑ all → enter filter, remember origin
            this._pathsFromAll = true;
            this.activePathSet = new Set([pathId]);
        } else if (this.activePathSet.size === 0) {
            // ☐ none → enter filter, remember origin
            this._pathsFromAll = false;
            this.activePathSet = new Set([pathId]);
        } else if (this.activePathSet.has(pathId)) {
            this.activePathSet.delete(pathId);
            if (this.activePathSet.size === 0) {
                // Snap back to whichever state we came from
                this.activePathSet = this._pathsFromAll ? null : new Set();
            }
        } else {
            this.activePathSet.add(pathId);
            // If every active path is now selected, snap to ☑ all
            if (this.activePathSet.size === activePaths.length) {
                this.activePathSet = null;
            }
        }
        this.updateMasterCheckbox();
        this.updatePathFilterChip();
        this.renderPathsSidebar(this.pathSearchQuery);
        this.renderBody();
        // On mobile: selecting a path returns to Calendar
        if (window.innerWidth <= 480 && this.activePathSet !== null) {
            setTimeout(() => this.closeMobileSheet(), 200);
        }
    },

    toggleMasterPaths() {
        if (this.activePathSet === null) {
            // ☑ → ☐ (dim all)
            this.activePathSet = new Set();
        } else if (this.activePathSet.size === 0) {
            // ☐ → ☑ (show all)
            this.activePathSet = null;
        } else {
            // ⊟ → ☑ (clear filter)
            this.activePathSet = null;
        }
        this.updateMasterCheckbox();
        this.updatePathFilterChip();
        this.renderPathsSidebar(this.pathSearchQuery);
        this.renderBody();
    },

    updateMasterCheckbox() {
        const cb = document.getElementById('paths-master-check');
        const countEl = document.getElementById('paths-master-count');
        const total = this.paths.filter(p => p.status === 'active').length;
        if (this.activePathSet === null) {
            // ☑ all
            cb.indeterminate = false;
            cb.checked = true;
            if (countEl) countEl.textContent = '';
        } else if (this.activePathSet.size === 0) {
            // ☐ none
            cb.indeterminate = false;
            cb.checked = false;
            if (countEl) countEl.textContent = '';
        } else {
            // ⊟ some
            cb.indeterminate = true;
            cb.checked = false;
            if (countEl) countEl.textContent = `${this.activePathSet.size} of ${total}`;
        }
    },

    filterAreas(query) {
        this.areaSearchQuery = query;
        this.renderSidebarAreas(query);
    },

    filterPaths(query) {
        this.pathSearchQuery = query;
        const masterRow = document.querySelector('#focusPlannerOverlay .paths-master-row');
        if (masterRow) masterRow.style.display = query ? 'none' : '';
        this.renderPathsSidebar(query);
    },

    clearPathFilter() {
        this.activePathSet = null;
        this.updateMasterCheckbox();
        this.updatePathFilterChip();
        this.renderPathsSidebar(this.pathSearchQuery);
        this.renderBody();
    },

    updatePathFilterChip() {
        const chip = document.getElementById('path-filter-chip');
        if (!chip) return;
        if (this.activePathSet === null) {
            chip.style.display = 'none';
            return;
        }
        chip.style.display = 'flex';
        const count = this.activePathSet.size;
        if (count === 0) {
            chip.innerHTML = `
                <span class="path-filter-chip-label">All dimmed</span>
                <span class="path-filter-chip-clear" title="Clear filter" onclick="clearPathFilter()">×</span>
            `;
        } else if (count === 1) {
            const path = this.paths.find(p => this.activePathSet.has(p.id));
            chip.innerHTML = path ? `
                <span class="path-filter-chip-dot" style="background:${path.color}"></span>
                <span class="path-filter-chip-name">${path.name}</span>
                <span class="path-filter-chip-clear" title="Clear filter" onclick="clearPathFilter()">×</span>
            ` : '';
        } else {
            chip.innerHTML = `
                <span class="path-filter-chip-label">Filtering:</span>
                <span class="path-filter-chip-name">${count} paths</span>
                <span class="path-filter-chip-clear" title="Clear filter" onclick="clearPathFilter()">×</span>
            `;
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
        const dur = b.type === 'actual' && b.durationMins != null
            ? b.durationMins
            : this.calcDuration(b.sessions);
        const top = (b.startHour - this.getHours()[0]) * this.ROW_HEIGHT + (b.startMin / 60) * this.ROW_HEIGHT;
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
            <div class="block-meta">${startStr} – ${endStr} · <span class="block-session-chip">${b.sessions}×</span></div>
            ${b.type === 'planned' ? `<div class="resize-handle"><div class="resize-handle-bar"></div></div>` : ''}
        `;

        // ── Unified tap / long-press / pointer-drag handler ──
        // Touch:  short tap (<450ms, no move) → openDetail
        //         long press (≥450ms)         → drag-ready state → drag to reposition
        // Mouse:  click (no move)             → openDetail
        //         mousedown + move            → drag to reposition immediately
        {
            const LONG_PRESS_MS = 450;
            const DRAG_THRESHOLD = 8;
            let pressStart = null; // { x, y, pointerId, type, timer }
            let blockDragActive = false;

            const startDrag = (pointerId, clientX, clientY) => {
                blockDragActive = true;
                el.classList.add('block-drag-ready');
                navigator.vibrate?.(30);
                el.setPointerCapture(pointerId);
                const ghost = document.getElementById('drag-ghost');
                const ghostInner = document.getElementById('drag-ghost-inner');
                if (ghost && ghostInner) {
                    ghost.classList.add('active');
                    ghost.style.left = `${clientX + 12}px`;
                    ghost.style.top  = `${clientY - 16}px`;
                    ghostInner.className = `drag-ghost-inner ${b.color}`;
                    ghostInner.textContent = `${b.areaName} · ${b.sessions}×`;
                }
            };

            const endDrag = (didDrop, clientX, clientY) => {
                clearTimeout(pressStart?.timer);
                el.classList.remove('block-drag-ready');
                document.getElementById('drag-ghost')?.classList.remove('active');
                this._clearBlockDragPreview();
                if (didDrop) this._dropBlock(b, el, clientX, clientY);
                blockDragActive = false;
                pressStart = null;
            };

            el.addEventListener('pointerdown', e => {
                if (e.button !== 0 && e.pointerType !== 'touch') return;
                e.stopPropagation();
                pressStart = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, type: e.pointerType, timer: null };
                blockDragActive = false;
                // Touch-only: gate drag behind a long press
                if (b.type === 'planned' && e.pointerType === 'touch') {
                    pressStart.timer = setTimeout(() => {
                        if (pressStart) startDrag(pressStart.pointerId, pressStart.x, pressStart.y);
                    }, LONG_PRESS_MS);
                }
            });

            el.addEventListener('pointermove', e => {
                if (!pressStart) return;
                const moved = Math.abs(e.clientX - pressStart.x) > DRAG_THRESHOLD ||
                              Math.abs(e.clientY - pressStart.y) > DRAG_THRESHOLD;
                if (moved && !blockDragActive) {
                    clearTimeout(pressStart.timer);
                    if (pressStart.type === 'touch') {
                        // Scroll gesture — cancel long press, let scroll happen
                        pressStart = null;
                        return;
                    }
                    // Mouse drag starts immediately on movement
                    if (b.type === 'planned') startDrag(pressStart.pointerId, e.clientX, e.clientY);
                }
                if (blockDragActive) {
                    const ghost = document.getElementById('drag-ghost');
                    if (ghost) { ghost.style.left = `${e.clientX + 12}px`; ghost.style.top = `${e.clientY - 16}px`; }
                    this._updateBlockDragPreview(e.clientX, e.clientY, b, el);
                }
            });

            el.addEventListener('pointerup', e => {
                if (!pressStart) return;
                const moved = Math.abs(e.clientX - pressStart.x) > DRAG_THRESHOLD ||
                              Math.abs(e.clientY - pressStart.y) > DRAG_THRESHOLD;
                const wasDragging = blockDragActive;
                endDrag(wasDragging && moved, e.clientX, e.clientY);
                if (!wasDragging && !moved) {
                    if (b.type === 'planned') this.openDetail(b, el);
                }
            });

            el.addEventListener('pointercancel', () => {
                if (pressStart) endDrag(false, 0, 0);
            });

            // Always stop propagation to prevent column's click/context menu
            el.addEventListener('click', e => e.stopPropagation());
        }

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
            const hours = this.getHours();
            const snappedH = hours[0] + Math.floor(snappedMins / 60);
            const snappedM = snappedMins % 60;
            const clampedH = Math.max(hours[0], Math.min(hours[hours.length - 1], snappedH));
            const top = (clampedH - hours[0]) * this.ROW_HEIGHT + (snappedM / 60) * this.ROW_HEIGHT;
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
            if (this.draggingBlock) {
                e.preventDefault();
                const { h, m, top } = getSnapPos(e);
                updateSnapGhost(h, m, top, this.draggingBlock.areaName, this.draggingBlock.color);
                return;
            }
            if (this.draggingDeadline) { e.preventDefault(); showDeadlineGhost(e); return; }
            if (this.draggingPath) { e.preventDefault(); return; }
            if (!this.dragging.color) return;
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
            snapGhost.classList.remove('visible');
            if (this.draggingBlock) {
                const { h, m } = getSnapPos(e);
                const blockId = this.draggingBlock.id;
                this.draggingBlock = null;
                this.moveBlock(blockId, d, h, m);
                return;
            }
            if (this.draggingDeadline) {
                this.handleDeadlineDrop(d);
            } else if (this.dragging.color) {
                const { h, m } = getSnapPos(e);
                this.handleDrop(d, h, m);
            }
            this.dragging = { areaId: null, color: null };
        });
        
        // ── Drag-to-create selection (Google Calendar style) ──
        // Uses pointer capture so events stay on col even when cursor leaves.
        // No e.preventDefault() → click event still fires for simple clicks.
        const selGhost = document.createElement('div');
        selGhost.className = 'drag-select-ghost';
        col.appendChild(selGhost);

        const getAbsMins = (clientY) => {
            const rect = col.getBoundingClientRect();
            const y = Math.max(0, clientY - rect.top);
            const hours = this.getHours();
            const snapped = Math.round((y / this.ROW_HEIGHT) * 60 / 30) * 30;
            const absH = hours[0] + Math.floor(snapped / 60);
            const clampedH = Math.max(hours[0], Math.min(hours[hours.length - 1], absH));
            return clampedH * 60 + (snapped % 60);
        };

        let selActive = false;
        let selMoved = false;
        let selStartAbsMins = 0;
        let selStartH = 0, selStartM = 0, selStartTop = 0, selStartClientY = 0;

        col.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            if (e.target !== col && !e.target.classList.contains('hour-line')) return;
            if (this.dragging.areaId || this.draggingBlock) return;

            col.setPointerCapture(e.pointerId);
            selActive = true;
            selMoved = false;
            selStartClientY = e.clientY;
            selStartAbsMins = getAbsMins(e.clientY);
            selStartH = Math.floor(selStartAbsMins / 60);
            selStartM = selStartAbsMins % 60;
            const hours = this.getHours();
            selStartTop = (selStartH - hours[0]) * this.ROW_HEIGHT + (selStartM / 60) * this.ROW_HEIGHT;
        });

        col.addEventListener('pointermove', e => {
            if (!selActive) return;
            if (!selMoved && Math.abs(e.clientY - selStartClientY) < 8) return;
            selMoved = true;
            timePip.classList.remove('visible');

            const endAbsMins = getAbsMins(e.clientY);
            const durationMins = Math.max(30, endAbsMins - selStartAbsMins);
            const height = Math.max((30 / 60) * this.ROW_HEIGHT, (durationMins / 60) * this.ROW_HEIGHT);
            const sessions = Math.max(1, this.calcSessionsFromDuration(durationMins));
            const endStr = this.addMinutes(selStartH, selStartM, durationMins);

            selGhost.className = 'drag-select-ghost visible';
            selGhost.style.top = `${selStartTop}px`;
            selGhost.style.height = `${height}px`;
            selGhost.innerHTML = `
                <div class="dsg-label">
                    <span class="dsg-time">${this.formatTime(selStartH, selStartM)} – ${endStr}</span>
                    <span class="dsg-sessions">${sessions}×</span>
                </div>
            `;
        });

        col.addEventListener('pointerup', e => {
            if (!selActive) return;
            selActive = false;
            selGhost.className = 'drag-select-ghost';

            if (selMoved) {
                const endAbsMins = getAbsMins(e.clientY);
                const durationMins = Math.max(30, endAbsMins - selStartAbsMins);
                const sessions = Math.max(1, this.calcSessionsFromDuration(durationMins));
                this.openPopover(d, selStartH, selStartM, sessions);
            }
        });

        col.addEventListener('pointercancel', () => {
            selActive = false;
            selGhost.className = 'drag-select-ghost';
        });

        col.addEventListener('click', e => {
            // Suppress click if a drag-select just completed (pointerup already opened popover)
            if (selMoved) { selMoved = false; return; }
            if (e.target === col || e.target.classList.contains('hour-line')) {
                const { h, m } = getSnapPos(e);
                this.showCalContextMenu(e, d, h, m);
            }
        });
    },

    // ── CALENDAR CONTEXT MENU ──
    showCalContextMenu(e, d, h, m) {
        // Remove any existing context menu
        const existing = document.getElementById('cal-ctx-menu');
        if (existing) existing.remove();

        // Compute date string for deadline pre-fill
        let dateStr;
        if (this.viewMode === 'today') {
            dateStr = this.getDayDate(this.dayOffset).toISOString().split('T')[0];
        } else {
            dateStr = this.getWeekDates(this.weekOffset)[d].toISOString().split('T')[0];
        }

        const menu = document.createElement('div');
        menu.id = 'cal-ctx-menu';
        menu.className = 'cal-ctx-menu';

        const items = [
            { label: 'New Focus Session', icon: '▶', action: () => this.openPopover(d, h, m) },
            { label: 'New Path Deadline', icon: '◎', action: () => this.openPathModal(dateStr) },
        ];

        items.forEach(({ label, icon, action }) => {
            const btn = document.createElement('button');
            btn.className = 'cal-ctx-item';
            btn.innerHTML = `<span class="cal-ctx-icon">${icon}</span>${label}`;
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                menu.remove();
                action();
            });
            menu.appendChild(btn);
        });

        // Position near click
        const overlay = document.getElementById('focusPlannerOverlay');
        const overlayRect = overlay.getBoundingClientRect();
        let x = e.clientX - overlayRect.left + 8;
        let y = e.clientY - overlayRect.top + 4;

        menu.style.left = x + 'px';
        menu.style.top  = y + 'px';
        overlay.appendChild(menu);

        // Dismiss on outside click
        const dismiss = (ev) => {
            if (!menu.contains(ev.target)) {
                menu.remove();
                document.removeEventListener('click', dismiss, true);
            }
        };
        // Use capture so it fires before other handlers
        setTimeout(() => document.addEventListener('click', dismiss, true), 0);
    },

    // ── DRAG & DROP ──
    startDrag(e, areaId, areaName, color) {
        console.log('[DnD] dragstart fired', { areaId, areaName, color });
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

        const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
        canvas.style.cssText = 'position:fixed;top:-2px;left:-2px;opacity:0;pointer-events:none;';
        document.body.appendChild(canvas);
        e.dataTransfer.setDragImage(canvas, 0, 0);

        let moveHandler;
        let endHandler;

        moveHandler = (ev) => {
            ev.preventDefault();
            if (ghost) {
                ghost.style.left = `${ev.clientX + 12}px`;
                ghost.style.top = `${ev.clientY - 16}px`;
            }
        };

        endHandler = () => {
            canvas.remove();
            if (ghost) ghost.classList.remove('active');
            document.documentElement.removeEventListener('dragover', moveHandler);
            document.documentElement.removeEventListener('dragend', endHandler);
        };

        document.documentElement.addEventListener('dragover', moveHandler);
        document.documentElement.addEventListener('dragend', endHandler);
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

        const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
        canvas.style.cssText = 'position:fixed;top:-2px;left:-2px;opacity:0;pointer-events:none;';
        document.body.appendChild(canvas);
        e.dataTransfer.setDragImage(canvas, 0, 0);

        const moveHandler = (ev) => {
            ev.preventDefault();
            if (ghost) {
                ghost.style.left = `${ev.clientX + 12}px`;
                ghost.style.top = `${ev.clientY - 16}px`;
            }
        };
        const endHandler = () => {
            canvas.remove();
            if (ghost) ghost.classList.remove('active');
            this.draggingPath = null;
            document.documentElement.removeEventListener('dragover', moveHandler);
            document.documentElement.removeEventListener('dragend', endHandler);
        };
        document.documentElement.addEventListener('dragover', moveHandler);
        document.documentElement.addEventListener('dragend', endHandler);
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

        const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
        canvas.style.cssText = 'position:fixed;top:-2px;left:-2px;opacity:0;pointer-events:none;';
        document.body.appendChild(canvas);
        e.dataTransfer.setDragImage(canvas, 0, 0);

        const moveHandler = (ev) => {
            ev.preventDefault();
            if (ghost) {
                ghost.style.left = `${ev.clientX + 12}px`;
                ghost.style.top = `${ev.clientY - 16}px`;
            }
        };
        const endHandler = () => {
            canvas.remove();
            if (ghost) ghost.classList.remove('active');
            this.draggingDeadline = false;
            document.documentElement.removeEventListener('dragover', moveHandler);
            document.documentElement.removeEventListener('dragend', endHandler);
        };
        document.documentElement.addEventListener('dragover', moveHandler);
        document.documentElement.addEventListener('dragend', endHandler);
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
    openPopover(day, hour, mins, sessions) {
        this.editingBlockId = null;
        this.closeDetail();
        const overlay = document.getElementById('popover-overlay');
        const pop = document.getElementById('popover');

        const titleSpan = document.getElementById('popover-title-text');
        if (titleSpan) titleSpan.textContent = 'New block';

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
        
        this.sessionCount = sessions ?? 2;
        this.updateSessionDisplay();

        // Pre-select active path if exactly one is filtered
        if (this.activePathSet !== null && this.activePathSet.size === 1) {
            this.pendingPathId = [...this.activePathSet][0];
        }
        this.updatePathDisplay();

        overlay.classList.add('visible');
        pop.classList.add('visible');

        // Position near calendar body center as a sensible default for new blocks
        const calBody = document.getElementById('cal-body') || document.getElementById('focusPlannerOverlay');
        if (calBody) {
            const r = calBody.getBoundingClientRect();
            const pw = pop.offsetWidth  || 280;
            const ph = pop.offsetHeight || 320;
            pop.style.left  = `${Math.round(r.left + (r.width  - pw) / 2)}px`;
            pop.style.top   = `${Math.round(r.top  + (r.height - ph) / 2)}px`;
            pop.style.right = 'auto';
        }
        this.populateAreaPicker();
        this.populatePathPicker();
    },

    closePopover() {
        document.getElementById('popover-overlay').classList.remove('visible');
        const pop = document.getElementById('popover');
        pop.classList.remove('visible');
        pop.style.left = '';
        pop.style.top  = '';
        pop.style.right = '';
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

        // Auto-select the new path
        this.togglePath(path.id);
        this.render();
    },

    async archivePath(pathId, e) {
        e.stopPropagation();
        if (dbManager.initialized) { console.log('[archivePath] manual:', pathId); await dbManager.archivePath(pathId); }
        const p = this.paths.find(p => p.id === pathId);
        if (p) p.status = 'archived';
        if (this.activePathSet?.size > 0) this.activePathSet.delete(pathId);
        if (this.activePathSet?.size === 0) this.activePathSet = null;
        this.updateMasterCheckbox();
        this.updatePathFilterChip();
        this.renderPathsSidebar(this.pathSearchQuery);
        this.renderBody();
    },

    // ── AREA MODAL ──
    openAreaModal() {
        const overlay = document.getElementById('area-modal-overlay');
        if (!overlay) return;
        document.getElementById('area-modal-name').value = '';
        this.selectedAreaColor = '#58a6ff';
        document.querySelectorAll('#area-color-picker .path-color-swatch').forEach(s => {
            s.classList.toggle('active', s.dataset.color === '#58a6ff');
        });
        this._populateAreaCategorySelect();
        document.getElementById('area-new-category-row').style.display = 'none';
        document.getElementById('area-modal-new-cat-name').value = '';
        document.getElementById('area-modal-new-cat-icon').value = '📁';
        document.getElementById('area-modal-selected-icon').textContent = '📁';
        overlay.classList.add('visible');
        setTimeout(() => document.getElementById('area-modal-name')?.focus(), 50);
    },

    _populateAreaCategorySelect() {
        const select = document.getElementById('area-modal-category');
        if (!select) return;
        const uncategorized = state.categories.find(c => c.isDefault) || { name: 'Uncategorized', icon: '📁' };
        const options = state.categories
            .filter(c => !c.isDefault)
            .map(c => `<option value="${c.name}">${c.icon} ${c.name}</option>`)
            .join('');
        select.innerHTML = `
            <option value="${uncategorized.name}">${uncategorized.icon} ${uncategorized.name}</option>
            ${options}
            <option value="__new__">+ Add New Category…</option>
        `;
    },

    onAreaCategoryChange(value) {
        const row = document.getElementById('area-new-category-row');
        if (!row) return;
        row.style.display = value === '__new__' ? 'flex' : 'none';
        if (value === '__new__') {
            row.style.flexDirection = 'column';
            document.getElementById('area-modal-new-cat-name')?.focus();
        }
    },

    toggleAreaIconPicker() {
        const picker = document.getElementById('area-modal-icon-picker');
        if (picker) picker.style.display = picker.style.display === 'none' ? 'flex' : 'none';
    },

    selectAreaIcon(icon) {
        document.getElementById('area-modal-selected-icon').textContent = icon;
        document.getElementById('area-modal-new-cat-icon').value = icon;
        document.getElementById('area-modal-icon-picker').style.display = 'none';
    },

    closeAreaModal() {
        document.getElementById('area-modal-overlay')?.classList.remove('visible');
    },

    selectAreaColor(color, el) {
        this.selectedAreaColor = color;
        document.querySelectorAll('#area-color-picker .path-color-swatch').forEach(s => s.classList.remove('active'));
        el.classList.add('active');
    },

    async saveNewArea() {
        const name = document.getElementById('area-modal-name')?.value.trim();
        if (!name) { document.getElementById('area-modal-name')?.focus(); return; }

        const catSelect = document.getElementById('area-modal-category');
        let category = catSelect?.value || 'Uncategorized';

        if (category === '__new__') {
            const newName = document.getElementById('area-modal-new-cat-name')?.value.trim();
            const newIcon = document.getElementById('area-modal-new-cat-icon')?.value || '📁';
            if (!newName) { document.getElementById('area-modal-new-cat-name')?.focus(); return; }
            state.categories.push({ id: uuidv7(), name: newName, icon: newIcon });
            category = newName;
        }

        const task = FocusService.addFocusArea(name, category, this.selectedAreaColor);
        if (task && dbManager.initialized) {
            await dbManager.insertFocusArea(task);
        }

        this.closeAreaModal();
        this.renderSidebarAreas(this.areaSearchQuery);
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

        if (this.editingBlockId) {
            // Update existing block
            const block = this.blocks.find(b => b.id === this.editingBlockId);
            if (block) {
                const prevSessions = block.sessions;
                block.day = this.pendingDay;
                block.startHour = h;
                block.startMin = m;
                block.sessions = this.sessionCount;
                block.areaId = area.id;
                block.areaName = area.name;
                block.color = area.color;
                block.label = label || null;
                block.pathId = this.pendingPathId || null;
                block.pathName = path?.name || null;
                block.pathColor = path?.color || null;
                this.saveBlock(block);
                // Update path progress count
                if (path) path.totalPlanned = (path.totalPlanned || 0) + (this.sessionCount - prevSessions);
            }
            this.editingBlockId = null;
        } else {
            // Create new block
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
            if (path) path.totalPlanned = (path.totalPlanned || 0) + this.sessionCount;
        }

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

    // ── MOBILE ──
    initMobile() {
        if (!window.matchMedia('(max-width: 480px)').matches) return;

        // Move sidebar sections into their mobile sheets (IDs stay the same, render logic unchanged)
        const pathsSection = document.querySelector('#focusPlannerOverlay .sidebar-section--paths');
        const areasSection = document.querySelector('#focusPlannerOverlay .sidebar-section:not(.sidebar-section--paths)');
        const pathsSheet  = document.getElementById('mobile-sheet-paths');
        const areasSheet  = document.getElementById('mobile-sheet-areas');

        if (pathsSection && pathsSheet) pathsSheet.appendChild(pathsSection);
        if (areasSection && areasSheet) areasSheet.appendChild(areasSection);
    },

    mobileTab(tab) {
        document.querySelectorAll('.mobile-tab').forEach(t => t.classList.remove('active'));
        document.getElementById(`mobile-tab-${tab}`)?.classList.add('active');
        if (tab === 'calendar') {
            this.closeMobileSheet();
        } else {
            this.openMobileSheet(`mobile-sheet-${tab}`);
        }
    },

    openMobileSheet(id) {
        const sheet = document.getElementById(id);
        const backdrop = document.getElementById('mobile-sheet-backdrop');
        document.querySelectorAll('.mobile-sheet').forEach(s => s.classList.remove('open'));
        if (sheet) sheet.classList.add('open');
        if (backdrop) backdrop.classList.add('open');
    },

    closeMobileSheet() {
        document.querySelectorAll('.mobile-sheet').forEach(s => s.classList.remove('open'));
        const backdrop = document.getElementById('mobile-sheet-backdrop');
        if (backdrop) backdrop.classList.remove('open');
        document.querySelectorAll('.mobile-tab').forEach(t => t.classList.remove('active'));
        document.getElementById('mobile-tab-calendar')?.classList.add('active');
    },

    setupEventListeners() {
        // Bind HTML buttons to class methods
        // Note: HTML onclicks won't work with module methods directly unless exposed to window
        // So we attach listeners here or expose to window.
        // For simplicity in refactoring, we'll attach to window for now or bind IDs.
        
        console.log('PlannerView setupEventListeners called'); // Added for debugging
        window.shiftWeek = (d) => this.shiftWeek(d);
        window.shiftPeriod = (d) => this.shiftPeriod(d);
        window.goToday = () => this.goToday();
        window.setViewMode = (mode) => this.setViewMode(mode);
        window.setTodaySubView = (mode) => this.setTodaySubView(mode);
        window.setWeekSubView = (mode) => this.setWeekSubView(mode);
        window.setSubView = (mode) => {
            if (this.viewMode === 'today') this.setTodaySubView(mode);
            else this.setWeekSubView(mode);
        };
        window.openPopoverDefault = () => {
            const day = this.viewMode === 'today' ? 0 : (new Date().getDay() === 0 ? 6 : new Date().getDay() - 1);
            this.openPopover(day, 9, 0);
        };
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
        window.setActivePath = (id) => id === null ? this.clearPathFilter() : this.togglePath(id);
        window.togglePath = (id) => this.togglePath(id);
        window.toggleMasterPaths = () => this.toggleMasterPaths();
        window.clearPathFilter = () => this.clearPathFilter();
        window.toggleCalHoursMode = () => this.toggleCalHoursMode();
        window.filterAreas = (q) => this.filterAreas(q);
        window.filterPaths = (q) => this.filterPaths(q);
        window.openAreaModal = () => this.openAreaModal();
        window.closeAreaModal = () => this.closeAreaModal();
        window.closeAreaModalIfBg = (e) => { if (e.target === document.getElementById('area-modal-overlay')) this.closeAreaModal(); };
        window.selectAreaColor = (color, el) => this.selectAreaColor(color, el);
        window.saveNewArea = () => this.saveNewArea();
        window.onAreaCategoryChange = (v) => this.onAreaCategoryChange(v);
        window.toggleAreaIconPicker = () => this.toggleAreaIconPicker();
        window.selectAreaIcon = (icon) => this.selectAreaIcon(icon);
        window.closeDetail = () => this.closeDetail();
        
        // Navigation buttons
        window.mobileTab = (tab) => this.mobileTab(tab);
        window.closeMobileSheet = () => this.closeMobileSheet();

        document.getElementById('focusPlannerNavBtn')?.addEventListener('click', () => {
            document.getElementById('menuDropdown').classList.remove('open');
            this.open();
        });
        document.getElementById('focusPlannerClose')?.addEventListener('click', () => this.close());

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && document.getElementById('focusPlannerOverlay').style.display !== 'none') {
                this.close();
            }
        });

        this.initMobile();
    }
};
