-- PomoFlow SQLite Schema (OPFS)
-- Focus Areas: The core domains of work
CREATE TABLE IF NOT EXISTS focus_areas (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#58a6ff',
    category TEXT DEFAULT 'Uncategorized',
    is_active INTEGER DEFAULT 1, -- 0 for archived
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Aims: Daily or project-based targets
CREATE TABLE IF NOT EXISTS aims (
    id TEXT PRIMARY KEY,
    focus_area_id TEXT NOT NULL,
    target_minutes INTEGER NOT NULL,
    target_date DATE NOT NULL, -- YYYY-MM-DD
    is_completed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (focus_area_id) REFERENCES focus_areas(id) ON DELETE CASCADE
);

-- Sessions: Individual focus blocks completed
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    focus_area_id TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    xp_earned INTEGER DEFAULT 0,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, -- Start or end time
    note TEXT, -- Future expansion for session-specific notes
    FOREIGN KEY (focus_area_id) REFERENCES focus_areas(id) ON DELETE CASCADE
);

-- Settings: Global application preferences
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL -- Store as JSON or string values
);

-- User Profile & Stats
CREATE TABLE IF NOT EXISTS user_profile (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_sessions_timestamp ON sessions(timestamp);
CREATE INDEX IF NOT EXISTS idx_sessions_area ON sessions(focus_area_id);
CREATE INDEX IF NOT EXISTS idx_aims_date ON aims(target_date);

-- --- MIGRATION MAPPING (localStorage -> SQLite) ---
/*
  JSON Structure (state)      ->  SQLite Table
  -----------------------------------------------
  state.tasks[]               ->  focus_areas
    .id                       ->    id
    .name                     ->    name
    .color                    ->    color
    .category                 ->    category
  
  state.sessions[]            ->  sessions
    .id                       ->    id
    .taskId                   ->    focus_area_id
    .duration                 ->    duration_seconds
    .timestamp                ->    timestamp
    (calculate XP)            ->    xp_earned
  
  state.aims[]                ->  aims
    .id                       ->    id
    .goalId                   ->    focus_area_id
    .targetMinutes            ->    target_minutes
    .date                     ->    target_date
  
  state.settings{}            ->  settings (as key-value rows)
  state.xp, state.level, etc. ->  user_profile
*/

-- --- ANALYTICS EXAMPLES ---

-- 1. Top focus area on Tuesdays last month
/*
SELECT fa.name, SUM(s.duration_seconds) / 60 as total_minutes
FROM sessions s
JOIN focus_areas fa ON s.focus_area_id = fa.id
WHERE strftime('%w', s.timestamp) = '2'
  AND s.timestamp BETWEEN date('now','start of month','-1 month') 
                      AND date('now','start of month','-1 day')
GROUP BY s.focus_area_id
ORDER BY total_minutes DESC
LIMIT 1;
*/

-- 2. Focus Heatmap (Hour of Day vs Day of Week)
/*
SELECT 
    strftime('%w', timestamp) as day_of_week,
    strftime('%H', timestamp) as hour_of_day,
    COUNT(*) as session_count
FROM sessions
GROUP BY day_of_week, hour_of_day
ORDER BY day_of_week, hour_of_day;
*/

-- 3. Monthly Progression (Total Focus Time per Month)
/*
SELECT 
    strftime('%Y-%m', timestamp) as month,
    SUM(duration_seconds) / 3600.0 as total_hours
FROM sessions
GROUP BY month
ORDER BY month DESC;
*/

-- 4. Streak Calculation (Offline-friendly)
-- Finds consecutive days where at least 1 session exists
/*
WITH RECURSIVE dates(date) AS (
  SELECT date(timestamp) FROM sessions GROUP BY date(timestamp)
),
streaks AS (
  SELECT date, julianDay(date) - row_number() OVER (ORDER BY date) as group_id
  FROM dates
)
SELECT COUNT(*) as streak_length, MIN(date) as start_date, MAX(date) as end_date
FROM streaks
GROUP BY group_id
ORDER BY end_date DESC
LIMIT 1;
*/
