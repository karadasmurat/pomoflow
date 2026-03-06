/**
 * PomoFlow SQLite Worker
 * Handles all database operations off the main thread using OPFS.
 */

// Use the local SQLite WASM distribution (now moved to the same directory as the worker)
const SQLITE_WASM_URL = 'sqlite3.js';

let db = null;
let sqlite3 = null;

async function init() {
    try {
        // Load the SQLite3 loader script
        importScripts(SQLITE_WASM_URL);
        
        // Initialize SQLite3
        sqlite3 = await sqlite3InitModule({
            print: console.log,
            printErr: console.error,
        });
        
        // Check for OPFS support (requires cross-origin isolation)
        if (sqlite3.opfs) {
            // If we are migrating, we might want to clear existing broken DB
            if (!localStorage.getItem('flowtracker_sqlite_migrated')) {
                try { await sqlite3.opfs.unlink('/pomoflow.db'); } catch(e) {}
            }
            db = new sqlite3.oo1.OpfsDb('/pomoflow.db');
            console.log('SQLite OPFS Database initialized:', db.filename);
        } else {
            db = new sqlite3.oo1.DB('/pomoflow.db', 'ct');
            console.warn('OPFS support not found in sqlite3 object, falling back to transient/memory storage');
        }

        // Create Tables
        db.exec(`
            CREATE TABLE IF NOT EXISTS focus_areas (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT DEFAULT '#58a6ff',
                category TEXT DEFAULT 'Uncategorized',
                is_active INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS aims (
                id TEXT PRIMARY KEY,
                focus_area_id TEXT NOT NULL,
                target_minutes INTEGER NOT NULL,
                target_date DATE NOT NULL,
                is_completed INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (focus_area_id) REFERENCES focus_areas(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                focus_area_id TEXT,
                duration_seconds INTEGER NOT NULL,
                xp_earned INTEGER DEFAULT 0,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                note TEXT,
                FOREIGN KEY (focus_area_id) REFERENCES focus_areas(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_profile (
                key TEXT PRIMARY KEY,
                value TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_timestamp ON sessions(timestamp);
            CREATE INDEX IF NOT EXISTS idx_sessions_area ON sessions(focus_area_id);
            CREATE INDEX IF NOT EXISTS idx_aims_date ON aims(target_date);
        `);

        return true;
    } catch (err) {
        console.error('Failed to initialize SQLite:', err);
        return false;
    }
}

self.onmessage = async (e) => {
    const { action, payload, requestId } = e.data;

    if (action === 'init') {
        const success = await init();
        self.postMessage({ action: 'init_result', success, requestId });
        return;
    }

    if (!db) {
        self.postMessage({ action: 'error', error: 'Database not initialized', requestId });
        return;
    }

    try {
        let result = null;
        switch (action) {
            case 'exec':
                result = db.exec(payload.sql, { returnValue: 'resultRows', bind: payload.bind });
                break;
            case 'insert_focus_area':
                db.exec("INSERT OR REPLACE INTO focus_areas (id, name, color, category, is_active) VALUES (?, ?, ?, ?, ?)", {
                    bind: [payload.id, payload.name, payload.color, payload.category, payload.is_active ? 1 : 0]
                });
                break;
            case 'insert_session':
                db.exec("INSERT OR REPLACE INTO sessions (id, focus_area_id, duration_seconds, xp_earned, timestamp) VALUES (?, ?, ?, ?, ?)", {
                    bind: [payload.id, payload.taskId, payload.duration, payload.xp || 0, payload.timestamp]
                });
                break;
            case 'insert_aim':
                db.exec("INSERT OR REPLACE INTO aims (id, focus_area_id, target_minutes, target_date, is_completed) VALUES (?, ?, ?, ?, ?)", {
                    bind: [payload.id, payload.goalId, payload.targetMinutes, payload.date, payload.is_completed ? 1 : 0]
                });
                break;
            case 'set_setting':
                db.exec("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", {
                    bind: [payload.key, payload.value]
                });
                break;
            case 'get_all_focus_areas':
                result = db.exec("SELECT * FROM focus_areas", { returnValue: 'resultRows', rowMode: 'object' });
                break;
            case 'get_all_sessions':
                result = db.exec("SELECT * FROM sessions ORDER BY timestamp DESC", { returnValue: 'resultRows', rowMode: 'object' });
                break;
            case 'get_all_aims':
                result = db.exec("SELECT * FROM aims", { returnValue: 'resultRows', rowMode: 'object' });
                break;
            case 'get_all_settings':
                result = db.exec("SELECT * FROM settings", { returnValue: 'resultRows', rowMode: 'object' });
                break;
        }
        self.postMessage({ action: 'success', result, requestId });
    } catch (err) {
        self.postMessage({ action: 'error', error: err.message, requestId });
    }
};
