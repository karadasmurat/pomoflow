# PomoFlow — Architecture & Design Standards

---

## 1. Stack

- **No framework, no bundler** — vanilla JS with ES modules loaded directly
- **Dev server** (`node dev-server.js`) required for COOP/COEP headers (SQLite needs `SharedArrayBuffer`)
- **GitHub Pages** uses `coi-serviceworker.js` to provide those headers instead
- Changes take effect on hard refresh (Cmd+Shift+R)

---

## 2. File Structure

```
pomoflow/
├── app.html                  # Single HTML entry point
├── dev-server.js             # Local dev server (sets COOP/COEP headers)
├── coi-serviceworker.js      # Cross-origin isolation for GitHub Pages
├── css/
│   ├── base.css              # CSS reset and root tokens
│   ├── styles.css            # All app styles (design tokens, components, layout)
│   ├── sidenav.css           # Sidenav shell and collapse behavior
│   └── planner.css           # Focus Planner overlay styles
└── js/
    ├── app.js                # App init, event wiring, auth flow, keyboard shortcuts
    ├── db.js                 # DatabaseManager — public API for all DB operations
    ├── db-worker.js          # SQLite Web Worker (runs all queries off the main thread)
    ├── state/
    │   └── store.js          # Single source of truth: state object + mutations + constants
    ├── engine/
    │   ├── timer.js          # TimerEngine — Web Worker tick loop, target end-time
    │   └── music.js          # MusicEngine — fetch→blob→objectURL audio streaming
    ├── services/
    │   ├── history.service.js    # Session filtering, 4 AM rollover, dashboard data
    │   ├── focus.service.js      # Focus area goal management, rank calculation
    │   ├── sync.service.js       # Supabase delta sync, sync_log outbox
    │   ├── settings.service.js   # User preference persistence
    │   ├── timer.service.js      # Timer state helpers
    │   └── notification.service.js # In-app notification CRUD and system triggers
    └── ui/
        ├── app.js (main)         # Coordinates all views
        ├── dashboard.view.js     # Activity panel: stats, chart, history list
        ├── planner.view.js       # Focus Planner: calendar, blocks, paths, mobile tabs
        ├── timer.view.js         # Timer display and controls
        └── focus.view.js         # Focus areas panel, XP/level display
```

---

## 3. Three-Layer Architecture

### State (`js/state/store.js`)
Single source of truth. Exports a mutable `state` object and a `mutations` object for reactive updates. All domain constants live here: `DEFAULT_FOCUS_AREAS`, `ACHIEVEMENTS`, `RANKS`, category definitions, color palettes.

### Services (`js/services/`)
Domain logic lives in services, not views:
- `history.service.js` — session filtering with 4 AM logical day rollover
- `focus.service.js` — goal management and rank calculation
- `sync.service.js` — Supabase delta sync, outbox pattern via `sync_log`
- `settings.service.js` — user preference persistence
- `timer.service.js` — timer state helpers
- `notification.service.js` — in-app notifications, system notification triggers

### Views (`js/ui/`)
Views render state and dispatch mutations. They never contain domain logic.
- `planner.view.js` is the largest view (~46KB): calendar, blocks, paths, drag-drop, mobile sheets
- Views are coordinated by `js/app.js`, which handles auth flow, keyboard shortcuts, and app initialization

---

## 4. Data Persistence

### SQLite via OPFS
- All application data lives in a SQLite database running in a Web Worker (`db.js` + `db-worker.js`)
- `localStorage` is not used for app data — only for small ephemeral values (device ID, sounds cache, sidenav collapsed state)
- All writes go through `DatabaseManager` in `db.js` — no raw SQL in UI code

### Soft Deletes
All tables use `is_deleted` (INTEGER) + `deleted_at` (DATETIME). Hard deletes never happen on client rows to support sync correctness.

### Cross-Origin Isolation
SQLite (WASM) requires `SharedArrayBuffer`, which requires `COOP: same-origin` + `COEP: require-corp` headers. These are set by `dev-server.js` locally and `coi-serviceworker.js` on GitHub Pages.

---

## 5. Timer

