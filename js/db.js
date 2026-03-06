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
            // Cache bust the worker for testing
            this.worker = new Worker('js/db-worker.js?v=' + Date.now());
            this.worker.onmessage = (e) => {
                const { action, success, result, error, requestId } = e.data;
                
                if (action === 'init_result') {
                    this.initialized = success;
                }

                if (this.requests.has(requestId)) {
                    const { resolve, reject } = this.requests.get(requestId);
                    this.requests.delete(requestId);
                    if (error) reject(new Error(error));
                    else resolve(result);
                }
            };
        } catch (e) {
            console.warn('Web Workers not available (likely file:// origin). SQLite disabled.', e);
            this.disabled = true;
        }
    }

    async init() {
        if (this.disabled) return false;
        const needsMigration = !localStorage.getItem('flowtracker_sqlite_migrated');
        return this._send('init', { purge: needsMigration });
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
    async insertFocusArea(area) { return this._send('insert_focus_area', area); }
    async insertSession(session) { return this._send('insert_session', session); }
    async insertAim(aim) { return this._send('insert_aim', aim); }
    async setSetting(key, value) { return this._send('set_setting', { key, value: JSON.stringify(value) }); }

    async getAllFocusAreas() { return this._send('get_all_focus_areas'); }
    async getAllSessions() { 
        const rows = await this._send('get_all_sessions');
        if (!rows) return [];
        return rows.map(s => ({
            ...s,
            taskId: s.focus_area_id,
            duration: s.duration_seconds,
            xp: s.xp_earned
        }));
    }
    async getAllAims() { return this._send('get_all_aims'); }
    async getAllSettings() { 
        const rows = await this._send('get_all_settings');
        const settings = {};
        if (rows) {
            rows.forEach(row => {
                try { settings[row.key] = JSON.parse(row.value); }
                catch (e) { settings[row.key] = row.value; }
            });
        }
        return settings;
    }

    async getFullState() {
        if (this.disabled) return null;
        
        const [tasks, sessions, aims, settings] = await Promise.all([
            this.getAllFocusAreas(),
            this.getAllSessions(),
            this.getAllAims(),
            this.getAllSettings()
        ]);

        return {
            tasks: tasks || [],
            sessions: sessions || [],
            aims: aims || [],
            settings: Object.keys(settings).length > 0 ? settings : null
        };
    }

    async migrateFromLocalStorage(state) {
        console.log('Starting migration to SQLite...');
        
        // Migrate Tasks
        for (const task of state.tasks) {
            await this.insertFocusArea(task);
        }

        // Migrate Sessions
        for (const session of state.sessions) {
            await this.insertSession(session);
        }

        // Migrate Aims
        for (const aim of state.aims) {
            await this.insertAim(aim);
        }

        // Migrate Settings
        for (const [key, value] of Object.entries(state.settings)) {
            await this.setSetting(key, value);
        }

        // Mark as migrated
        localStorage.setItem('flowtracker_sqlite_migrated', 'true');
        console.log('Migration to SQLite complete!');
    }
}

const dbManager = new DatabaseManager();
