/**
 * PomoFlow App Controller (The Glue Layer)
 * This file coordinates Domain Services and UI Views.
 */

import { state, mutations, CURRENT_VERSION, DEFAULT_FOCUS_AREAS, ACHIEVEMENTS } from './state/store.js';
import { timer } from './engine/timer.js';
import { dbManager } from './db.js';
import { HistoryService } from './services/history.service.js';
import { FocusService } from './services/focus.service.js';
import { TimerService } from './services/timer.service.js';
import { SettingsService } from './services/settings.service.js';
import { uuidv7 } from './utils/uuid.js';
import { FocusView } from './ui/focus.view.js';
import { TimerView } from './ui/timer.view.js';
import { DashboardView } from './ui/dashboard.view.js';
import { PlannerView } from './ui/planner.view.js';
import { NotificationView } from './ui/notifications.view.js';
import { NotificationService } from './services/notification.service.js';
import { syncService } from './services/sync.service.js';
import { supabase } from './services/supabase.js';

let currentFilter = 'today';
let historySort = 'newest';
let historyCategory = null;
let historyPage = 0;
const HISTORY_PAGE_SIZE = 20;
let editingSessionId = null;
let editingTaskId = null;
let notificationView;

// --- 1. INITIALIZATION ---

async function init() {
    // Initialize NotificationView early so UI is responsive
    try {
        notificationView = new NotificationView();
        window.notificationView = notificationView;
        window.renderUpcomingBlockStrip = renderUpcomingBlockStrip;
    } catch (e) {
        console.error('Failed to init NotificationView:', e);
    }

    // ── Auth gate ────────────────────────────────────────────────────────────
    // Handle magic link callback — only when code param is present
    if (new URLSearchParams(window.location.search).has('code')) {
        await supabase.auth.exchangeCodeForSession(window.location.search).catch(() => {});
        history.replaceState(null, '', window.location.pathname);
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        showAuthOverlay();
        return;
    }

    supabase.auth.onAuthStateChange((event, newSession) => {
        if (event === 'SIGNED_IN' && newSession) {
            hideAuthOverlay();
            if (!dbManager.initialized) init();
        }
        if (event === 'SIGNED_OUT') showAuthOverlay();
    });
    // ─────────────────────────────────────────────────────────────────────────

    try { await dbManager.init(); } catch (e) { console.error('DB Init failed', e); }

    if (dbManager.initialized) {
        await syncService.pullFromCloud();

        const fullState = await dbManager.getFullState();
        if (fullState) {
            if (fullState.tasks?.length > 0) state.tasks = fullState.tasks;
            if (fullState.sessions?.length > 0) state.sessions = fullState.sessions;
            if (fullState.aims?.length > 0) state.aims = fullState.aims;
            if (fullState.paths?.length > 0) state.paths = fullState.paths;
            if (fullState.settings) state.settings = { ...state.settings, ...fullState.settings };

            if (fullState.profile?.full_profile) {
                const p = fullState.profile.full_profile;
                state.xp = p.xp || 0; state.totalXp = p.totalXp || 0;
                state.level = p.level || 1; state.avatar = p.avatar || '🦉';
                state.unlockedAchievements = p.unlockedAchievements || [];
                state.collapsedCategories = p.collapsedCategories || [];
                state.activeCategoryIndex = p.activeCategoryIndex || 0;
            }

            if (fullState.notifications) state.notifications = fullState.notifications;

            if (fullState.appState) {
                if (fullState.appState.timer_state) state.timerState = { ...state.timerState, ...fullState.appState.timer_state };
                if (fullState.appState.categories) state.categories = fullState.appState.categories;
                if (fullState.appState.theme) {
                    const t = fullState.appState.theme;
                    document.documentElement.setAttribute('data-theme', t);
                    localStorage.setItem('pf_theme', t);
                    const themeIcon = document.getElementById('themeIcon');
                    if (themeIcon) themeIcon.className = t === 'light' ? 'ph ph-moon' : 'ph ph-sun';
                }
                if (fullState.appState.notification_prompt) state.notificationPermission = fullState.appState.notification_prompt;
                if (fullState.appState.ui_state) {
                    const ui = fullState.appState.ui_state;
                    state.selectedTaskColor = ui.selectedTaskColor || '#58a6ff';
                    state.selectedFocusAreaIds = ui.selectedFocusAreaIds || [];
                }
            }
        }
        // Re-render notifications with loaded state
        notificationView.render();
    }

    if (state.tasks.length === 0) {
        const now = new Date().toISOString();
        state.tasks = DEFAULT_FOCUS_AREAS.map((t, index) => ({
            id: uuidv7(),
            name: t.name, category: t.category, color: t.color,
            completed: false,
            createdAt: now, created_at: now, updated_at: now,
            totalTime: 0
        }));
        saveData();
    } else {
        const allCompleted = state.tasks.every(t => t.completed);
        if (allCompleted) {
            state.tasks.forEach(t => t.completed = false);
            saveData();
        }
    }

    if (dbManager.initialized) syncService.startPolling();

    // If app opened via notification tap, pre-select the planned focus area
    const pendingFocusAreaId = sessionStorage.getItem('pendingFocusAreaId');
    if (pendingFocusAreaId) {
        sessionStorage.removeItem('pendingFocusAreaId');
        const pendingTask = state.tasks.find(t => t.id === pendingFocusAreaId);
        if (pendingTask && !state.timerState.isRunning) {
            state.timerState.activeTaskId = pendingTask.id;
        }
    }

    // Show auth user email in sidenav
    supabase.auth.getSession().then(({ data: { session } }) => {
        const email = session?.user?.email;
        if (email) {
            const el = document.getElementById('sidenavUserEmail');
            if (el) el.textContent = email;
        }
        const avatarEl = document.getElementById('sidenavAvatar');
        const mobileAvatarEl = document.getElementById('mobileAvatar');
        if (avatarEl) {
            const avatarUrl = session?.user?.user_metadata?.avatar_url || session?.user?.user_metadata?.picture;
            if (avatarUrl) {
                fetch(avatarUrl, { mode: 'cors' })
                    .then(r => r.blob())
                    .then(blob => {
                        const blobUrl = URL.createObjectURL(blob);
                        const imgHtml = `<img src="${blobUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
                        avatarEl.innerHTML = imgHtml;
                        if (mobileAvatarEl) mobileAvatarEl.innerHTML = imgHtml;
                    })
                    .catch(() => {}); // keep emoji fallback on error
            }
        }
    });

    setupEventListeners();
    FocusView.populateCategorySelects();
    PlannerView.init();
    FocusView.init({
        onPlay: (task) => {
            if (state.timerState.activeTaskId === task.id) toggleTimer();
            else { state.timerState.activeTaskId = task.id; timer.stop(); timer.applyMode('work'); timer.start(); }
            refreshUI(); closeFocusAreas();
        },
        onEdit: (task) => openFocusAreaEditModal(task),
        onToggleComplete: (id) => toggleFocusAreaComplete(id),
        onDelete: (id) => deleteFocusArea(id),
        onEditCategory: (name) => openCategoryEditModal(name),
        onDeleteCategory: (name) => deleteCategory(name),
        onMoveToCategory: (taskId, newCat) => moveTaskToCategory(taskId, newCat),
        onStateChange: () => saveData()
    });
    
    timer.init({
        onTick: () => TimerView.updateDisplay(),
        onComplete: handleSessionComplete,
        onSave: saveData
    });

    refreshUI();
    scheduleMidnightRefresh();

    // Signal app ready — hide loading bar and unlock UI
    const loadingBar = document.getElementById('appLoadingBar');
    if (loadingBar) loadingBar.classList.add('done');
    document.body.classList.remove('app-loading');

    updateDateTime();
    state.lastRefreshTime = Date.now();
    setInterval(updateDateTime, 1000);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            updateDateTime();
            renderUpcomingBlockStrip();
        }
    });

    restoreTimerState();
    checkAchievements();
    checkPathDeadlines();
    
    // Check reminders immediately and then every minute
    checkBlockReminders();
    setInterval(checkBlockReminders, 60000);
}

function checkPathDeadlines() {
    if (!dbManager.initialized) return;
    dbManager.getAllPaths().then(paths => {
        const today = new Date().toISOString().split('T')[0];
        const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        
        const lastNotifiedKey = 'pf_paths_last_notified';
        let lastNotified = {};
        try {
            lastNotified = JSON.parse(localStorage.getItem(lastNotifiedKey) || '{}');
        } catch(e) {}

        paths.forEach(p => {
            if (p.status !== 'active' || !p.deadline) return;
            if (p.deadline < today) {
                // auto-archive
                dbManager.archivePath(p.id).catch(() => {});
            } else if (p.deadline <= soon) {
                const days = Math.ceil((new Date(p.deadline) - new Date(today)) / 86400000);
                const msg = `Path "${p.name}" deadline in ${days} day${days === 1 ? '' : 's'}!`;
                
                // Only notify once per day for this path
                if (lastNotified[p.id] !== today) {
                    notify(msg);
                    lastNotified[p.id] = today;
                }
            }
        });
        localStorage.setItem(lastNotifiedKey, JSON.stringify(lastNotified));
    }).catch(() => {});
}

// --- UPCOMING BLOCK STRIP ---

function _fmtBlockTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const ampm = h < 12 ? 'AM' : 'PM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function _fmtDuration(minutes) {
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

async function renderUpcomingBlockStrip() {
    const blockRow = document.getElementById('blockContextRow');
    const strip = document.getElementById('contextStrip');
    if (!blockRow || !strip) return;

    const hideBlock = () => {
        blockRow.style.display = 'none';
        delete strip.dataset.blockState;
    };

    if (!dbManager.initialized) { hideBlock(); return; }

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const tomorrowDate = new Date(now); tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth() + 1).padStart(2, '0')}-${String(tomorrowDate.getDate()).padStart(2, '0')}`;
    let blocks;
    try {
        blocks = await dbManager.getUpcomingBlocksForToday(today, tomorrow);
    } catch (e) {
        hideBlock(); return;
    }

    const cur = now.getHours() * 60 + now.getMinutes();
    const todayBlocks = blocks.filter(b => b.planned_date === today);
    const tomorrowBlocks = blocks.filter(b => b.planned_date === tomorrow);

    const activeBlock = todayBlocks.find(b => b.start_minutes <= cur && (b.start_minutes + b.duration_minutes) > cur);
    const graceBlock = !activeBlock && todayBlocks.find(b => b.start_minutes <= cur && cur < (b.start_minutes + b.duration_minutes * 2));
    const upcomingBlock = todayBlocks.find(b => b.start_minutes > cur);
    const tomorrowBlock = tomorrowBlocks[0] || null;

    const block = activeBlock || graceBlock || upcomingBlock || tomorrowBlock;

    if (!block) { hideBlock(); return; }

    const isTomorrow = block.planned_date === tomorrow;
    const activeTaskId = state.timerState.activeTaskId;
    const isRunning = state.timerState.isRunning;
    const color = block.area_color || '#58a6ff';
    const name = block.area_name || 'Focus';
    const wasExpanded = blockRow.dataset.expanded === 'true';

    // Hide block context if user is already focused on this area
    if (activeTaskId === block.focus_area_id) {
        hideBlock(); return;
    }

    let stateKey, label;
    if (activeBlock || graceBlock) {
        if (activeTaskId && activeTaskId !== block.focus_area_id) {
            stateKey = 'conflict';
            label = `📅 ${name} · ${_fmtBlockTime(block.start_minutes)}`;
        } else {
            stateKey = 'active';
            label = `📅 ${name} · ${_fmtBlockTime(block.start_minutes)}`;
        }
    } else if (isTomorrow) {
        stateKey = 'upcoming';
        label = `${name} · tomorrow ${_fmtBlockTime(block.start_minutes)}`;
    } else {
        const delta = block.start_minutes - cur;
        stateKey = 'upcoming';
        label = `${name} · starts in ${_fmtDuration(delta)}`;
    }

    strip.dataset.blockState = stateKey;
    blockRow.style.display = '';

    const isQueued = state.timerState.queuedTaskId === block.focus_area_id;
    const userCollapsed = blockRow.dataset.expanded === 'false';
    const autoExpand = !userCollapsed && ((stateKey === 'conflict' && !isQueued) || stateKey === 'active' || (stateKey === 'upcoming' && !isTomorrow));
    const expanded = wasExpanded || autoExpand;

    const endTime = _fmtBlockTime(block.start_minutes + block.duration_minutes);
    const durH = Math.floor(block.duration_minutes / 60);
    const durM = block.duration_minutes % 60;
    const durationLabel = durH > 0 && durM > 0 ? `${durH}h ${durM}m` : durH > 0 ? `${durH}h` : `${durM}m`;
    const metaLine = `${_fmtBlockTime(block.start_minutes)} – ${endTime} · ${durationLabel}`;

    let expandedBody, actionButtons;
    if (stateKey === 'conflict') {
        const desc = isQueued
            ? `Queued for after this session — ${metaLine}.`
            : `Planned ${metaLine}. Switch to it now${isRunning ? ', queue it,' : ''} or re-schedule.`;
        expandedBody = `<div class="cs-block-desc">${desc}</div>`;
        actionButtons = isQueued
            ? `<div class="cs-conflict-actions"><span class="cs-queued-label">After this →</span></div>`
            : `<div class="cs-conflict-actions">
                <button class="cs-switch-btn">Switch</button>
                ${isRunning ? '<button class="cs-after-btn">After this →</button>' : ''}
                <button class="cs-reschedule-btn">Re-schedule</button>
               </div>`;
    } else {
        const desc = isTomorrow
            ? `Planned tomorrow · ${metaLine}.`
            : isQueued
                ? `Queued for after this session — ${metaLine}.`
                : `Planned ${metaLine}. Start it${isRunning ? ', queue it,' : ''} or re-schedule.`;
        expandedBody = `<div class="cs-block-desc">${desc}</div>`;
        actionButtons = isTomorrow
            ? ''
            : isQueued
                ? `<div class="cs-conflict-actions"><span class="cs-queued-label">After this →</span></div>`
                : `<div class="cs-conflict-actions">
                    <button class="cs-start-btn" data-focus-id="${block.focus_area_id}">${isRunning ? 'Switch' : 'Start'}</button>
                    ${isRunning ? '<button class="cs-after-btn">After this →</button>' : ''}
                    <button class="cs-reschedule-btn">Re-schedule</button>
                   </div>`;
    }

    blockRow.dataset.expanded = expanded ? 'true' : 'false';
    blockRow.innerHTML = `
        <div class="cs-block-collapsed">
            <span class="cs-block-dot" style="background:${color}"></span>
            <span class="cs-block-label">${label}</span>
            <button class="cs-expand-btn" aria-label="${expanded ? 'Collapse' : 'Expand'}"><i class="ph ph-caret-${expanded ? 'up' : 'down'}"></i></button>
        </div>
        <div class="cs-block-expanded"${expanded ? '' : ' hidden'}>
            ${expandedBody}
            ${block.notes ? `<div class="cs-block-notes">${block.notes}</div>` : ''}
            ${actionButtons}
        </div>
    `;

    blockRow.querySelector('.cs-block-collapsed').addEventListener('click', (e) => {
        if (e.target.closest('.cs-expand-btn') || e.target.closest('.cs-start-btn') ||
            e.target.closest('.cs-switch-btn') || e.target.closest('.cs-after-btn')) return;
        blockRow.dataset.expanded = expanded ? 'false' : 'true';
        renderUpcomingBlockStrip();
    });
    blockRow.querySelector('.cs-expand-btn')?.addEventListener('click', () => {
        blockRow.dataset.expanded = expanded ? 'false' : 'true';
        renderUpcomingBlockStrip();
    });
    blockRow.querySelector('.cs-start-btn')?.addEventListener('click', () => {
        if (state.timerState.mode === 'work' && state.timerState.isRunning) {
            saveSession();
            checkAchievements();
        }
        timer.stop();
        state.timerState.activeTaskId = block.focus_area_id;
        state.timerState.queuedTaskId = null;
        timer.applyMode('work');
        timer.start();
        refreshUI();
    });
    blockRow.querySelector('.cs-switch-btn')?.addEventListener('click', () => {
        // Save elapsed effort from current work session before switching
        if (state.timerState.mode === 'work' && state.timerState.isRunning) {
            saveSession();
            checkAchievements();
        }
        timer.stop();
        state.timerState.activeTaskId = block.focus_area_id;
        state.timerState.queuedTaskId = null;
        timer.applyMode('work');
        timer.start();
        refreshUI();
    });
    blockRow.querySelector('.cs-after-btn')?.addEventListener('click', () => {
        state.timerState.queuedTaskId = block.focus_area_id;
        saveData();
        renderUpcomingBlockStrip();
    });
    blockRow.querySelector('.cs-reschedule-btn')?.addEventListener('click', () => {
        window.openPlannerToReschedule?.(block.id);
    });
}

async function checkBlockReminders() {
    if (!dbManager.initialized) return;

    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    try {
        const blocks = await dbManager.getPlannedBlocksForWeek(dateStr, dateStr);
        if (!blocks || blocks.length === 0) return;

        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();

        const reminderMins = state.settings.blockReminderMinutes ?? 10;
        if (!reminderMins || reminderMins <= 0) return;

        for (const b of blocks) {
            if (b.reminder_sent) continue;

            const triggerTime = b.start_minutes - reminderMins;
            
            // Trigger if we are in the window between triggerTime and startTime
            if (currentMinutes >= triggerTime && currentMinutes < b.start_minutes) {
                console.log(`[Reminder] !!! TRIGGERING !!! for "${b.area_name}" (Start: ${b.start_minutes}, Now: ${currentMinutes})`);
                
                const timeStr = reminderMins >= 60 ? `${reminderMins/60}h` : `${reminderMins}m`;
                const title = `Upcoming: ${b.area_name || 'Session'}`;
                const body = `${timeStr} until your planned session${b.notes ? ': ' + b.notes : ''}.`;
                
                // 1. System Notification — store focus area so clicking notification pre-selects it
                sessionStorage.setItem('pendingFocusAreaId', b.focus_area_id);
                await SettingsService.sendNotification(title, body);

                // 2. Sound
                timer.playNotificationSound();

                // 3. In-app Toast
                notify(`Reminder: ${title} in ${timeStr}`, 'milestone');

                // 4. Mark as sent in DB
                await dbManager.setPlannedBlockReminderSent(b.id);
            }
        }
    } catch (e) {
        console.error('[Reminder] Error checking reminders:', e);
    }
    renderUpcomingBlockStrip();
}

// --- 2. TIMER LOGIC ---

function toggleTimer() {
    if (state.timerState.isRunning) {
        timer.stop();
    } else {
        // If timer is at 0:00, it means a session just finished. 
        // Reset to the current mode's duration before starting.
        if (state.timerState.remainingTime <= 0) {
            timer.applyMode(state.timerState.mode);
        }
        timer.start();
    }
    refreshUI();
}

function resetTimer() {
    timer.stop();
    timer.applyMode(state.timerState.mode);
    refreshUI();
    NotificationService.notifyAction('TIMER_RESET');
}

function handleSessionComplete(isSkip = false) {
    // Stop any active timer worker first to prevent race conditions or overwriting state
    timer.stop();

    const activeTask = state.tasks.find(t => t.id === state.timerState.activeTaskId);
    const finishTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: state.settings.use12Hour });
    
    // Save session BEFORE updating timer state to 0:00 to ensure we catch the actual time spent
    if (state.timerState.mode === 'work' && !isSkip) {
        saveSession();
        checkAchievements();
    }

    const { wasWork, nextMode, sessionCount, cycleStation } = TimerService.handleSessionEnd(isSkip);
    
    mutations.updateTimer({
        mode: nextMode,
        sessionCount,
        cycleStation,
        isRunning: false,
        remainingTime: isSkip ? TimerService.getModeDuration(nextMode) * 60 : 0, 
        lastSessionFinishedAt: !isSkip ? finishTime : null,
        lastSessionTaskName: !isSkip && wasWork ? (activeTask ? activeTask.name : 'Focus Area') : null
    });

    if (!isSkip) {
        const title = wasWork ? 'Focus Session Finished!' : 'Break Finished!';
        const body = wasWork ? 'Time for a break!' : 'Ready to focus?';
        SettingsService.sendNotification(title, body);

        // Apply queued focus area after a work session completes
        let hadQueue = false;
        if (wasWork && state.timerState.queuedTaskId) {
            state.timerState.activeTaskId = state.timerState.queuedTaskId;
            state.timerState.queuedTaskId = null;
            hadQueue = true;
        }

        const shouldAutoStart = hadQueue || (wasWork ? state.settings.autoStartBreaks : state.settings.autoStartWork);
        if (shouldAutoStart) {
            timer.applyMode(nextMode);
            timer.start();
        }
    }

    refreshUI();
    saveData();
}

function saveSession() {
    const activeTask = state.tasks.find(t => t.id === state.timerState.activeTaskId);
    
    // Use actual time elapsed
    const duration = state.timerState.totalTime - Math.max(0, state.timerState.remainingTime);
    if (duration <= 0) return; // Don't save empty sessions

    const now = new Date().toISOString();
    const session = {
        id: uuidv7(),
        taskId: activeTask ? activeTask.id : null,
        taskName: activeTask ? activeTask.name : 'Uncategorized Session',
        taskCategory: activeTask ? activeTask.category : 'Uncategorized',
        taskColor: activeTask ? activeTask.color : '#94a3b8', // Slate-400 for uncategorized
        duration: duration,
        timestamp: now,
        created_at: now,
        updated_at: now,
        xp: Math.floor(duration / 60)
    };

    state.sessions.unshift(session);
    FocusService.addXP(session.xp);
    
    if (dbManager.initialized) {
        console.log('[saveSession] inserting session:', session);
        dbManager.insertSession(session)
            .then(async () => {
                console.log('[saveSession] saved:', session.id);
                if (!session.taskId) return;
                const today = new Date().toISOString().split('T')[0];
                const block = await dbManager.getUnwalkedBlockForSession(session.taskId, today);
                if (block) {
                    console.log('[walkPlannedBlock] walking block:', block.id, 'with session:', session.id);
                    await dbManager.walkPlannedBlock(block.id, session.id);
                    if (block.pathName) {
                        notify(`Path "${block.pathName}" — block walked!`);
                    }
                    renderUpcomingBlockStrip();
                }
            })
            .catch(e => console.error('Failed to save session:', e));
    }

    saveData();
}

// --- 3. DOMAIN ACTIONS ---

function renderFocusAreas() {
    FocusView.renderFocusAreas({
        onPlay: (task) => {
            if (state.timerState.activeTaskId === task.id) toggleTimer();
            else { state.timerState.activeTaskId = task.id; timer.stop(); timer.applyMode('work'); timer.start(); }
            renderFocusAreas(); closeFocusAreas();
        },
        onEdit: (task) => openFocusAreaEditModal(task),
        onToggleComplete: (id) => toggleFocusAreaComplete(id),
        onDelete: (id) => deleteFocusArea(id),
        onEditCategory: (name) => openCategoryEditModal(name),
        onDeleteCategory: (name) => deleteCategory(name),
        onMoveToCategory: (taskId, newCat) => moveTaskToCategory(taskId, newCat),
        onStateChange: () => saveData()
    });
}

async function addFocusArea() {
    const btn = document.getElementById('addFocusAreaBtn');
    const textSpan = document.getElementById('addFocusAreaBtnText');
    const originalText = textSpan ? textSpan.textContent : 'Create';
    const originalIcon = btn.querySelector('svg')?.outerHTML || '';
    
    try {
        const input = document.getElementById('focusAreaInput');
        const name = input.value.trim();
        if (!name) return notify('Enter focus area name');
        
        btn.disabled = true;
        btn.classList.add('loading');
        const actionText = editingTaskId ? 'Saving...' : 'Creating...';
        btn.innerHTML = `<svg class="spinner" width="14" height="14" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"><path d="M216,128a88,88,0,1,1-42.69-75.69"></path></svg><span>${actionText}</span>`;

        const catSelect = document.getElementById('focusAreaCategorySelect');
        let cat = catSelect.value;

        if (cat === '__new__') {
            const newName = document.getElementById('newCategoryNameInput').value.trim();
            const newIcon = document.getElementById('newCategoryIconInput').value.trim() || '📁';
            if (!newName) {
                btn.disabled = false;
                btn.classList.remove('loading');
                btn.innerHTML = `${originalIcon}<span id="addFocusAreaBtnText">${originalText}</span>`;
                return notify('Enter new category name');
            }
            
            if (!state.categories.find(c => c.name.toLowerCase() === newName.toLowerCase())) {
                state.categories.push({ id: uuidv7(), name: newName, icon: newIcon });
                FocusView.populateCategorySelects();
            }
            cat = newName;
            
            document.getElementById('newCategoryWrapper').style.display = 'none';
            document.getElementById('newCategoryNameInput').value = '';
            document.getElementById('newCategoryIconInput').value = '📁';
            document.getElementById('selectedIconDisplay').textContent = '📁';
        }
        
        const isEdit = !!editingTaskId;
        const task = isEdit 
            ? await FocusService.updateFocusArea(editingTaskId, { name, category: cat, color: state.selectedTaskColor })
            : await FocusService.addFocusArea(name, cat, state.selectedTaskColor);
        
        if (task) {
            input.value = '';

            const active = state.tasks.filter(t => !(t.completed === true || t.completed === 1 || t.completed === 'true'));
            const grouped = active.reduce((acc, t) => {
                const c = t.category || 'Uncategorized';
                if (!acc[c]) acc[c] = [];
                acc[c].push(t);
                return acc;
            }, {});

            const order = state.categories.map(c => c.name);
            const activeCats = Object.keys(grouped).sort((a, b) => {
                const ia = order.indexOf(a), ib = order.indexOf(b);
                return (ia !== -1 && ib !== -1) ? ia - ib : (ia !== -1 ? -1 : (ib !== -1 ? 1 : a.localeCompare(b)));
            });

            state.activeCategoryIndex = activeCats.indexOf(task.category || 'Uncategorized');

            await saveData();
            
            const wrapper = document.getElementById('focusAreaCreateWrapper');
            wrapper?.classList.remove('open');
            const toggleBtn = document.getElementById('toggleFocusAreaCreate');
            if (toggleBtn) toggleBtn.classList.remove('active');
            
            editingTaskId = null;

            renderFocusAreas();
            if (!isEdit && task.category) FocusView.drillInto(task.category);
        }
    } catch (e) {
        console.error('Failed to add/update focus area:', e);
        notify('Error saving focus area');
    } finally {
        btn.disabled = false;
        btn.classList.remove('loading');
        btn.innerHTML = `${originalIcon}<span id="addFocusAreaBtnText">${originalText}</span>`;
    }
}

async function toggleFocusAreaComplete(id) {
    const success = await FocusService.toggleComplete(id);
    if (success) {
        const t = state.tasks.find(x => x.id === id);
        if (t.completed && state.timerState.activeTaskId === id) state.timerState.activeTaskId = null;
        saveData(); renderFocusAreas();
    }
}

function deleteFocusArea(id) {
    confirmAction('Delete focus area?', 'delete').then(async (conf) => {
        if (conf) { 
            const success = await FocusService.deleteFocusArea(id);
            if (success) {
                saveData(); renderFocusAreas(); 
            }
        }
    });
}

function deleteSession(id) {
    confirmAction('Delete session record?', 'delete').then(async (conf) => {
        if (conf) {
            state.sessions = state.sessions.filter(s => s.id !== id);
            if (dbManager.initialized) { console.log('[deleteSession]', id); await dbManager.deleteSession(id); }
            saveData(); refreshUI();
            NotificationService.notifyAction('SESSION_DELETED');
        }
    });
}

function renderPlan() {
    FocusView.renderPlan({
        onEditAim: (id) => editAim(id),
        onGoAgain: (a) => goAgain(a),
        onDeleteAim: (id) => {
            state.aims = state.aims.filter(x => x.id !== id);
            if (dbManager.initialized) { console.log('[deleteAim]', id); dbManager.deleteAim(id); }
            saveData(); renderPlan(); 
            NotificationService.notifyAction('AIM_REMOVED');
        },
        onShare: (name, mins) => SettingsService.handleShare('x', 'milestone', { focusArea: name, duration: mins }, notify)
    });
}

function addAim() {
    const raw = document.getElementById('aimDurationInput').value.trim();
    const mins = FocusView.parseDuration(raw);
    if (!mins || state.selectedFocusAreaIds.length === 0) return notify('Select area and duration');
    
    const type = document.getElementById('aimDeadlineSelect').value;
    let date = null;
    if (type !== 'infinite') {
        const d = new Date();
        if (type === 'today') date = HistoryService.getLogicalDate();
        else if (type === 'tomorrow') { d.setDate(d.getDate()+1); date = HistoryService.getLogicalDate(d); }
        else if (type === 'week') { d.setDate(d.getDate() + (7 - d.getDay()) % 7); date = HistoryService.getLogicalDate(d); }
        else if (type === 'custom') date = document.getElementById('aimCustomDate').value;
    }

    const now = new Date().toISOString();
    state.selectedFocusAreaIds.forEach(id => {
        const ex = FocusView.getActiveAimForFocusArea(id);
        if (ex) { 
            ex.targetMinutes = mins; 
            ex.deadline = date; 
            ex.updated_at = now;
            if (dbManager.initialized) { console.log('[insertAim] updating:', ex); dbManager.insertAim(ex).catch(e => console.error('Failed to save aim:', e)); }
        } else {
            const newAim = { 
                id: uuidv7(), 
                focusAreaId: id, 
                targetMinutes: mins, 
                createdAt: now, 
                created_at: now,
                updated_at: now,
                deadline: date 
            };
            state.aims.push(newAim);
            if (dbManager.initialized) { console.log('[insertAim] new:', newAim); dbManager.insertAim(newAim).catch(e => console.error('Failed to save aim:', e)); }
        }
    });

    state.selectedFocusAreaIds = []; 
    updateCustomSelectUI();
    const wrapper = document.getElementById('planCreateWrapper');
    if (wrapper) {
        wrapper.classList.remove('open');
        const btn = document.getElementById('togglePlanCreate');
        if (btn) btn.classList.remove('active');
    }
    renderPlan(); renderFocusAreas(); 
    NotificationService.notifyAction('AIM_ADDED');
    saveData();
}

function editAim(id) {
    const aim = state.aims.find(a => a.id === id);
    if (!aim) return;
    
    state.selectedFocusAreaIds = [aim.focusAreaId];
    updateCustomSelectUI();
    
    document.getElementById('aimDurationInput').value = aim.targetMinutes;
    if (aim.deadline) {
        document.getElementById('aimDeadlineSelect').value = 'custom';
        const customDateInput = document.getElementById('aimCustomDate');
        if (customDateInput) {
            customDateInput.value = aim.deadline;
            customDateInput.style.display = 'block';
        }
    } else {
        document.getElementById('aimDeadlineSelect').value = 'infinite';
    }
    
    const wrapper = document.getElementById('planCreateWrapper');
    if (wrapper) {
        wrapper.classList.add('open');
        document.getElementById('togglePlanCreate')?.classList.add('active');
    }
}

function goAgain(aim) {
    const now = new Date().toISOString();
    const newAim = {
        ...aim,
        id: uuidv7(),
        createdAt: now,
        created_at: now,
        updated_at: now
    };
    state.aims.push(newAim);
    saveData();
    renderPlan();
    NotificationService.notifyAction('AIM_RENEWED');
}

function populateCustomFocusAreaSelect() {
    const container = document.getElementById('selectOptions');
    const noResults = document.getElementById('selectNoResults');
    if (!container) return;
    
    container.innerHTML = '';
    const activeTasks = state.tasks.filter(t => !t.completed);
    
    if (activeTasks.length === 0) {
        noResults.style.display = 'block';
        return;
    }
    
    noResults.style.display = 'none';
    activeTasks.forEach(task => {
        const item = document.createElement('div');
        item.className = 'select-option';
        if (state.selectedFocusAreaIds.includes(task.id)) item.classList.add('selected');
        
        item.innerHTML = `
            <div class="option-color" style="background: ${task.color}"></div>
            <div class="option-info">
                <div class="option-name">${task.name}</div>
                <div class="option-meta">${task.category || 'Uncategorized'}</div>
            </div>
            <div class="option-check">
                <svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L104,194.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"></path></svg>
            </div>
        `;
        
        item.onclick = () => {
            const idx = state.selectedFocusAreaIds.indexOf(task.id);
            if (idx === -1) state.selectedFocusAreaIds.push(task.id);
            else state.selectedFocusAreaIds.splice(idx, 1);
            
            item.classList.toggle('selected');
            updateCustomSelectUI();
            
            // Auto-close on selection to avoid covering the form
            document.getElementById('selectDropdown')?.classList.remove('open');
        };
        
        container.appendChild(item);
    });
}

function updateCustomSelectUI() {
    const badge = document.getElementById('selectedCountBadge');
    const count = state.selectedFocusAreaIds.length;
    
    if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'flex' : 'none';
    }
    
    const triggerText = document.querySelector('#selectTrigger span:not(.selected-count-badge)');
    if (triggerText) {
        if (count === 0) triggerText.textContent = 'Select Focus Areas...';
        else if (count === 1) {
            const task = state.tasks.find(t => t.id === state.selectedFocusAreaIds[0]);
            triggerText.textContent = task ? task.name : '1 Area Selected';
        } else {
            triggerText.textContent = `${count} Areas Selected`;
        }
    }
}

// --- 4. NAVIGATION & MODALS ---

function openFocusAreas() { 
    FocusView.goBack();
    document.getElementById('focusAreaPanel').classList.add('open'); 
    document.getElementById('focusAreaOverlay').classList.add('open'); 
}
function closeFocusAreas() {
    document.getElementById('focusAreaPanel').classList.remove('open');
    document.getElementById('focusAreaOverlay').classList.remove('open');
    document.getElementById('focusAreaCreateWrapper')?.classList.remove('open');
    document.getElementById('toggleFocusAreaCreate')?.classList.remove('active');
    // Reset mobile bottom nav to Timer when panel is dismissed
    if (window.innerWidth <= 480) {
        document.querySelectorAll('.mobile-tab').forEach(t => t.classList.remove('active'));
        document.getElementById('mobile-tab-timer')?.classList.add('active');
    }
}
window.openFocusAreas = openFocusAreas;
window.closeFocusAreas = closeFocusAreas;

function openPlan() {
    closeFocusAreas(); populateCustomFocusAreaSelect();
    document.getElementById('planPanel').classList.add('open'); document.getElementById('planOverlay').classList.add('open'); 
}
function closePlan() { 
    document.getElementById('planPanel').classList.remove('open'); 
    document.getElementById('planOverlay').classList.remove('open'); 
    document.getElementById('planCreateWrapper')?.classList.remove('open');
    document.getElementById('togglePlanCreate')?.classList.remove('active');
}

function openProfile() { closeFocusAreas(); closePlan(); renderAchievements(); document.getElementById('profilePanel').classList.add('open'); document.getElementById('settingsOverlay').classList.add('open'); }
function closeProfile() { 
    document.getElementById('profilePanel').classList.remove('open'); 
    document.getElementById('settingsOverlay').classList.remove('open'); 
    togglePersonaEdit(false);
}

function togglePersonaEdit(isEditing) {
    const slider = document.getElementById('identitySlider');
    slider?.classList.toggle('editing', isEditing);
}

function updatePersona(avatar, mood) {
    state.avatar = avatar;
    updateProfileUI();
    togglePersonaEdit(false);
    saveData();
    NotificationService.notifyAction('PERSONA_CHANGED', { avatar, mood });
}

function updateProfileUI() {
    const avatar = state.avatar || '🦉';
    const circle = document.getElementById('personaCircle');
    const moodLabel = document.getElementById('currentMoodLabel');

    if (circle) circle.textContent = avatar;
    const sidenavAvatar = document.getElementById('sidenavAvatar');
    if (sidenavAvatar) sidenavAvatar.textContent = avatar;
    const mobileAvatar = document.getElementById('mobileAvatar');
    if (mobileAvatar) mobileAvatar.textContent = avatar;

    const option = document.querySelector(`.avatar-option[data-avatar="${avatar}"]`);
    if (option && moodLabel) {
        const name = option.querySelector('.avatar-mood')?.textContent || option.title;
        moodLabel.textContent = name;
        const sidenavUserName = document.getElementById('sidenavUserName');
        if (sidenavUserName) sidenavUserName.textContent = name;
    }
}

function _buildHourOptions(selectEl, currentVal) {
    if (selectEl.options.length === 0) {
        for (let h = 0; h < 24; h++) {
            const opt = document.createElement('option');
            opt.value = h;
            const ampm = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
            opt.textContent = ampm;
            selectEl.appendChild(opt);
        }
    }
    selectEl.value = currentVal;
}

function openSettings() {
    closeFocusAreas(); closePlan();
    const p = document.getElementById('settingsPanel'); const o = document.getElementById('settingsOverlay');
    p.classList.add('open'); o.classList.add('open');

    // Reset to first tab (Timer)
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('.settings-tab[data-tab="timer"]')?.classList.add('active');
    document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'));
    document.getElementById('tab-timer')?.classList.add('active');

    document.getElementById('workDuration').value = state.settings.workDuration;
    document.getElementById('workDurationValue').textContent = `${state.settings.workDuration} min`;
    document.getElementById('shortBreakDuration').value = state.settings.shortBreakDuration;
    document.getElementById('longBreakDuration').value = state.settings.longBreakDuration;

    // Initialize toggles
    const toggles = {
        'autoStartBreaks': state.settings.autoStartBreaks,
        'autoStartWork': state.settings.autoStartWork,
        'timeFormat': state.settings.use12Hour
    };
    Object.entries(toggles).forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.toggle('active', !!val);
            el.setAttribute('aria-checked', !!val);
        }
    });

    _buildHourOptions(document.getElementById('activeHoursStart'), state.settings.activeHoursStart ?? 8);
    _buildHourOptions(document.getElementById('activeHoursEnd'), state.settings.activeHoursEnd ?? 22);

    // Update labels on input
    ['workDuration', 'shortBreakDuration', 'longBreakDuration'].forEach(id => {
        const input = document.getElementById(id);
        const label = document.getElementById(`${id}Value`);
        if (input && label) {
            input.oninput = () => { label.textContent = `${input.value} min`; };
        }
    });
    const volInput = document.getElementById('soundVolume');
    const volLabel = document.getElementById('soundVolumeValue');
    if (volInput && volLabel) {
        volInput.oninput = () => { volLabel.textContent = `${volInput.value}%`; };
    }

    const reminderSelect = document.getElementById('blockReminderMinutes');
    if (reminderSelect) reminderSelect.value = String(state.settings.blockReminderMinutes ?? 10);

    const variant = state.settings.cardVariant || 'glass';
    document.querySelectorAll('#cardVariantSelect .filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.variant === variant);
    });
}

