# PomoFlow — Data Model

## Overview

All data persists in a local **SQLite** database via the **Origin Private File System (OPFS)**, running in a Web Worker. Supabase Postgres mirrors synced tables for cloud backup and cross-device sync.

- All deletes are **soft**: `is_deleted = 1` + `deleted_at` timestamp
- Primary keys use **UUIDv7** (time-ordered, sync-friendly)
- Per-device tables (`settings`, `user_profile`, `app_state`) are never synced

---

## Tables

### `focus_areas`
The primary work categories or projects defined by the user.

| Field | Type | Notes |
|---|---|---|
| `id` | TEXT (UUIDv7) | PK |
| `name` | TEXT | Required |
| `color` | TEXT | Default `#58a6ff` |
| `category` | TEXT | Default `Uncategorized` |
| `is_active` | INTEGER | 1 = active, 0 = completed |
| `created_at` | DATETIME | UTC |
| `updated_at` | DATETIME | UTC |
| `is_deleted` | INTEGER | Soft delete flag |
| `deleted_at` | DATETIME | Null if not deleted |

---

### `sessions`
Individual completed focus sessions.

| Field | Type | Notes |
|---|---|---|
| `id` | TEXT (UUIDv7) | PK |
| `focus_area_id` | TEXT | FK → `focus_areas.id`, nullable |
| `task_name` | TEXT | Denormalized (survives area deletion) |
| `task_color` | TEXT | Denormalized |
| `task_category` | TEXT | Denormalized |
| `duration` | INTEGER | Duration in seconds |
| `xp_earned` | INTEGER | XP awarded (1 per minute) |
| `timestamp` | DATETIME | When session completed |
| `note` | TEXT | Optional |
| `created_at` | DATETIME | |
| `updated_at` | DATETIME | |
| `is_deleted` | INTEGER | |
| `deleted_at` | DATETIME | |

---

### `planned_blocks`
Scheduled commitment blocks in the Focus Planner.

| Field | Type | Notes |
|---|---|---|
| `id` | TEXT (UUIDv7) | PK |
| `focus_area_id` | TEXT | FK → `focus_areas.id` |
| `path_id` | TEXT | FK → `paths.id`, nullable |
| `date` | DATE | YYYY-MM-DD |
| `start_time` | TEXT | HH:MM |
| `session_count` | INTEGER | Number of planned sessions |
| `label` | TEXT | Optional note |
| `reminder_minutes` | INTEGER | Minutes before start to notify (default 10) |
| `reminder_sent` | INTEGER | 0 = pending, 1 = sent |
| `created_at` | DATETIME | |
| `updated_at` | DATETIME | |
| `is_deleted` | INTEGER | |
| `deleted_at` | DATETIME | |

---

### `paths`
Learning paths that group planned blocks toward a goal.

| Field | Type | Notes |
|---|---|---|
| `id` | TEXT (UUIDv7) | PK |
| `name` | TEXT | Required |
| `description` | TEXT | Optional |
| `color` | TEXT | One of 7 palette colors |
| `deadline` | DATE | Optional |
| `is_archived` | INTEGER | 0 = active, 1 = archived |
| `created_at` | DATETIME | |
| `updated_at` | DATETIME | |
| `is_deleted` | INTEGER | |
| `deleted_at` | DATETIME | |

---

### `aims`
Time-bound focus targets (e.g. "Study 120 minutes by Friday").

| Field | Type | Notes |
|---|---|---|
| `id` | TEXT (UUIDv7) | PK |
| `focus_area_id` | TEXT | FK → `focus_areas.id` |
| `target_minutes` | INTEGER | Required |
| `target_date` | DATE | YYYY-MM-DD or `infinite` |
| `is_completed` | INTEGER | 0 = active, 1 = completed |
| `created_at` | DATETIME | |
| `updated_at` | DATETIME | |
| `is_deleted` | INTEGER | |
| `deleted_at` | DATETIME | |

---

### `notifications`
In-app notification log.

| Field | Type | Notes |
|---|---|---|
| `id` | TEXT (UUIDv7) | PK |
| `type` | TEXT | `success`, `warning`, `info`, `error`, `milestone` |
| `title` | TEXT | |
| `message` | TEXT | |
| `is_read` | INTEGER | 0 = unread, 1 = read |
| `created_at` | DATETIME | |
| `updated_at` | DATETIME | |
| `is_deleted` | INTEGER | |
| `deleted_at` | DATETIME | |

---

### `sync_log`
Outbox for pending cloud sync operations.

| Field | Type | Notes |
|---|---|---|
| `id` | TEXT (UUIDv7) | PK |
| `operation` | TEXT | e.g. `UPSERT_SESSION`, `DELETE_FOCUS_AREA` |
| `payload` | TEXT | JSON string of the operation |
| `changed_at` | TEXT | ISO timestamp |
| `device_id` | TEXT | Stable UUID per browser/device |
| `synced` | INTEGER | 0 = pending, 1 = pushed |

---

### KV Tables: `settings`, `user_profile`, `app_state`
Identical schema, used for JSON key-value storage.

| Field | Type | Notes |
|---|---|---|
| `id` | TEXT (UUIDv7) | PK |
| `key` | TEXT | UNIQUE |
| `value` | TEXT (JSON) | JSON-serialized value |
| `created_at` | DATETIME | |
| `updated_at` | DATETIME | |
| `is_deleted` | INTEGER | |
| `deleted_at` | DATETIME | |

**`settings`** — timer durations, auto-start, volume, music track, theme, etc. Per-device, not synced.

**`user_profile`** — avatar emoji, mood text, XP total, level, achievements. Per-device, not synced.

**`app_state`** — timer state (running/paused, target end time), active task, UI state. Per-device, not synced.

---

## Relationship Map

```
focus_areas ──┬──< sessions
              ├──< aims
              └──< planned_blocks >──< paths
```

- `focus_areas` → `sessions`: one-to-many (a session can have null focus_area_id for untracked sessions)
- `focus_areas` → `aims`: one-to-many
- `focus_areas` → `planned_blocks`: one-to-many
- `paths` → `planned_blocks`: one-to-many (path_id nullable)

---

## Indexes

| Index | Table | Purpose |
|---|---|---|
| `idx_sessions_timestamp` | sessions | Chronological history retrieval |
| `idx_sessions_area` | sessions | Per-area statistics |
| `idx_aims_date` | aims | Active goals by deadline |

---

## Sync: What's synced vs. per-device

| Table | Synced to Supabase |
|---|---|
| `focus_areas` | ✅ |
| `sessions` | ✅ |
| `planned_blocks` | ✅ |
| `paths` | ✅ |
| `aims` | ✅ |
| `notifications` | ✅ |
| `settings` | ❌ per-device |
| `user_profile` | ❌ per-device |
| `app_state` | ❌ per-device |
| `sync_log` | local only |

---

## Notes

- **Boolean fields**: SQLite has no BOOLEAN type. `is_deleted`, `is_active`, `is_completed`, `is_archived`, `is_read`, `synced`, `reminder_sent` all use INTEGER (0/1).
- **Timestamps**: All DATETIME fields store UTC. Local time conversion happens in the UI layer.
- **Denormalization**: `sessions` stores `task_name`, `task_color`, `task_category` from the focus area at session time. This ensures the Activity Log renders correctly even if the parent area is later renamed or deleted.
- **UUIDv7**: Time-ordered UUIDs — more performant for SQLite B-trees than random UUIDs and maintain global uniqueness for sync.
- **4 AM rollover**: `history.service.js` applies a 4:00 AM logical day boundary when filtering sessions. Sessions before 4 AM count toward the previous calendar day.
