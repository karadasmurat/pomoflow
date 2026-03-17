/**
 * PomoFlow SQLite Worker
 * Handles all database operations off the main thread using OPFS.
 */

// Use the local SQLite WASM distribution (now moved to the same directory as the worker)
const SQLITE_WASM_URL = 'sqlite3.js';

let db = null;
let sqlite3 = null;

// ── SCHEMA MIGRATIONS ────────────────────────────────────────────────────────
// Each block runs only when the stored user_version is below the target.
// user_version is written at the end of each block, so a crash mid-migration
// will re-run that block on the next start (all DDL statements are idempotent
// within a block via IF NOT EXISTS where needed).
//
// Version history:
//   0 → 1  Base schema (focus_areas, sessions, aims, settings, planned_blocks, …)
//   1 → 2  Paths feature (paths table, path_id + walked_session_id on planned_blocks)
//   2 → 3  Repair: ensure path_id + walked_session_id exist (transition detector bug)
//   3 → 4  Outbox: sync_log table for cross-device sync
//   4 → 5  Fix: transition detector was stamping CURRENT_SCHEMA_VERSION (4) directly,
//           skipping sync_log creation. Re-create idempotently for affected databases.

const CURRENT_SCHEMA_VERSION = 5;

function migrate(db) {
    let version = db.exec("PRAGMA user_version", { returnValue: 'resultRows' })[0][0];

    // One-time fix for databases created before versioned migrations were introduced.
    // Those DBs have the full v2 schema but user_version was never set (stays at 0).
    // Detect by checking if the 'paths' table already exists and stamp the version.
    // One-time transition: databases created before versioned migrations have the
    // 'paths' table but user_version was never set, and some columns may be partially
    // applied. Detect, complete anything missing, then stamp the version so this
    // never runs again.
    if (version < CURRENT_SCHEMA_VERSION) {
        const tables = db.exec(
            "SELECT name FROM sqlite_master WHERE type='table'",
            { returnValue: 'resultRows', rowMode: 'object' }
        ).map(r => r.name);
        if (tables.includes('paths')) {
            const pbCols = db.exec(
                "PRAGMA table_info(planned_blocks)",
                { returnValue: 'resultRows', rowMode: 'object' }
            ).map(r => r.name);
            if (!pbCols.includes('path_id'))
                db.exec("ALTER TABLE planned_blocks ADD COLUMN path_id TEXT REFERENCES paths(id) ON DELETE SET NULL");
            if (!pbCols.includes('walked_session_id'))
                db.exec("ALTER TABLE planned_blocks ADD COLUMN walked_session_id TEXT");
            db.exec("CREATE INDEX IF NOT EXISTS idx_paths_status ON paths(status)");
            db.exec("CREATE INDEX IF NOT EXISTS idx_planned_blocks_path ON planned_blocks(path_id)");
            db.exec("CREATE TRIGGER IF NOT EXISTS trg_paths_updated_at AFTER UPDATE ON paths FOR EACH ROW BEGIN UPDATE paths SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id; END;");
            db.exec("PRAGMA user_version = 3");
            version = 3;
            console.log('Transition complete, stamped user_version = 3');
        }
    }

    console.log(`DB schema version: ${version}, target: ${CURRENT_SCHEMA_VERSION}`);
    if (version >= CURRENT_SCHEMA_VERSION) return;

    // ── v0 → v1: base schema ─────────────────────────────────────────────────
    if (version < 1) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS focus_areas (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT DEFAULT '#58a6ff',
                category TEXT DEFAULT 'Uncategorized',
                is_active INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_deleted INTEGER DEFAULT 0,
                deleted_at DATETIME
            );
            CREATE TABLE IF NOT EXISTS aims (
                id TEXT PRIMARY KEY,
                focus_area_id TEXT NOT NULL,
                target_minutes INTEGER NOT NULL,
                target_date DATE,
                is_completed INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_deleted INTEGER DEFAULT 0,
                deleted_at DATETIME,
                FOREIGN KEY (focus_area_id) REFERENCES focus_areas(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                focus_area_id TEXT,
                task_name TEXT,
                task_color TEXT,
                duration_seconds INTEGER NOT NULL,
                xp_earned INTEGER DEFAULT 0,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                note TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_deleted INTEGER DEFAULT 0,
                deleted_at DATETIME,
                FOREIGN KEY (focus_area_id) REFERENCES focus_areas(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS settings (
                id TEXT PRIMARY KEY,
                key TEXT UNIQUE NOT NULL,
                value TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_deleted INTEGER DEFAULT 0,
                deleted_at DATETIME
            );
            CREATE TABLE IF NOT EXISTS user_profile (
                id TEXT PRIMARY KEY,
                key TEXT UNIQUE NOT NULL,
                value TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_deleted INTEGER DEFAULT 0,
                deleted_at DATETIME
            );
            CREATE TABLE IF NOT EXISTS app_state (
                id TEXT PRIMARY KEY,
                key TEXT UNIQUE NOT NULL,
                value TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_deleted INTEGER DEFAULT 0,
                deleted_at DATETIME
            );
            CREATE TABLE IF NOT EXISTS planned_blocks (
                id TEXT PRIMARY KEY,
                focus_area_id TEXT NOT NULL,
                planned_date TEXT NOT NULL,
                start_minutes INTEGER NOT NULL,
                duration_minutes INTEGER NOT NULL,
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (focus_area_id) REFERENCES focus_areas(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_timestamp ON sessions(timestamp);
            CREATE INDEX IF NOT EXISTS idx_sessions_area ON sessions(focus_area_id);
            CREATE INDEX IF NOT EXISTS idx_aims_date ON aims(target_date);
            CREATE INDEX IF NOT EXISTS idx_planned_blocks_date ON planned_blocks(planned_date);
            CREATE TRIGGER IF NOT EXISTS trg_focus_areas_updated_at AFTER UPDATE ON focus_areas FOR EACH ROW BEGIN UPDATE focus_areas SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id; END;
            CREATE TRIGGER IF NOT EXISTS trg_aims_updated_at AFTER UPDATE ON aims FOR EACH ROW BEGIN UPDATE aims SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id; END;
            CREATE TRIGGER IF NOT EXISTS trg_sessions_updated_at AFTER UPDATE ON sessions FOR EACH ROW BEGIN UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id; END;
            CREATE TRIGGER IF NOT EXISTS trg_settings_updated_at AFTER UPDATE ON settings FOR EACH ROW BEGIN UPDATE settings SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id; END;
            CREATE TRIGGER IF NOT EXISTS trg_user_profile_updated_at AFTER UPDATE ON user_profile FOR EACH ROW BEGIN UPDATE user_profile SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id; END;
            CREATE TRIGGER IF NOT EXISTS trg_app_state_updated_at AFTER UPDATE ON app_state FOR EACH ROW BEGIN UPDATE app_state SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id; END;
        `);
        db.exec("PRAGMA user_version = 1");
        console.log('Migration 0→1 complete');
    }

    // ── v1 → v2: paths feature ───────────────────────────────────────────────
    if (version < 2) {
        db.exec(`
            CREATE TABLE paths (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                color TEXT DEFAULT '#3D8F5A',
                deadline TEXT,
                status TEXT DEFAULT 'active',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            ALTER TABLE planned_blocks ADD COLUMN path_id TEXT REFERENCES paths(id) ON DELETE SET NULL;
            ALTER TABLE planned_blocks ADD COLUMN walked_session_id TEXT;
            CREATE INDEX idx_paths_status ON paths(status);
            CREATE INDEX idx_planned_blocks_path ON planned_blocks(path_id);
            CREATE TRIGGER IF NOT EXISTS trg_paths_updated_at AFTER UPDATE ON paths FOR EACH ROW BEGIN UPDATE paths SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id; END;
        `);
        db.exec("PRAGMA user_version = 2");
        console.log('Migration 1→2 complete');
    }

    // ── v2 → v3: repair missing columns ──────────────────────────────────────
    // The transition detector in v2 had a bug where it stamped user_version = 2
    // without reliably adding path_id / walked_session_id. This migration checks
    // via raw array rows (avoiding the rowMode:'object' issue) and adds any
    // columns that are still missing.
    if (version < 3) {
        const existingCols = db.exec(
            "SELECT name FROM pragma_table_info('planned_blocks')",
            { returnValue: 'resultRows' }
        ).map(r => r[0]);
        if (!existingCols.includes('path_id'))
            db.exec("ALTER TABLE planned_blocks ADD COLUMN path_id TEXT REFERENCES paths(id) ON DELETE SET NULL");
        if (!existingCols.includes('walked_session_id'))
            db.exec("ALTER TABLE planned_blocks ADD COLUMN walked_session_id TEXT");
        db.exec("CREATE INDEX IF NOT EXISTS idx_planned_blocks_path ON planned_blocks(path_id)");
        db.exec("PRAGMA user_version = 3");
        console.log('Migration 2→3 complete');
    }

    // ── v3 → v4: outbox (sync_log) ───────────────────────────────────────────
    if (version < 4) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS sync_log (
                id          TEXT PRIMARY KEY,
                operation   TEXT NOT NULL,
                payload     TEXT NOT NULL,
                changed_at  TEXT NOT NULL,
                device_id   TEXT NOT NULL,
                synced      INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_sync_log_pending ON sync_log(synced);
        `);
        db.exec("PRAGMA user_version = 4");
        console.log('Migration 3→4 complete');
    }

    // ── v4 → v5: ensure sync_log exists ──────────────────────────────────────
    // The transition detector previously stamped user_version = 4 directly,
    // bypassing v3→v4 and leaving sync_log missing. Re-create idempotently.
    if (version < 5) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS sync_log (
                id          TEXT PRIMARY KEY,
                operation   TEXT NOT NULL,
                payload     TEXT NOT NULL,
                changed_at  TEXT NOT NULL,
                device_id   TEXT NOT NULL,
                synced      INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_sync_log_pending ON sync_log(synced);
        `);
        db.exec("PRAGMA user_version = 5");
        console.log('Migration 4→5 complete');
    }
}

// ── SYNC HELPERS ─────────────────────────────────────────────────────────────

let deviceId = null;

function withTransaction(fn) {
    db.exec('BEGIN');
    try {
        fn();
        db.exec('COMMIT');
    } catch (e) {
        db.exec('ROLLBACK');
        throw e;
    }
}

function logSync(operation, logPayload) {
    if (!deviceId) return;
    const id = self.crypto.randomUUID();
    const changed_at = new Date().toISOString();
    db.exec(
        `INSERT INTO sync_log (id, operation, payload, changed_at, device_id, synced)
         VALUES (?, ?, ?, ?, ?, 0)`,
        { bind: [id, operation, JSON.stringify(logPayload), changed_at, deviceId] }
    );
    console.log(`[sync_log] ${operation}`, logPayload);
}

async function init() {
    try {
        importScripts(SQLITE_WASM_URL);
        sqlite3 = await sqlite3InitModule({
            print: console.log,
            printErr: console.error,
        });

        if (sqlite3.opfs) {
            db = new sqlite3.oo1.OpfsDb('/pomoflow.db');
            console.log('SQLite OPFS Database initialized:', db.filename);
        } else {
            db = new sqlite3.oo1.DB('/pomoflow.db', 'ct');
            console.warn('OPFS not available, falling back to in-memory storage');
        }

        migrate(db);
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
        if (payload?.deviceId) deviceId = payload.deviceId;
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
                withTransaction(() => {
                    db.exec(`
                        INSERT INTO focus_areas (id, name, color, category, is_active, created_at, updated_at, is_deleted)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
                        ON CONFLICT(id) DO UPDATE SET
                            name = excluded.name,
                            color = excluded.color,
                            category = excluded.category,
                            is_active = excluded.is_active,
                            updated_at = CURRENT_TIMESTAMP,
                            is_deleted = 0
                    `, {
                        bind: [payload.id, payload.name, payload.color, payload.category, payload.is_active ? 1 : 0, payload.created_at || new Date().toISOString(), payload.updated_at || new Date().toISOString()]
                    });
                    logSync('UPSERT_FOCUS_AREA', {
                        id: payload.id, name: payload.name, color: payload.color,
                        category: payload.category, is_active: payload.is_active ? 1 : 0, is_deleted: 0
                    });
                });
                break;
            case 'delete_focus_area':
                withTransaction(() => {
                    db.exec("UPDATE focus_areas SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ?", {
                        bind: [payload.id]
                    });
                    logSync('DELETE_FOCUS_AREA', { id: payload.id });
                });
                break;
            case 'insert_session':
                withTransaction(() => {
                    db.exec(`
                        INSERT INTO sessions (id, focus_area_id, task_name, task_color, duration_seconds, xp_earned, timestamp, created_at, updated_at, is_deleted)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                        ON CONFLICT(id) DO UPDATE SET
                            duration_seconds = excluded.duration_seconds,
                            xp_earned = excluded.xp_earned,
                            updated_at = CURRENT_TIMESTAMP,
                            is_deleted = 0
                    `, {
                        bind: [payload.id, payload.taskId, payload.taskName, payload.taskColor, payload.duration, payload.xp || 0, payload.timestamp, payload.created_at || payload.timestamp, payload.updated_at || new Date().toISOString()]
                    });
                    logSync('UPSERT_SESSION', {
                        id: payload.id, focus_area_id: payload.taskId, task_name: payload.taskName,
                        task_color: payload.taskColor, duration_seconds: payload.duration,
                        xp_earned: payload.xp || 0, timestamp: payload.timestamp
                    });
                });
                break;
            case 'delete_session':
                withTransaction(() => {
                    db.exec("UPDATE sessions SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ?", {
                        bind: [payload.id]
                    });
                    logSync('DELETE_SESSION', { id: payload.id });
                });
                break;
            case 'insert_aim':
                withTransaction(() => {
                    db.exec(`
                        INSERT INTO aims (id, focus_area_id, target_minutes, target_date, is_completed, created_at, updated_at, is_deleted)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
                        ON CONFLICT(id) DO UPDATE SET
                            target_minutes = excluded.target_minutes,
                            target_date = excluded.target_date,
                            is_completed = excluded.is_completed,
                            updated_at = CURRENT_TIMESTAMP,
                            is_deleted = 0
                    `, {
                        bind: [payload.id, payload.focusAreaId, payload.targetMinutes, payload.deadline, payload.completed ? 1 : 0, payload.created_at || new Date().toISOString(), payload.updated_at || new Date().toISOString()]
                    });
                    logSync('UPSERT_AIM', {
                        id: payload.id, focus_area_id: payload.focusAreaId,
                        target_minutes: payload.targetMinutes, target_date: payload.deadline,
                        is_completed: payload.completed ? 1 : 0
                    });
                });
                break;
            case 'delete_aim':
                withTransaction(() => {
                    db.exec("UPDATE aims SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ?", {
                        bind: [payload.id]
                    });
                    logSync('DELETE_AIM', { id: payload.id });
                });
                break;
            case 'set_setting':
                db.exec(`
                    INSERT INTO settings (id, key, value, created_at, updated_at, is_deleted)
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0)
                    ON CONFLICT(key) DO UPDATE SET
                        value = excluded.value,
                        updated_at = CURRENT_TIMESTAMP,
                        is_deleted = 0
                `, {
                    bind: [payload.id, payload.key, payload.value]
                });
                break;
            case 'get_all_focus_areas':
                result = db.exec("SELECT * FROM focus_areas WHERE is_deleted = 0", { returnValue: 'resultRows', rowMode: 'object' });
                break;
            case 'get_all_sessions':
                result = db.exec(`
                    SELECT s.*, 
                           COALESCE(f.name, s.task_name, 'Unknown Focus Area') as display_name,
                           COALESCE(f.color, s.task_color, '#58a6ff') as display_color
                    FROM sessions s 
                    LEFT JOIN focus_areas f ON s.focus_area_id = f.id 
                    WHERE s.is_deleted = 0
                    ORDER BY s.timestamp DESC
                `, { returnValue: 'resultRows', rowMode: 'object' });
                break;
            case 'get_all_aims':
                result = db.exec("SELECT * FROM aims WHERE is_deleted = 0", { returnValue: 'resultRows', rowMode: 'object' });
                break;
            case 'get_all_settings':
                result = db.exec("SELECT * FROM settings WHERE is_deleted = 0", { returnValue: 'resultRows', rowMode: 'object' });
                break;
            case 'get_all_user_profile':
                result = db.exec("SELECT * FROM user_profile WHERE is_deleted = 0", { returnValue: 'resultRows', rowMode: 'object' });
                break;
            case 'get_all_app_state':
                result = db.exec("SELECT * FROM app_state WHERE is_deleted = 0", { returnValue: 'resultRows', rowMode: 'object' });
                break;
            case 'set_user_profile':
                db.exec(`
                    INSERT INTO user_profile (id, key, value, created_at, updated_at, is_deleted)
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0)
                    ON CONFLICT(key) DO UPDATE SET
                        value = excluded.value,
                        updated_at = CURRENT_TIMESTAMP,
                        is_deleted = 0
                `, {
                    bind: [payload.id, payload.key, payload.value]
                });
                break;
            case 'set_app_state':
                db.exec(`
                    INSERT INTO app_state (id, key, value, created_at, updated_at, is_deleted)
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0)
                    ON CONFLICT(key) DO UPDATE SET
                        value = excluded.value,
                        updated_at = CURRENT_TIMESTAMP,
                        is_deleted = 0
                `, {
                    bind: [payload.id, payload.key, payload.value]
                });
                break;
            case 'insert_planned_block':
                withTransaction(() => {
                    db.exec(`
                        INSERT INTO planned_blocks (id, focus_area_id, planned_date, start_minutes, duration_minutes, notes, path_id, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                        ON CONFLICT(id) DO UPDATE SET
                            focus_area_id = excluded.focus_area_id,
                            planned_date = excluded.planned_date,
                            start_minutes = excluded.start_minutes,
                            duration_minutes = excluded.duration_minutes,
                            notes = excluded.notes,
                            path_id = excluded.path_id
                    `, {
                        bind: [payload.id, payload.focusAreaId, payload.plannedDate, payload.startMinutes, payload.durationMinutes, payload.notes || null, payload.pathId || null]
                    });
                    logSync('UPSERT_PLANNED_BLOCK', {
                        id: payload.id, focus_area_id: payload.focusAreaId, planned_date: payload.plannedDate,
                        start_minutes: payload.startMinutes, duration_minutes: payload.durationMinutes,
                        notes: payload.notes || null, path_id: payload.pathId || null
                    });
                });
                break;
            case 'delete_planned_block':
                withTransaction(() => {
                    db.exec("DELETE FROM planned_blocks WHERE id = ?", { bind: [payload.id] });
                    logSync('DELETE_PLANNED_BLOCK', { id: payload.id });
                });
                break;
            case 'get_planned_blocks_for_week':
                result = db.exec(`
                    SELECT pb.*, f.name as area_name, f.color as area_color,
                           p.name as path_name, p.color as path_color, p.status as path_status
                    FROM planned_blocks pb
                    LEFT JOIN focus_areas f ON pb.focus_area_id = f.id
                    LEFT JOIN paths p ON pb.path_id = p.id
                    WHERE pb.planned_date >= ? AND pb.planned_date <= ?
                    ORDER BY pb.planned_date, pb.start_minutes
                `, { returnValue: 'resultRows', rowMode: 'object', bind: [payload.startDate, payload.endDate] });
                break;
            case 'walk_planned_block':
                withTransaction(() => {
                    db.exec(`UPDATE planned_blocks SET walked_session_id = ? WHERE id = ?`, {
                        bind: [payload.sessionId, payload.blockId]
                    });
                    logSync('WALK_PLANNED_BLOCK', { block_id: payload.blockId, session_id: payload.sessionId });
                });
                break;
            case 'insert_path':
                withTransaction(() => {
                    db.exec(`
                        INSERT INTO paths (id, name, description, color, deadline, status, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        ON CONFLICT(id) DO UPDATE SET
                            name = excluded.name,
                            description = excluded.description,
                            color = excluded.color,
                            deadline = excluded.deadline,
                            status = excluded.status,
                            updated_at = CURRENT_TIMESTAMP
                    `, {
                        bind: [payload.id, payload.name, payload.description || null, payload.color || '#3D8F5A', payload.deadline || null, payload.status || 'active']
                    });
                    logSync('UPSERT_PATH', {
                        id: payload.id, name: payload.name, description: payload.description || null,
                        color: payload.color || '#3D8F5A', deadline: payload.deadline || null,
                        status: payload.status || 'active'
                    });
                });
                break;
            case 'archive_path':
                withTransaction(() => {
                    db.exec(`UPDATE paths SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, {
                        bind: [payload.id]
                    });
                    logSync('ARCHIVE_PATH', { id: payload.id });
                });
                break;
            case 'delete_path':
                withTransaction(() => {
                    db.exec(`DELETE FROM paths WHERE id = ?`, { bind: [payload.id] });
                    logSync('DELETE_PATH', { id: payload.id });
                });
                break;
            case 'get_all_paths':
                result = db.exec(`
                    SELECT p.*,
                           COUNT(pb.id) as total_planned,
                           SUM(CASE WHEN pb.walked_session_id IS NOT NULL THEN 1 ELSE 0 END) as total_walked
                    FROM paths p
                    LEFT JOIN planned_blocks pb ON pb.path_id = p.id
                    GROUP BY p.id
                    ORDER BY p.status ASC, p.deadline ASC, p.created_at ASC
                `, { returnValue: 'resultRows', rowMode: 'object' });
                break;
            case 'get_unwalked_block_for_session':
                // Find earliest unwalked planned block for a focus area on a given date, linked to an active path
                result = db.exec(`
                    SELECT pb.*, p.name as path_name, p.color as path_color,
                           COUNT(pb2.id) as total_planned,
                           SUM(CASE WHEN pb2.walked_session_id IS NOT NULL THEN 1 ELSE 0 END) as total_walked
                    FROM planned_blocks pb
                    JOIN paths p ON pb.path_id = p.id
                    LEFT JOIN planned_blocks pb2 ON pb2.path_id = p.id
                    WHERE pb.focus_area_id = ?
                      AND pb.planned_date = ?
                      AND pb.walked_session_id IS NULL
                      AND p.status = 'active'
                    GROUP BY pb.id
                    ORDER BY pb.start_minutes ASC
                    LIMIT 1
                `, { returnValue: 'resultRows', rowMode: 'object', bind: [payload.focusAreaId, payload.date] });
                break;
            case 'get_sessions_for_week':
                result = db.exec(`
                    SELECT s.*,
                           COALESCE(f.name, s.task_name) as area_name,
                           COALESCE(f.color, s.task_color) as area_color
                    FROM sessions s
                    LEFT JOIN focus_areas f ON s.focus_area_id = f.id
                    WHERE s.is_deleted = 0
                      AND date(s.timestamp) >= ? AND date(s.timestamp) <= ?
                    ORDER BY s.timestamp
                `, { returnValue: 'resultRows', rowMode: 'object', bind: [payload.startDate, payload.endDate] });
                break;
            case 'get_pending_sync_log':
                result = db.exec(
                    `SELECT * FROM sync_log WHERE synced = 0 ORDER BY changed_at ASC LIMIT 100`,
                    { returnValue: 'resultRows', rowMode: 'object' }
                );
                break;
            case 'mark_synced':
                // payload.ids: array of sync_log ids
                if (Array.isArray(payload.ids) && payload.ids.length > 0) {
                    const placeholders = payload.ids.map(() => '?').join(',');
                    db.exec(`UPDATE sync_log SET synced = 1 WHERE id IN (${placeholders})`, {
                        bind: payload.ids
                    });
                }
                break;
            // New case for resetting the database
            case 'reset_db':
                console.log("Resetting database.");
                db.exec(`
                    DROP TABLE IF EXISTS sync_log;
                    DROP TABLE IF EXISTS planned_blocks;
                    DROP TABLE IF EXISTS paths;
                    DROP TABLE IF EXISTS aims;
                    DROP TABLE IF EXISTS sessions;
                    DROP TABLE IF EXISTS focus_areas;
                    DROP TABLE IF EXISTS settings;
                    DROP TABLE IF EXISTS user_profile;
                    DROP TABLE IF EXISTS app_state;
                    DROP TABLE IF EXISTS settings_legacy_temp;
                    DROP TABLE IF EXISTS app_state_legacy_temp;
                    DROP TABLE IF EXISTS user_profile_legacy_temp;
                    PRAGMA user_version = 0;
                `);
                migrate(db);
                result = { message: "Database reset successfully." };
                break;
            default:
                // Handle other actions or throw an error if the action is unknown
                break;
        }
        self.postMessage({ action: 'success', result, requestId });
    } catch (err) {
        self.postMessage({ action: 'error', error: err.message, requestId });
    }
};
