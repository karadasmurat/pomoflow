/**
 * PomoFlow Database Manager
 * UI-side API for interacting with the SQLite worker.
 */

import { uuidv7 } from './utils/uuid.js';

class DatabaseManager {
    constructor() {
        this.requests = new Map();
        this.requestIdCounter = 0;
        this.initialized = false;
        this.disabled = false;
        this.deviceId = this._getOrCreateDeviceId();

        try {
            this.worker = new Worker(new URL('./db-worker.js', import.meta.url));

            // Create a promise that resolves when the worker is initialized
            this.initPromise = new Promise((resolve) => {
                this.worker.onmessage = (e) => {
                    const { action, success, result, error, requestId } = e.data;

                    if (action === 'init_result') {
                        this.initialized = success;
                        resolve(success);
                    }

                    if (this.requests.has(requestId)) {
                        const { resolve: reqResolve, reject } = this.requests.get(requestId);
                        this.requests.delete(requestId);
                        if (error) reject(new Error(error));
                        else reqResolve(result);
                    }
                };
            });

            // Trigger actual initialization - NEVER purge automatically anymore
            this.worker.postMessage({
                action: 'init',
                payload: { purge: false, deviceId: this.deviceId },
                requestId: 'initial-init'
            });

        } catch (e) {
            console.warn('Web Workers not available. SQLite disabled.', e);
            this.disabled = true;
            this.initPromise = Promise.resolve(false);
        }
    }

    _getOrCreateDeviceId() {
        const key = 'pf_device_id';
        let id = localStorage.getItem(key);
        if (!id) {
            id = crypto.randomUUID();
            localStorage.setItem(key, id);
        }
        return id;
    }

    async init() {
        return this.initPromise;
    }

    async _send(action, payload = {}) {
        if (this.disabled) return Promise.resolve(null);
        return new Promise((resolve, reject) => {
            const requestId = this.requestIdCounter++;
            this.requests.set(requestId, { resolve, reject });
            this.worker.postMessage({ action, payload, requestId });
        });
    }

    // High-level API
    async insertFocusArea(area) {
        // Force is_active to 1 (Active) unless explicitly completed
        const isCompleted = (area.completed === true || area.completed === 1 || area.completed === 'true');
        return this._send('insert_focus_area', {
            id: area.id || uuidv7(),
            name: area.name,
            color: area.color,
            category: area.category,
            is_active: isCompleted ? 0 : 1,
            created_at: area.created_at || area.createdAt,
            updated_at: area.updated_at,
            skipSync: area.skipSync ?? false,
        });
    }
    async deleteFocusArea(id) { return this._send('delete_focus_area', { id }); }
    
    async insertSession(session) {
        return this._send('insert_session', {
            ...session,
            id: session.id || uuidv7(),
            created_at: session.created_at || session.timestamp,
            updated_at: session.updated_at,
            skipSync: session.skipSync ?? false,
        });
    }
    async deleteSession(id) { return this._send('delete_session', { id }); }
    async deleteSessionsBefore(before) { return this._send('delete_sessions_before', { before }); }
    async deleteSessionsFrom(after)    { return this._send('delete_sessions_from',   { after });  }

    async insertAim(aim) {
        return this._send('insert_aim', {
            ...aim,
            id: aim.id || uuidv7(),
            created_at: aim.created_at || aim.createdAt,
            updated_at: aim.updated_at,
            skipSync: aim.skipSync ?? false,
        });
    }
    async deleteAim(id) { return this._send('delete_aim', { id }); }

