/**
 * PomoFlow Database Manager
 * UI-side API for interacting with the SQLite worker.
 */

class DatabaseManager {
    constructor() {
        this.requests = new Map();
        this.requestIdCounter = 0;
        this.initialized = false;
        this.disabled = false;

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
                payload: { purge: false },
                requestId: 'initial-init' 
            });

        } catch (e) {
            console.warn('Web Workers not available. SQLite disabled.', e);
            this.disabled = true;
            this.initPromise = Promise.resolve(false);
        }
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
            id: area.id,
            name: area.name,
            color: area.color,
            category: area.category,
            is_active: isCompleted ? 0 : 1
        }); 
    }
    async deleteFocusArea(id) { return this._send('delete_focus_area', { id }); }
    async insertSession(session) { return this._send('insert_session', session); }
    async insertAim(aim) { return this._send('insert_aim', aim); }
    async setSetting(key, value) { return this._send('set_setting', { key, value: JSON.stringify(value) }); }
    async setUserProfile(key, value) { return this._send('set_user_profile', { key, value: JSON.stringify(value) }); }
    async setAppState(key, value) { return this._send('set_app_state', { key, value: JSON.stringify(value) }); }

    async getAllFocusAreas() { 
        const rows = await this._send('get_all_focus_areas');
        if (!rows) return [];
        return rows.map(r => {
            // is_active = 1 or true means ACTIVE (not completed)
            // Anything else (0, null, false) is treated as COMPLETED
            const isActive = (r.is_active === 1 || r.is_active === '1' || r.is_active === true || r.is_active === 'true');
            return {
                id: r.id,
                name: r.name,
                color: r.color,
                category: r.category || 'Uncategorized',
                completed: !isActive,
                createdAt: r.created_at
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
            duration: s.duration_seconds,
            xp: s.xp_earned
        }));
    }
    async getAllAims() { return this._send('get_all_aims'); }
    
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
        
        const [tasks, sessions, aims, settings, profile, appState] = await Promise.all([
            this.getAllFocusAreas(),
            this.getAllSessions(),
            this.getAllAims(),
            this.getAllSettings(),
            this.getUserProfile(),
            this.getAppState()
        ]);

        return {
            tasks: tasks || [],
            sessions: sessions || [],
            aims: aims || [],
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

        // Save Tasks
        for (const task of state.tasks) {
            await this.insertFocusArea(task);
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

        // Save App State (Theme, UI, Timer, Categories)
        await this.setAppState('timer_state', state.timerState);
        await this.setAppState('categories', state.categories);
        await this.setAppState('ui_state', {
            selectedTaskColor: state.selectedTaskColor,
            selectedFocusAreaIds: state.selectedFocusAreaIds
        });
    }

    async migrateFromLocalStorage(state) {
        console.log('Starting FINAL migration to SQLite...');
        
        // Migrate Tasks
        for (const task of state.tasks) { await this.insertFocusArea(task); }
        // Migrate Sessions
        for (const session of state.sessions) { await this.insertSession(session); }
        // Migrate Aims
        for (const aim of state.aims) { await this.insertAim(aim); }
        // Migrate Settings
        for (const [key, value] of Object.entries(state.settings)) { await this.setSetting(key, value); }
        
        // Migrate Profile & Meta
        await this.setUserProfile('full_profile', {
            xp: state.xp,
            totalXp: state.totalXp,
            level: state.level,
            avatar: state.avatar,
            unlockedAchievements: state.unlockedAchievements,
            collapsedCategories: state.collapsedCategories,
            activeCategoryIndex: state.activeCategoryIndex
        });

        await this.setAppState('theme', localStorage.getItem('flowtracker_theme') || 'dark');
        await this.setAppState('notification_prompt', localStorage.getItem('flowtracker_notification_prompt') || 'default');
        await this.setAppState('categories', state.categories);
        
        await this.setAppState('ui_state', {
            lastSessionId: state.lastSessionId,
            lastTaskId: state.lastTaskId,
            selectedTaskColor: state.selectedTaskColor,
            editTaskColor: state.editTaskColor,
            selectedFocusAreaIds: state.selectedFocusAreaIds
        });

        await this.setAppState('migrated', true);

        console.log('Migration to SQLite complete!');
    }
}

export const dbManager = new DatabaseManager();