function toggleOrbit() {
    const orbit = document.getElementById('durationOrbit');
    const container = orbit?.closest('.timer-container');
    if (orbit) {
        const isOpen = orbit.classList.toggle('open');
        container?.classList.toggle('orbit-open', isOpen);
    }
}

function closeOrbit() {
    const orbit = document.getElementById('durationOrbit');
    const container = orbit?.closest('.timer-container');
    orbit?.classList.remove('open');
    container?.classList.remove('orbit-open');
}

function setDurationFromOrbit(mins) {
    const mode = state.timerState.mode;
    const wasRunning = state.timerState.isRunning;
    const oldTotal = state.timerState.totalTime;
    const newTotal = mins * 60;
    const diff = newTotal - oldTotal;

    // Update settings for future sessions
    if (mode === 'work') mutations.updateSettings({ workDuration: mins });
    else if (mode === 'shortBreak') mutations.updateSettings({ shortBreakDuration: mins });
    else mutations.updateSettings({ longBreakDuration: mins });
    
    // Adjust current session without losing progress
    const newRemaining = Math.max(0, state.timerState.remainingTime + diff);
    mutations.updateTimer({ 
        totalTime: newTotal,
        remainingTime: newRemaining
    });

    // Recalculate background worker target if running
    if (wasRunning) timer.start();
    
    saveData();
    refreshUI();
}

