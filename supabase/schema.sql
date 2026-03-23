-- PomoFlow — Supabase Postgres schema
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query)

-- ── TABLES ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS focus_areas (
    id          TEXT PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    color       TEXT DEFAULT '#58a6ff',
    category    TEXT DEFAULT 'Uncategorized',
    is_active   BOOLEAN DEFAULT true,
    is_deleted  BOOLEAN DEFAULT false,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    id                TEXT PRIMARY KEY,
    user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    focus_area_id     TEXT REFERENCES focus_areas(id),
    task_name         TEXT,
    task_color        TEXT,
    duration_seconds  INTEGER NOT NULL,
    xp_earned         INTEGER DEFAULT 0,
    timestamp         TIMESTAMPTZ,
    note              TEXT,
    is_deleted        BOOLEAN DEFAULT false,
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aims (
    id              TEXT PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    focus_area_id   TEXT REFERENCES focus_areas(id),
    target_minutes  INTEGER NOT NULL,
    target_date     DATE,
    is_completed    BOOLEAN DEFAULT false,
    is_deleted      BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS paths (
    id           TEXT PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    description  TEXT,
    color        TEXT DEFAULT '#3D8F5A',
    deadline     TEXT,
    status       TEXT DEFAULT 'active',
    created_at   TIMESTAMPTZ DEFAULT now(),
    updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS planned_blocks (
    id                 TEXT PRIMARY KEY,
    user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    focus_area_id      TEXT REFERENCES focus_areas(id),
    path_id            TEXT REFERENCES paths(id),
    planned_date       TEXT,
    start_minutes      INTEGER,
    duration_minutes   INTEGER,
    notes              TEXT,
    walked_session_id  TEXT,
    is_deleted         BOOLEAN DEFAULT false,
    created_at         TIMESTAMPTZ DEFAULT now(),
    updated_at         TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
    id          TEXT PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    message     TEXT NOT NULL,
    type        TEXT DEFAULT 'info',
    is_read     BOOLEAN DEFAULT false,
    is_deleted  BOOLEAN DEFAULT false,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

-- ── ROW LEVEL SECURITY ────────────────────────────────────────────────────────

ALTER TABLE focus_areas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE aims           ENABLE ROW LEVEL SECURITY;
ALTER TABLE paths          ENABLE ROW LEVEL SECURITY;
ALTER TABLE planned_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications  ENABLE ROW LEVEL SECURITY;

-- Full CRUD — users can only read/write their own rows
CREATE POLICY "users manage own data" ON focus_areas
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "users manage own data" ON sessions
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "users manage own data" ON aims
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "users manage own data" ON paths
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "users manage own data" ON planned_blocks
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "users manage own data" ON notifications
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── INDEXES ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_focus_areas_user    ON focus_areas(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user       ON sessions(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_aims_user           ON aims(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_paths_user          ON paths(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_planned_blocks_user ON planned_blocks(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user  ON notifications(user_id, updated_at);
