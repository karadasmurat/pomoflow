# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development

```bash
node dev-server.js    # Start dev server at localhost:8080
```

No build step — the app uses ES modules directly. The dev server is required (not just opening `index.html`) because SQLite (OPFS) needs Cross-Origin Isolation headers (`COOP` + `COEP`). On GitHub Pages, `coi-serviceworker.js` provides these instead.

There is no test suite configured despite Playwright being installed.

## Architecture

PomoFlow is a **no-bundler, vanilla JS SPA** organized into three layers:

### State (`js/state/store.js`)
Single source of truth. Exports a mutable `state` object and a `mutations` object for reactive updates. All domain constants (e.g. `DEFAULT_FOCUS_AREAS`, `ACHIEVEMENTS`) live here.

### Services (`js/services/`)
Domain logic lives in services, not views:
- `sync.service.js` — Supabase delta sync, uses `sync_log` table and `last_pulled_at`
- `history.service.js` — session filtering with 4 AM logical day rollover
- `focus.service.js` — goal management and rank calculation
- `settings.service.js` — user preference persistence
- `timer.service.js` — timer state helpers

### Views (`js/ui/`)
Views render state and dispatch mutations. `planner.view.js` is the largest (46KB). Views are coordinated by `js/app.js`, which also handles auth flow, keyboard shortcuts, and app initialization.

### Data (SQLite via OPFS)
All data persists in a local SQLite database running in a Web Worker (`js/db.js` + `js/db-worker.js`). `localStorage` is not used. All tables use **soft deletes** (`is_deleted` + `deleted_at`). Schema is at `docs/data_model.md`.

### Timer (`js/engine/timer.js`)
`TimerEngine` runs ticks in a Web Worker for accuracy when backgrounded. Sessions use target end times. Timer stays at `0:00` after completion (intentional — gives breathing room before the next cycle). The `cycleStation` (1–4) tracks position within a focus block.

## Key Design Decisions

- **4 AM logical day rollover** — sessions before 4 AM count toward the previous day
- **Red = Focus, Green = Break** — session ring colors are reserved, don't repurpose them
- **Supabase is optional** — app is fully functional offline; cloud sync is opt-in via auth
- **No bundler** — changes take effect on hard refresh (Cmd+Shift+R)

## CSS / Design System

CSS uses custom properties defined in `css/base.css` and `css/styles.css`. The living design token reference is at `docs/design-system.md`. Themes are set via `data-theme="light"` on the root; dark is default. Key tokens: `--bg`, `--surface`, `--surface-elevated`, `--accent` (green), `--primary` (blue), `--danger` (red, Focus ring), `--success` (green, Break ring).

## Documentation

- `docs/ARCHITECTURE.md` — architecture standards and UI conventions
- `docs/data_model.md` — full DB schema and cardinality
- `docs/design-system.md` — design tokens reference
- `docs/sync-roadmap.md` — sync feature roadmap