function adjustDuration(delta) {
    const mode = state.timerState.mode;
    const wasRunning = state.timerState.isRunning;
    const oldTotal = state.timerState.totalTime;
    let current;
    
    if (mode === 'work') current = state.settings.workDuration;
    else if (mode === 'shortBreak') current = state.settings.shortBreakDuration;
    else current = state.settings.longBreakDuration;

    const next = Math.max(1, current + delta);
    const newTotal = next * 60;
    const diff = newTotal - oldTotal;

    if (mode === 'work') mutations.updateSettings({ workDuration: next });
    else if (mode === 'shortBreak') mutations.updateSettings({ shortBreakDuration: next });
    else mutations.updateSettings({ longBreakDuration: next });
    
    // Adjust current session without losing progress
    const newRemaining = Math.max(0, state.timerState.remainingTime + diff);
    mutations.updateTimer({ 
        totalTime: newTotal,
        remainingTime: newRemaining
    });

    if (wasRunning) timer.start();
    
    saveData();
    refreshUI();
}

function closeSettings() {
    const activeVariantBtn = document.querySelector('#cardVariantSelect .filter-btn.active');
    SettingsService.updateSettings({
        workDuration: parseInt(document.getElementById('workDuration').value),
        shortBreakDuration: parseInt(document.getElementById('shortBreakDuration').value),
        longBreakDuration: parseInt(document.getElementById('longBreakDuration').value),
        sessionsBeforeLongBreak: parseInt(document.getElementById('sessionsBeforeLongBreak').value),
        autoStartBreaks: document.getElementById('autoStartBreaks')?.classList.contains('active'),
        autoStartWork: document.getElementById('autoStartWork')?.classList.contains('active'),
        use12Hour: document.getElementById('timeFormat')?.classList.contains('active'),
        activeHoursStart: parseInt(document.getElementById('activeHoursStart').value),
        activeHoursEnd: parseInt(document.getElementById('activeHoursEnd').value),
        cardVariant: activeVariantBtn ? activeVariantBtn.dataset.variant : 'glass',
        soundVolume: parseInt(document.getElementById('soundVolume').value),
        blockReminderMinutes: parseInt(document.getElementById('blockReminderMinutes')?.value ?? 10)
    });
    document.getElementById('settingsPanel').classList.remove('open'); document.getElementById('settingsOverlay').classList.remove('open');
    saveData();
    timer.applyMode(state.timerState.mode); // Re-apply timer mode with new durations
    refreshUI();
    NotificationService.notifyAction('SETTINGS_SAVED');
}

