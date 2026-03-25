# PomoFlow — Cross-Device Sync Roadmap

## Context

PomoFlow currently stores all data in **local SQLite** (WASM in browser). The app is fully offline-capable. This roadmap preserves that guarantee while adding cross-device sync via Supabase.

**Core principle:** local SQLite is always the source of truth. Sync is always a background concern. The app never waits for the network.

---

## Architecture Overview

```
Web (WASM SQLite)      ──┐
                          ├──→  Supabase (Auth + Postgres + Edge Functions + Realtime)
Mobile (native SQLite) ──┘
```

| Layer | Technology | Role |
|---|---|---|
| Local store | SQLite (WASM / native) | Source of truth, all reads & writes |
| Outbox | `sync_log` table in SQLite | Queues pending changes |
| Auth | Supabase Auth (magic link) | Issues JWT, no passwords |
| Cloud store | Supabase Postgres | Cloud replica, scoped by user |
| Push API | Supabase Edge Function | Receives JSON payload, replays as Postgres transaction |
| Pull API | PostgREST | Returns delta filtered by `updated_at` and `user_id` |
| Live notify | Supabase Realtime | Tells other devices to pull (phase 3) |
| Data isolation | Row Level Security (RLS) | Postgres enforces user_id scoping automatically |

---

## Tables: Sync vs Per-device

| Table | Synced | Rationale |
|---|---|---|
| `focus_areas` | ✅ Yes | Core domain data |
| `sessions` | ✅ Yes | Append-only history, must be consistent across devices |
| `aims` | ✅ Yes | Per-focus-area targets; feature may be revisited but sync included |
| `planned_blocks` | ✅ Yes | Planning data; note: hard-deleted locally, deletions propagated via outbox |
| `paths` | ✅ Yes | Cross-device goal tracking |
| `settings` | ❌ Per-device | Session duration, theme, notifications may intentionally differ per device |
| `user_profile` | ❌ Per-device | Device-local display name / preferences |
| `app_state` | ❌ Per-device | Ephemeral UI state, meaningless across devices |

---

## The Outbox Pattern

Every local write touches **two things in the same SQLite transaction**: the data tables and the `sync_log`. This guarantees nothing is written without being logged.

```sql
BEGIN;
  INSERT INTO planned_blocks (id, focus_area_id, date, session_count, ...);
  UPDATE focus_areas SET total_sessions = total_sessions + 2 WHERE id = '...';
  INSERT INTO sync_log (id, operation, payload, changed_at)
    VALUES ('uuid', 'CREATE_PLANNED_BLOCK', '{ ... }', '2026-03-17T10:00:00Z');
COMMIT;
```

A background worker reads `sync_log WHERE synced = 0`, pushes to Supabase, and marks rows `synced = 1`.

### sync_log table

```sql
CREATE TABLE sync_log (
  id          TEXT PRIMARY KEY,   -- uuid
  operation   TEXT NOT NULL,      -- e.g. 'UPSERT_PLANNED_BLOCK'
  payload     TEXT NOT NULL,      -- JSON string
  changed_at  TEXT NOT NULL,      -- ISO timestamp
  device_id   TEXT NOT NULL,      -- stable UUID per browser/device, stored in localStorage
  synced      INTEGER DEFAULT 0   -- 0 = pending, 1 = done
);
```

### Device ID

A stable UUID generated on first app load and persisted to `localStorage`. Used to filter out your own changes when pulling from Supabase (avoid re-applying writes already present locally).

```js
let deviceId = localStorage.getItem('pf_device_id');
if (!deviceId) {
  deviceId = crypto.randomUUID();
  localStorage.setItem('pf_device_id', deviceId);
}
```

### JSON payload design

The payload describes **what happened**, not the resulting SQL. Numeric fields that accumulate use **deltas**, not absolute values, to avoid overwrite conflicts.

```json
{
  "operation": "UPSERT_PLANNED_BLOCK",
  "planned_block": {
    "id": "blk-1",
    "focus_area_id": "fa-1",
    "date": "2026-03-17",
    "session_count": 2
  },
  "focus_area_delta": {
    "id": "fa-1",
    "total_sessions_delta": 2
  }
}
```

| Field type | Strategy | Reason |
|---|---|---|
| Scalar (name, date, color) | Absolute value | Last-write-wins is acceptable |
| Accumulating numeric (session totals) | Delta (+N) | Composable across devices |
| Append-only (sessions log) | Insert only | No conflict possible |

---

## Write path inventory

All writes are fully abstracted behind `DatabaseManager` in `js/db.js`. No raw SQL in UI code. 15 write operations across 8 tables, all going through `dbManager`.