    async insertPlannedBlock(block) {
        return this._send('insert_planned_block', {
            id: block.id || uuidv7(),
            focusAreaId: block.focusAreaId,
            plannedDate: block.plannedDate,
            startMinutes: block.startMinutes,
            durationMinutes: block.durationMinutes,
            notes: block.notes || null,
            pathId: block.pathId || null,
            reminderMinutes: block.reminderMinutes || null,
            reminderSent: block.reminderSent || 0,
            skipSync: block.skipSync ?? false,
        });
    }
    async deletePlannedBlock(id) { return this._send('delete_planned_block', { id }); }
    async walkPlannedBlock(blockId, sessionId) {
        return this._send('walk_planned_block', { blockId, sessionId });
    }
    async setPlannedBlockReminderSent(id) {
        return this._send('update_planned_block_reminder_sent', { id });
    }
    async getPlannedBlocksForWeek(startDate, endDate) {
        const rows = await this._send('get_planned_blocks_for_week', { startDate, endDate });
        return rows || [];
    }
    async getUpcomingBlocksForToday(date, tomorrow) {
        const rows = await this._send('get_upcoming_blocks_for_today', { date, tomorrow });
        return rows || [];
    }
    async getSessionsForWeek(startDate, endDate) {
        const rows = await this._send('get_sessions_for_week', { startDate, endDate });
        return rows || [];
    }

    async insertPath(path) {
        return this._send('insert_path', {
            id: path.id || uuidv7(),
            name: path.name,
            description: path.description || null,
            color: path.color || '#3D8F5A',
            deadline: path.deadline || null,
            status: path.status || 'active',
            skipSync: path.skipSync ?? false,
        });
    }
    async archivePath(id) { return this._send('archive_path', { id }); }
    async deletePath(id) { return this._send('delete_path', { id }); }
    async getAllPaths() {
        const rows = await this._send('get_all_paths');
        if (!rows) return [];
        return rows.map(p => ({
            id: p.id,
            name: p.name,
            description: p.description,
            color: p.color || '#3D8F5A',
            deadline: p.deadline,
            status: p.status || 'active',
            totalPlanned: p.total_planned || 0,
            totalWalked: p.total_walked || 0,
            createdAt: p.created_at,
            updatedAt: p.updated_at
        }));
    }
    async getUnwalkedBlockForSession(focusAreaId, date) {
        const rows = await this._send('get_unwalked_block_for_session', { focusAreaId, date });
        if (!rows || rows.length === 0) return null;
        const r = rows[0];
        return {
            id: r.id,
            pathId: r.path_id,
            pathName: r.path_name,
            pathColor: r.path_color,
            totalPlanned: r.total_planned || 0,
            totalWalked: r.total_walked || 0
        };
    }

    async getPendingSyncLog() {
        const rows = await this._send('get_pending_sync_log');
        return rows || [];
    }
    async markSynced(ids) {
        if (!ids || ids.length === 0) return;
        return this._send('mark_synced', { ids });
    }

    async setSetting(key, value) {
        return this._send('set_setting', { 
            id: uuidv7(), // New record for this key (ON CONFLICT will update)
            key, 
            value: JSON.stringify(value) 
        }); 
    }
    
    async setUserProfile(key, value) { 
        return this._send('set_user_profile', { 
            id: uuidv7(), 
            key, 
            value: JSON.stringify(value) 
        }); 
    }
    
    async setAppState(key, value) { 
        return this._send('set_app_state', { 
            id: uuidv7(), 
            key, 
            value: JSON.stringify(value) 
        }); 
    }