function openSessionEditModal(s) {
    editingSessionId = s.id;
    document.getElementById('sessionEditFocusAreaName').textContent = s.taskName;
    document.getElementById('sessionEditDuration').value = Math.round(s.duration / 60);
    document.getElementById('sessionEditModal').classList.add('open');
}

function saveSessionFromModal() {
    const mins = parseInt(document.getElementById('sessionEditDuration').value);
    const s = state.sessions.find(x => x.id === editingSessionId);
    if (s && mins > 0) {
        s.duration = mins * 60; saveData(); refreshUI();
        NotificationService.notifyAction('SESSION_UPDATED');
    }
    document.getElementById('sessionEditModal').classList.remove('open');
}

function openFocusAreaEditModal(t) {
    editingTaskId = t.id;
    
    // Go back to the first drawer where the creation form is
    FocusView.goBack();
    
    document.getElementById('focusAreaInput').value = t.name;
    FocusView.populateCategorySelects();
    document.getElementById('focusAreaCategorySelect').value = t.category || 'Uncategorized';
    
    state.selectedTaskColor = t.color || '#58a6ff';
    const circle = document.getElementById('selectedColorCircle');
    if (circle) circle.style.background = state.selectedTaskColor;
    
    const header = document.getElementById('faCreateHeader');
    if (header) header.textContent = 'Edit Focus Area';
    const btnText = document.getElementById('addFocusAreaBtnText');
    if (btnText) btnText.textContent = 'Update';
    
    const wrapper = document.getElementById('focusAreaCreateWrapper');
    if (wrapper) {
        wrapper.classList.add('open');
        const toggleBtn = document.getElementById('toggleFocusAreaCreate');
        if (toggleBtn) toggleBtn.classList.add('active');
        document.getElementById('focusAreaInput')?.focus();
    }
}