| Function | Table | Operation | Sync? |
|---|---|---|---|
| `insertFocusArea` | focus_areas | UPSERT | ✅ |
| `deleteFocusArea` | focus_areas | Soft delete | ✅ |
| `insertSession` | sessions | UPSERT | ✅ |
| `deleteSession` | sessions | Soft delete | ✅ |
| `insertAim` | aims | UPSERT | ✅ |
| `deleteAim` | aims | Soft delete | ✅ |
| `insertPlannedBlock` | planned_blocks | UPSERT | ✅ |
| `deletePlannedBlock` | planned_blocks | Hard delete | ✅ |
| `walkPlannedBlock` | planned_blocks | UPDATE | ✅ |
| `insertPath` | paths | UPSERT | ✅ |
| `archivePath` | paths | UPDATE | ✅ |
| `deletePath` | paths | Hard delete | ✅ |
| `setSetting` | settings | UPSERT | ❌ |
| `setUserProfile` | user_profile | UPSERT | ❌ |
| `setAppState` | app_state | UPSERT | ❌ |

**Phase 1 scope:** add `sync_log` insert alongside the 12 synced write functions in `db-worker.js`.

---

## Schema additions

Every synced table needs two extra columns:

```sql
ALTER TABLE sessions        ADD COLUMN user_id    UUID;
ALTER TABLE sessions        ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE focus_areas     ADD COLUMN user_id    UUID;
ALTER TABLE focus_areas     ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE planned_blocks  ADD COLUMN user_id    UUID;
ALTER TABLE planned_blocks  ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE aims            ADD COLUMN user_id    UUID;
ALTER TABLE aims            ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE paths           ADD COLUMN user_id    UUID;
ALTER TABLE paths           ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
```

RLS policy (same pattern for every table):

```sql
CREATE POLICY "users see own data" ON sessions
  USING (user_id = auth.uid());
```

---

## Auth flow

**Positioning:** free account, no paid tier. Auth is the mechanism for sync, not a paywall. Sign-in is required to use the app (magic link only — no passwords).

**First launch:** sign-in screen shown immediately. "Create a free account to get started. Your data syncs across all your devices."

**Returning user (already signed in):** JWT cached locally by Supabase JS client. App loads from local SQLite immediately — no network needed.

**First sign-in on a device with existing local data:** push local data before pulling. No data loss.

```javascript
// Sign in — all you write
await supabase.auth.signInWithOtp({ email })

// Sync push — JWT attached automatically
await supabase.functions.invoke('sync-push', { body: payload })
```

---

## Phased Roadmap

### ✅ Phase 1 — Outbox foundation
**Complete.**

- [x] Add `sync_log` table to SQLite schema
- [x] Add device ID generation on app init (`localStorage`)
- [x] Wrap synced write functions in `db-worker.js` with `sync_log` inserts
- [x] Define JSON payload schema for all operation types
- [x] Background worker reads `synced = 0` rows and pushes to Supabase

---

### ✅ Phase 2 — Auth + cloud backend
**Complete.**

- [x] Supabase project created
- [x] Auth — magic link + Google OAuth
- [x] Postgres schema mirrors SQLite; `user_id` + `updated_at` on all synced tables
- [x] RLS policy on every synced table
- [x] Delta sync via PostgREST filtered by `last_pulled_at` and `user_id`
- [x] First-sign-in migration: local data pushed before pulling

---

### Phase 3 — Multi-device + mobile
**Pending.**

- [ ] Enable Supabase Realtime on synced tables
- [ ] Subscribe on app load — when a change arrives, trigger a pull (delta only)
- [ ] Build mobile app with native SQLite
- [ ] Same outbox pattern, same Edge Function — no new sync logic needed
- [ ] Handle offline queue flush on reconnect (web + mobile)

**Deliverable:** write on phone, see it on laptop within seconds. Works offline throughout.

---

## What Supabase handles for you

| Concern | Supabase feature | You write |
|---|---|---|
| Auth | Supabase Auth | ~2 lines |
| JWT validation | Built into PostgREST + Edge Functions | Nothing |
| Data isolation | Row Level Security | One policy per table |
| REST pull API | PostgREST (auto-generated) | Nothing |
| Push logic | Edge Function (Deno/TypeScript) | ~30 lines |
| Live notify | Realtime | ~5 lines to subscribe |
| Password management | None needed (magic link) | Nothing |

No Spring Boot. No custom auth server. No separate backend to deploy or maintain.

---

## Conflict strategy (v1)

| Entity | Strategy | Rationale |
|---|---|---|
| Sessions | Append-only, no conflicts | A session on device A and device B are both true |
| Planned blocks | Last-write-wins by `updated_at` | Future blocks only; past blocks are immutable once walked |
| Focus areas | Last-write-wins by `updated_at` | Low-frequency changes |
| Paths | Last-write-wins by `updated_at` | Low-frequency changes |
| Aims | Last-write-wins by `updated_at` | Low-frequency changes |
| Settings | Per-device, not synced | Session duration may intentionally differ per device |

Full conflict resolution (CRDTs, operational transforms) is a v2+ concern.