    async getAllFocusAreas() { 
        const rows = await this._send('get_all_focus_areas');
        if (!rows) return [];
        return rows.map(r => {
            const isActive = (r.is_active === 1 || r.is_active === '1' || r.is_active === true || r.is_active === 'true');
            return {
                id: r.id,
                name: r.name,
                color: r.color,
                category: r.category || 'Uncategorized',
                completed: !isActive,
                createdAt: r.created_at,
                updatedAt: r.updated_at
            };
        });
    }
    async getAllSessions() { 
        const rows = await this._send('get_all_sessions');
        if (!rows) return [];
        return rows.map(s => ({
            ...s,
            taskId: s.focus_area_id,
            taskName: s.display_name,
            taskColor: s.display_color,
            taskCategory: s.task_category || null,
            duration: s.duration_seconds,
            xp: s.xp_earned,
            createdAt: s.created_at,
            updatedAt: s.updated_at
        }));
    }
    async getAllAims() { 
        const rows = await this._send('get_all_aims');
        if (!rows) return [];
        return rows.map(a => ({
            id: a.id,
            focusAreaId: a.focus_area_id,
            targetMinutes: a.target_minutes,
            deadline: a.target_date,
            completed: a.is_completed === 1 || a.is_completed === '1' || a.is_completed === true || a.is_completed === 'true',
            createdAt: a.created_at,
            updatedAt: a.updated_at
        }));
    }

    
    async _getKVTable(action) {
        const rows = await this._send(action);
        const data = {};
        if (rows) {
            rows.forEach(row => {
                try { data[row.key] = JSON.parse(row.value); }
                catch (e) { data[row.key] = row.value; }
            });
        }
        return data;
    }

    async getAllSettings() { return this._getKVTable('get_all_settings'); }
    async getUserProfile() { return this._getKVTable('get_all_user_profile'); }
    async getAppState() { return this._getKVTable('get_all_app_state'); }

    async getFullState() {
        if (this.disabled) return null;
        
        const [tasks, sessions, aims, settings, profile, appState, paths, notifications] = await Promise.all([
            this.getAllFocusAreas(),
            this.getAllSessions(),
            this.getAllAims(),
            this.getAllSettings(),
            this.getUserProfile(),
            this.getAppState(),
            this.getAllPaths(),
            this.getAllNotifications()
        ]);

        return {
            tasks: tasks || [],
            sessions: sessions || [],
            aims: aims || [],
            paths: paths || [],
            notifications: notifications || [],
            settings: Object.keys(settings).length > 0 ? settings : null,
            profile: Object.keys(profile).length > 0 ? profile : null,
            appState: Object.keys(appState).length > 0 ? appState : null
        };
    }

    async saveFullState(state) {
        if (this.disabled || !this.initialized) return;
        
        // Save Settings
        for (const [key, value] of Object.entries(state.settings)) {
            await this.setSetting(key, value);
        }

        // Save Profile
        await this.setUserProfile('full_profile', {
            xp: state.xp,
            totalXp: state.totalXp,
            level: state.level,
            avatar: state.avatar,
            unlockedAchievements: state.unlockedAchievements,
            collapsedCategories: state.collapsedCategories,
            activeCategoryIndex: state.activeCategoryIndex
        });

        // Save App State (Theme, UI, Timer, Categories) - Notifications handled individually now
        await this.setAppState('timer_state', state.timerState);
        await this.setAppState('categories', state.categories);
        await this.setAppState('ui_state', {
            selectedTaskColor: state.selectedTaskColor,
            selectedFocusAreaIds: state.selectedFocusAreaIds
        });
    }

    async insertNotification(n) {
        return this._send('insert_notification', {
            id: n.id || uuidv7(),
            message: n.msg || n.message,
            type: n.type || 'info',
            is_read: n.read ? 1 : 0,
            is_deleted: n.is_deleted ? 1 : 0,
            created_at: n.timestamp || n.created_at,
            updated_at: n.updated_at || new Date().toISOString(),
            skipSync: n.skipSync ?? false
        });
    }
    
    async deleteNotification(id) {
        return this._send('delete_notification', { id });
    }

    async markNotificationsRead() {
        return this._send('mark_notifications_read');
    }

    async clearAllNotifications() {
        return this._send('clear_all_notifications');
    }

    async getAllNotifications() {
        const rows = await this._send('get_all_notifications');
        if (!rows) return [];
        return rows.map(r => ({
            id: r.id,
            msg: r.message,
            type: r.type,
            read: r.is_read === 1,
            timestamp: r.created_at
        }));
    }
}

export const dbManager = new DatabaseManager();