let editingCategoryName = null;
function openCategoryEditModal(name) {
    editingCategoryName = name;
    const cat = state.categories.find(c => c.name === name);
    if (!cat) return;

    document.getElementById('categoryEditName').value = cat.name;
    document.getElementById('categoryEditIconDisplay').textContent = cat.icon;
    document.getElementById('categoryEditIconInput').value = cat.icon;
    
    const dropdown = document.getElementById('categoryEditIconDropdown');
    const icons = ["🎓", "💼", "💪", "🏠", "🎨", "🧪", "📚", "🚀", "🧠", "🎯", "💻", "📈", "🔧", "🧹", "🛒"];
    if (dropdown) {
        dropdown.innerHTML = icons.map(i => `<button type="button" class="icon-dot" data-icon="${i}">${i}</button>`).join('');

        dropdown.querySelectorAll('.icon-dot').forEach(btn => {
            btn.onclick = () => {
                const icon = btn.dataset.icon;
                document.getElementById('categoryEditIconDisplay').textContent = icon;
                document.getElementById('categoryEditIconInput').value = icon;
                dropdown.classList.remove('open');
            };
        });
    }
    document.getElementById('categoryEditModal').classList.add('open');
}

function saveCategoryFromModal() {
    const newName = document.getElementById('categoryEditName').value.trim();
    const newIcon = document.getElementById('categoryEditIconInput').value;
    if (!newName) return notify('Category name cannot be empty');

    const cat = state.categories.find(c => c.name === editingCategoryName);
    if (cat) {
        state.tasks.forEach(t => {
            if (t.category === editingCategoryName) t.category = newName;
        });
        cat.name = newName;
        cat.icon = newIcon;

        saveData();
        refreshUI();
        FocusView.populateCategorySelects();
        NotificationService.notifyAction('CATEGORY_UPDATED', { name: newName });
    }
    document.getElementById('categoryEditModal').classList.remove('open');
}