- `TimerEngine` runs tick callbacks in a **Web Worker** for accuracy when backgrounded
- Sessions use **target end times**, not countdown deltas — this survives tab backgrounding and device sleep
- `cycleStation` (1–4) tracks position within a focus block
- Timer holds at `0:00` after completion (intentional — gives breathing room before next cycle)
- On reload: resumes by comparing `Date.now()` to stored target end time

---

## 6. Music Engine

- `MusicEngine` in `js/engine/music.js`
- Audio element streaming via `fetch(url, { mode: 'cors' }) → blob → URL.createObjectURL()`
- This pattern is required because `<audio src="supabase-url">` is blocked by `COEP: require-corp` (cross-origin, no `Cross-Origin-Resource-Policy` header)
- `isLoading` flag blocks all controls during download to prevent pause/skip race conditions
- `onPlayStateChange` callback driven by audio element `play` / `pause` events (not manual tracking)
- Track list fetched from Supabase `sounds` table; cached in `localStorage` as `pf_sounds_cache`

---

## 7. Cloud Sync

- Supabase is **optional** — app is fully functional offline
- Auth: Google OAuth or magic link (Supabase Auth)
- **Outbox pattern**: every synced write also inserts a row in `sync_log`
- Background poller reads `sync_log WHERE synced = 0`, pushes to Supabase, marks `synced = 1`
- Pull: delta sync using `last_pulled_at` timestamp filter
- Row Level Security (RLS) enforces per-user data isolation on all cloud tables
- Per-device tables (`settings`, `user_profile`, `app_state`) are never synced

---

## 8. Layout System

### App Shell
```
.app-shell (flex row)
  ├── .sidenav (fixed width, collapsible)
  └── .app (flex: 1, overflow-y: auto)
        └── .main-content (flex column → flex row at ≥1100px)
              ├── .timer-panel (flex: 0 0 420px, sticky)
              └── .history-panel (flex: 1)
```

### Breakpoints
| Breakpoint | Layout |
|---|---|
| ≥1100px | Two-column: timer sticky left, activity right |
| 481–1099px | Single column, max-width 650px centered |
| ≤480px | Full-width, mobile bottom tab switching |

### Mobile Panel Switching
`data-mobile-view="activity"` on `.main-content` toggles which panel is visible on mobile via CSS attribute selectors.

---

## 9. UI Standards

### Reserved Colors
- **Red (`--danger`)**: Focus session ring. Never repurposed.
- **Green (`--success`)**: Break session ring. Never repurposed.

### Logical Day Rollover
All daily stats, streaks, and history filters use a **4:00 AM rollover**. Sessions before 4 AM count toward the previous calendar day. This is implemented in `history.service.js`.

### Button Hierarchy
- **Primary action**: large pill (Start/Pause)
- **Secondary action**: pill with border (`setting-action-btn`)
- **Destructive**: pill with danger border/color (grouped in Danger Zone in settings)
- **Icon-only**: 44×44px minimum touch target

### Focus Styles
Suppress browser default outlines (`outline: none`) and replace with explicit `:focus-visible` styles using `--primary` or `--accent` at 2px offset.

### Settings Panel
- Slides in from the left (`position: fixed`, `transform: translateX`)
- Full `100vh` height, `display: flex; flex-direction: column`
- Content area: `flex: 1; overflow-y: auto`
- Footer (Close button): `flex-shrink: 0`, pinned to bottom
- Destructive actions grouped in a visually distinct Danger Zone section

---

## 10. Key Design Decisions

| Decision | Rationale |
|---|---|
| No bundler | Simplicity; ES modules work directly in modern browsers |
| SQLite over localStorage | Relational queries, soft deletes, sync-ready schema |
| Web Worker timer | Accurate countdown when tab is backgrounded |
| fetch→blob audio | Required to bypass COEP restriction on cross-origin `<audio>` |
| 4 AM rollover | Late-night sessions shouldn't inflate next day's count |
| Soft deletes everywhere | Enables conflict-free sync across devices |
| Supabase optional | App must work fully offline; auth is a sync mechanism, not a gate |
| Sounds table in DB | New tracks added without code changes — just insert + upload |