function deleteCategory(name) {
    confirmAction(`Delete category "${name}"? Focus areas will be moved to Uncategorized.`, 'delete').then(conf => {
        if (conf) {
            state.categories = state.categories.filter(c => c.name !== name);
            state.tasks.forEach(t => {
                if (t.category === name) t.category = 'Uncategorized';
            });
            saveData();
            refreshUI();
            FocusView.populateCategorySelects();
            NotificationService.notifyAction('CATEGORY_DELETED', { name });
        }
    });
}

function moveTaskToCategory(taskId, newCat) {
    const t = state.tasks.find(x => x.id === taskId);
    if (t) {
        t.category = newCat;
        t.updated_at = new Date().toISOString();
        if (dbManager.initialized) dbManager.insertFocusArea(t);
        saveData();
        refreshUI();
        NotificationService.notifyAction('MOVED_TO_CATEGORY', { name: newCat });
    }
}

// --- 5. PERSISTENCE & SYSTEM ---

function saveData() {
    if (dbManager.initialized) {
        // console.log('[saveData] persisting full state');
        dbManager.saveFullState(state).catch(e => console.error('Failed to save to DB:', e));
    }
}
window.saveData = saveData; // Expose for NotificationView

function updateDateTime() {
    const el = document.getElementById('datetime'); if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: state.settings.use12Hour });
}

function notify(msg, type = '') {
    if (notificationView) {
        notificationView.add(msg, type);
    } else {
        const toast = document.createElement('div');
        toast.className = `toast show ${type}`;
        toast.innerHTML = `
            <div class="toast-content">${msg}</div>
            <div class="toast-progress-container">
                <div class="toast-progress"></div>
            </div>
        `;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    }
}
function confirmAction(msg, actionType = 'confirm') {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        const messageEl = document.getElementById('confirmMessage');
        const okBtn = document.getElementById('confirmOk');
        const cancelBtn = document.getElementById('confirmCancel');

        if (!modal || !messageEl || !okBtn || !cancelBtn) {
            resolve(confirm(msg));
            return;
        }

        messageEl.textContent = msg;
        
        // Update button text based on action type
        if (actionType === 'delete') {
            okBtn.innerHTML = '<i class="ph ph-trash"></i> Delete';
            okBtn.classList.add('btn-danger');
            okBtn.classList.remove('btn-primary');
        } else {
            okBtn.textContent = 'Confirm';
            okBtn.classList.remove('btn-danger');
            okBtn.classList.add('btn-primary');
        }
        
        modal.classList.add('open');

        const cleanup = (val) => {
            modal.classList.remove('open');
            okBtn.onclick = null;
            cancelBtn.onclick = null;
            resolve(val);
        };

        okBtn.onclick = () => cleanup(true);
        cancelBtn.onclick = () => cleanup(false);

        modal.onclick = (e) => {
            if (e.target === modal) cleanup(false);
        };
    });
}

function formatTimestamp(ts) {
    const d = new Date(ts);
    const now = new Date();
    
    // Check if the timestamp is from today (not when page loaded, but actual date comparison)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // If timestamp is between today 00:00 and tomorrow 00:00, show "Today"
    if (d >= today && d < tomorrow) {
        return `Today, ${timeStr}`;
    }
    
    // Check if yesterday
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d >= yesterday && d < today) {
        return `Yesterday, ${timeStr}`;
    }
    
    // For older dates, show date and time
    const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `${dateStr}, ${timeStr}`;
}

// Schedule UI refresh at midnight to update timestamps
function scheduleMidnightRefresh() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const msUntilMidnight = tomorrow - now;
    
    setTimeout(() => {
        // Re-render history with updated timestamps
        DashboardView.renderHistory(currentFilter, {
            sort: historySort,
            category: historyCategory,
            page: historyPage,
            pageSize: HISTORY_PAGE_SIZE,
            callbacks: { formatTimestamp, onDelete: deleteSession, onEdit: openSessionEditModal }
        });
        // Schedule next midnight refresh
        scheduleMidnightRefresh();
    }, msUntilMidnight);
}

function checkAchievements() {
    ACHIEVEMENTS.forEach(ach => {
        if (state.unlockedAchievements.includes(ach.id)) return;
        if (ach.check(state)) {
            state.unlockedAchievements.push(ach.id);
            notify(`ACHIEVEMENT: ${ach.title} 🏆`);
            saveData();
        }
    });
}

function renderAchievements() {
    const grid = document.getElementById('achievementsGrid');
    if (!grid) return;
    grid.innerHTML = '';
    
    ACHIEVEMENTS.forEach(ach => {
        const isUnlocked = state.unlockedAchievements.includes(ach.id);
        const badge = document.createElement('div');
        badge.className = `achievement-badge ${isUnlocked ? 'unlocked' : 'locked'}`;
        badge.innerHTML = `
            <div class="ach-icon">${isUnlocked ? ach.icon : '🔒'}</div>
            <div class="ach-info">
                <div class="ach-title">${ach.title}</div>
                <div class="ach-desc">${ach.desc}</div>
            </div>
        `;
        grid.appendChild(badge);
    });
}

function restoreTimerState() {
    if (state.timerState.isRunning && state.timerState.targetEndTime) {
        const diff = state.timerState.targetEndTime - Date.now();
        if (diff > 0) { state.timerState.remainingTime = Math.ceil(diff / 1000); timer.start(); }
        else { handleSessionComplete(); }
    } else { timer.applyMode(state.timerState.mode); }
    TimerView.updateDisplay();
}

// --- 6. EVENT LISTENERS ---

function setupEventListeners() {
    const clickMap = {
        'startPauseBtn': toggleTimer,
        'resetBtn': resetTimer,
        'skipBtn': () => handleSessionComplete(true),
        'themeToggle': () => SettingsService.toggleTheme(),
        'addFocusAreaBtn': addFocusArea,
        'toggleTaskPanelManagement': (e) => {
            const panel = document.getElementById('faTaskPanel');
            const isManagement = panel?.classList.toggle('management-mode');
            const btn = e.currentTarget;
            btn.classList.toggle('active', isManagement);
            
            if (isManagement) {
                btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L104,194.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"></path></svg>';
            } else {
                btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM192,108,148,64l24-24,44,44Zm-101,96H48V160l88-88,44,44Z"></path></svg>';
            }
            refreshUI();
        },
        'inlineColorBtn': () => document.getElementById('inlineColorDropdown')?.classList.toggle('open'),
        'inlineIconBtn': () => document.getElementById('inlineIconDropdown')?.classList.toggle('open'),
        'selectTrigger': () => document.getElementById('selectDropdown')?.classList.toggle('open'),
        'manualRefreshBtn': () => { state.lastRefreshTime = Date.now(); refreshUI(); },
        'sidenav-logout-btn': async (e) => {
            e.stopPropagation();
            await supabase.auth.signOut();
            showAuthOverlay();
        },
        'settingsBtn': openSettings, 'sidenavSettingsBtn': openSettings, 'mobileSettingsBtn': openSettings, 'closeSettings': closeSettings,
        'saveSettings': closeSettings,
        'sidenav-user-profile': () => document.getElementById('profilePanel').classList.contains('open') ? closeProfile() : openProfile(), 'closeProfile': closeProfile,
        'mobileAvatarBtn': () => document.getElementById('profilePanel').classList.contains('open') ? closeProfile() : openProfile(),
        'editPersonaBtn': () => togglePersonaEdit(true),
        'cancelPersonaEdit': () => togglePersonaEdit(false),
        'shareMoodBtn': () => {
            const avatar = state.avatar || '🦉';
            const mood = document.getElementById('currentMoodLabel')?.textContent || 'Sage';
            SettingsService.handleShare('x', 'mood', { avatar, mood }, notify);
        },
        'focusAreasNavBtn': () => openFocusAreas(),
        'sidenavFocusAreasBtn': () => openFocusAreas(),
        'closeFocusAreaPanel': closeFocusAreas,
        'focusPlannerNavBtn': () => PlannerView.open(),
        'sidenavFocusPlannerBtn': () => PlannerView.open(),
        'planNavBtn': () => openPlan(),
        'sidenavFocusPlanBtn': () => openPlan(),
        'closePlanPanel': closePlan,
        'addAimBtn': addAim,
        'toggleTaskCreate': () => {
            const category = FocusView.activeCategory;
            FocusView.goBack();
            editingTaskId = null;
            const wrapper = document.getElementById('focusAreaCreateWrapper');
            wrapper?.classList.add('open');
            const btn = document.getElementById('toggleFocusAreaCreate');
            if (btn) btn.classList.add('active');
            const header = document.getElementById('faCreateHeader');
            if (header) header.textContent = 'Create Focus Area';
            const btnText = document.getElementById('addFocusAreaBtnText');
            if (btnText) btnText.textContent = 'Create';
            document.getElementById('focusAreaInput').value = '';
            FocusView.populateCategorySelects();
            if (category) {
                const sel = document.getElementById('focusAreaCategorySelect');
                if (sel) sel.value = category;
            }
            document.getElementById('focusAreaInput')?.focus();
        },
        'toggleFocusAreaCreate': (e) => {
            const wrapper = document.getElementById('focusAreaCreateWrapper');
            const isOpen = wrapper?.classList.toggle('open');
            const btn = document.getElementById('toggleFocusAreaCreate');
            if (btn) btn.classList.toggle('active', isOpen);
            if (isOpen) {
                editingTaskId = null;
                const header = document.getElementById('faCreateHeader');
                if (header) header.textContent = 'Create Focus Area';
                const btnText = document.getElementById('addFocusAreaBtnText');
                if (btnText) btnText.textContent = 'Create';
                document.getElementById('focusAreaInput').value = '';
                
                FocusView.populateCategorySelects();
                document.getElementById('focusAreaInput')?.focus();
            }
        },
        'cancelFocusAreaCreate': () => {
            const wrapper = document.getElementById('focusAreaCreateWrapper');
            wrapper?.classList.remove('open');
            const btn = document.getElementById('toggleFocusAreaCreate');
            if (btn) btn.classList.remove('active');
            editingTaskId = null;
        },
        'togglePlanCreate': (e) => {
            const wrapper = document.getElementById('planCreateWrapper');
            const isOpen = wrapper?.classList.toggle('open');
            const btn = document.getElementById('togglePlanCreate');
            if (btn) btn.classList.toggle('active', isOpen);
            if (isOpen) {
                // Reset form when opening
                state.selectedFocusAreaIds = [];
                updateCustomSelectUI();
                document.getElementById('aimDurationInput').value = '';
                document.getElementById('aimDeadlineSelect').value = 'infinite';
                const customDate = document.getElementById('aimCustomDate');
                if (customDate) customDate.style.display = 'none';
                populateCustomFocusAreaSelect();
            }
        },
        'cancelPlanCreate': () => {
            const wrapper = document.getElementById('planCreateWrapper');
            wrapper?.classList.remove('open');
            const btn = document.getElementById('togglePlanCreate');
            if (btn) btn.classList.remove('active');
            state.selectedFocusAreaIds = [];
            updateCustomSelectUI();
        },
        'requestNotifyManual': () => {
            console.log('[Settings] requestNotifyManual clicked');
            if (!("Notification" in window)) {
                notify("Notifications not supported", "error");
                return;
            }
            notify("Requesting permission...");
            Notification.requestPermission().then(permission => {
                console.log('[Settings] Permission result:', permission);
                notify(`Notifications: ${permission}`);
                if (permission === 'granted') {
                    SettingsService.sendNotification("PomoFlow", "Notifications enabled! 🎯");
                }
            }).catch(err => {
                console.error('[Settings] Permission error:', err);
                notify("Permission request failed", "error");
            });
        },
        'testNotify': () => {
            console.log('[Settings] testNotify clicked');
            if (Notification.permission !== 'granted') {
                notify("Please enable notifications first", "warning");
            }
            SettingsService.sendNotification("Test Notification", "It works! 🎯", true);
        },
        'testSound': () => {
            console.log('[Settings] testSound clicked');
            timer.playNotificationSound();
        },
        'categoryEditIconBtn': () => document.getElementById('categoryEditIconDropdown')?.classList.toggle('open'),
        'saveCategoryEdit': saveCategoryFromModal,
        'cancelCategoryEdit': () => document.getElementById('categoryEditModal').classList.remove('open'),
        'closeCategoryEdit': () => document.getElementById('categoryEditModal').classList.remove('open'),
        'saveSessionEdit': saveSessionFromModal, 'cancelSessionEdit': () => document.getElementById('sessionEditModal').classList.remove('open'),
        'closeSessionEdit': () => document.getElementById('sessionEditModal').classList.remove('open'),
        'shareXBtn': () => SettingsService.handleShare('x', 'intent', {}, notify),
        'shareCopyBtn': () => SettingsService.handleShare('copy', 'intent', {}, notify),
        'shareFocusBtn': () => {
            document.querySelector('.expand-group')?.classList.toggle('open');
        },
        'durationToggle': toggleOrbit,
        'incDuration': () => adjustDuration(1),
        'decDuration': () => adjustDuration(-1),
        'focusAreaLink': openFocusAreas,
        'clearFocusArea': (e) => { e.stopPropagation(); mutations.updateTimer({ activeTaskId: null }); refreshUI(); saveData(); },
        'focusAreaOverlay': closeFocusAreas, 'planOverlay': closePlan,
        'historyPrevPage': () => { if (historyPage > 0) { historyPage--; refreshUI(); } },
        'historyNextPage': () => { historyPage++; refreshUI(); },
        'historySortBtn':  () => { historySort = historySort === 'newest' ? 'oldest' : 'newest'; historyPage = 0; refreshUI(); },
    };

    Object.entries(clickMap).forEach(([id, fn]) => {
        const el = document.getElementById(id);
        if (el) el.onclick = fn;
    });

    // Today / Week / All time-period buttons
    document.querySelectorAll('.history-filters .filter-btn').forEach(btn => {
        btn.onclick = () => {
            currentFilter = btn.dataset.filter;
            historyPage = 0;
            historyCategory = null;
            document.querySelectorAll('.history-filters .filter-btn')
                .forEach(b => b.classList.toggle('active', b === btn));
            refreshUI();
        };
    });

    // Category filter dropdown
    document.getElementById('historyCategoryFilter')?.addEventListener('change', e => {
        historyCategory = e.target.value || null;
        historyPage = 0;
        refreshUI();
    });

    // Orbit option buttons
    document.querySelectorAll('.orbiter.option[data-mins]').forEach(btn => {
        btn.onclick = () => {
            const mins = parseInt(btn.dataset.mins);
            if (mins) setDurationFromOrbit(mins);
            closeOrbit();
        };
    });

    // Settings tabs switching
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.onclick = () => {
            const target = tab.dataset.tab;
            document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'));
            document.getElementById(`tab-${target}`)?.classList.add('active');
        };
    });

    // Settings toggles
    document.querySelectorAll('.setting-toggle').forEach(toggle => {
        toggle.onclick = () => {
            const isActive = toggle.classList.toggle('active');
            toggle.setAttribute('aria-checked', isActive);
        };
    });

    // Avatar selection
    document.querySelectorAll('.avatar-option').forEach(btn => {
        btn.onclick = () => {
            const avatar = btn.dataset.avatar;
            const mood = btn.querySelector('.avatar-mood')?.textContent || btn.title;
            updatePersona(avatar, mood);
        };
    });

    // Global click listener to close dropdowns/menus when clicking outside
    document.addEventListener('click', (e) => {
        // Close share menu
        const shareGroup = document.querySelector('.expand-group');
        if (shareGroup?.classList.contains('open') && !shareGroup.contains(e.target)) {
            shareGroup.classList.remove('open');
        }

        // Close orbit menu
        const orbit = document.getElementById('durationOrbit');
        if (orbit?.classList.contains('open') && !orbit.contains(e.target)) {
            closeOrbit();
        }

        // Close focus area select dropdown
        const selectDropdown = document.getElementById('selectDropdown');
        const selectTrigger = document.getElementById('selectTrigger');
        if (selectDropdown?.classList.contains('open') && !selectDropdown.contains(e.target) && !selectTrigger?.contains(e.target)) {
            selectDropdown.classList.remove('open');
        }
    });

    document.getElementById('focusAreaCategorySelect')?.addEventListener('change', (e) => {
        const wrapper = document.getElementById('newCategoryWrapper');
        if (wrapper) wrapper.style.display = e.target.value === '__new__' ? 'flex' : 'none';
        if (e.target.value === '__new__') document.getElementById('newCategoryNameInput')?.focus();
    });

    document.getElementById('focusAreaSearchInput')?.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        let visible = 0;
        document.querySelectorAll('#selectOptions .select-option').forEach(opt => {
            const name = opt.querySelector('.option-name').textContent.toLowerCase();
            const cat = opt.querySelector('.option-meta').textContent.toLowerCase();
            const match = name.includes(q) || cat.includes(q);
            opt.style.display = match ? 'flex' : 'none';
            if (match) visible++;
        });
        const noResults = document.getElementById('selectNoResults');
        if (noResults) noResults.style.display = visible === 0 ? 'block' : 'none';
    });

    document.getElementById('aimDeadlineSelect')?.addEventListener('change', (e) => {
        const customDate = document.getElementById('aimCustomDate');
        if (customDate) customDate.style.display = e.target.value === 'custom' ? 'block' : 'none';
    });

    document.querySelectorAll('#inlineIconDropdown .icon-dot').forEach(dot => {
        dot.onclick = (e) => {
            e.stopPropagation();
            const icon = dot.dataset.icon;
            const display = document.getElementById('selectedIconDisplay');
            const hidden = document.getElementById('newCategoryIconInput');
            if (display) display.textContent = icon;
            if (hidden) hidden.value = icon;
            document.getElementById('inlineIconDropdown')?.classList.remove('open');
        };
    });

    document.querySelectorAll('#inlineColorDropdown .color-dot').forEach(dot => {
        dot.onclick = (e) => {
            e.stopPropagation();
            const color = dot.dataset.color;
            state.selectedTaskColor = color;
            const circle = document.getElementById('selectedColorCircle');
            if (circle) circle.style.background = color;
            document.querySelectorAll('#inlineColorDropdown .color-dot').forEach(d => d.classList.remove('active'));
            dot.classList.add('active');
            document.getElementById('inlineColorDropdown')?.classList.remove('open');
        };
    });
}

function refreshUI() {
    renderFocusAreas();
    DashboardView.updateStats();
    DashboardView.renderHistory(currentFilter, {
        sort: historySort,
        category: historyCategory,
        page: historyPage,
        pageSize: HISTORY_PAGE_SIZE,
        callbacks: { formatTimestamp, onDelete: deleteSession, onEdit: openSessionEditModal }
    });
    renderPlan();
    TimerView.updateDisplay();
    FocusView.updateLevelUI();
    updateProfileUI();
    renderUpcomingBlockStrip();
}

// ── Auth UI ───────────────────────────────────────────────────────────────────

function showAuthOverlay() {
    const overlay = document.getElementById('authOverlay');
    if (overlay) overlay.style.display = 'flex';

    // Wire up auth form (idempotent — safe to call multiple times)
    const btn = document.getElementById('authSubmitBtn');
    const input = document.getElementById('authEmail');
    const errorEl = document.getElementById('authError');

    async function sendMagicLink() {
        const email = input?.value.trim();
        if (!email) return;
        btn.disabled = true;
        btn.textContent = 'Sending…';
        errorEl.style.display = 'none';

        const { error } = await supabase.auth.signInWithOtp({
            email,
            options: { emailRedirectTo: window.location.origin + window.location.pathname }
        });

        if (error) {
            errorEl.textContent = error.message;
            errorEl.style.display = 'block';
            btn.disabled = false;
            btn.textContent = 'Send magic link';
        } else {
            document.getElementById('authForm').style.display = 'none';
            document.getElementById('authConfirm').style.display = 'block';
            document.getElementById('authConfirmEmail').textContent = email;
        }
    }

    // Google OAuth
    document.getElementById('authGoogleBtn')?.addEventListener('click', async () => {
        await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: window.location.origin + window.location.pathname }
        });
    });

    btn?.addEventListener('click', sendMagicLink);
    input?.addEventListener('keydown', e => { if (e.key === 'Enter') sendMagicLink(); });
    document.getElementById('authResendBtn')?.addEventListener('click', () => {
        document.getElementById('authForm').style.display = 'block';
        document.getElementById('authConfirm').style.display = 'none';
        btn.disabled = false;
        btn.textContent = 'Send magic link';
    });
}

function hideAuthOverlay() {
    const overlay = document.getElementById('authOverlay');
    if (overlay) overlay.style.display = 'none';
}

// Handle SIGNED_IN on first page load (e.g. user clicked magic link)
supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session) {
        hideAuthOverlay();
        // If init() returned early due to no session, run it now
        if (!dbManager.initialized) init();
    }
    if (event === 'SIGNED_OUT') showAuthOverlay();
});

// Re-render history when crossing mobile/desktop breakpoint
let wasMobile = window.innerWidth <= 768;
window.addEventListener('resize', () => {
    const isMobile = window.innerWidth <= 768;
    if (isMobile !== wasMobile) {
        wasMobile = isMobile;
        // Re-render history with current filters
        DashboardView.renderHistory(currentFilter, {
            sort: historySort,
            category: historyCategory,
            page: historyPage,
            pageSize: HISTORY_PAGE_SIZE,
            callbacks: { formatTimestamp, onDelete: deleteSession, onEdit: openSessionEditModal }
        });
    }
});

(async () => { await init(); })();
