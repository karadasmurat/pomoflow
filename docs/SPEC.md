# PomoFlow — Product Specification

> This document reflects the current production state of the app.
> For a quick feature inventory, see `app-spec.md`.
> For technical architecture, see `ARCHITECTURE.md`.

---

## 1. Project Overview

- **Name**: PomoFlow
- **Type**: Vanilla JS SPA, no bundler, ES modules
- **Core purpose**: Pomodoro-based focus tracker with intentional planning, session history, and ambient music
- **Data**: Local-first (SQLite via OPFS). Supabase cloud sync is opt-in via auth.

---

## 2. Layout

### Desktop (≥1100px)
Two-column layout inside an app shell:
- **Left**: Collapsible sidenav (280px expanded / 56px collapsed) + timer panel (420px, sticky)
- **Right**: Activity panel (flex: 1)

### Tablet (481–1099px)
Single centered column, max-width 650px.

### Mobile (≤480px)
Full-width stacked panels. Sidenav hidden. Persistent bottom tab bar (5 tabs): Timer · Planner · Activity · Paths · Areas.

---

## 3. Design System

### Color Tokens

**Dark theme (default)**
- `--bg`: `#0d1117`
- `--surface`: `#161b22`
- `--surface-elevated`: `#21262d`
- `--accent`: `#3fb950` (green)
- `--primary`: `#58a6ff` (blue)
- `--danger`: `#f85149` (red — Focus ring, destructive actions)
- `--success`: `#3fb950` (green — Break ring)
- `--text-primary`: `#f0f6fc`
- `--text-secondary`: `#8b949e`
- `--border`: `#30363d`

**Light theme**
- `--bg`: `#ffffff`
- `--surface`: `#f6f8fa`
- `--surface-elevated`: `#eaeef2`
- `--accent`: `#1a7f37`
- `--primary`: `#0969da`
- `--danger`: `#cf222e`
- `--text-primary`: `#1f2328`
- `--text-secondary`: `#656d76`
- `--border`: `#d0d7de`

### Reserved Colors
- **Red (`--danger`)** — Focus session ring only. Never repurposed for other states.
- **Green (`--success` / `--accent`)** — Break session ring only.

### Typography
- UI: `DM Sans, sans-serif`
- Timer display: `Roboto, sans-serif` (or `--font-time`)
- Monospace / data: `JetBrains Mono, monospace`

### Radius Tokens
- `--r`: 6px
- `--r-md`: 8px
- `--r-lg`: 12px
- `--r-xl`: 999px (pill)

---

## 4. Timer

### Modes
| Mode | Default | Color |
|---|---|---|
| Focus | 25 min | Red (`--danger`) |
| Short Break | 5 min | Green (`--success`) |
| Long Break | 15 min | Green (`--success`) |

### Behavior
- **Cycle**: N focus sessions → long break (N configurable, default 4)
- **Engine**: Web Worker for background accuracy using target end-time
- **Post-session**: Three modes controlled by "After a focus session" setting:
  - `wait` (default) — timer holds at 0:00; user manually advances
  - `break` — auto-starts the next break immediately
  - `focus` — skips breaks and chains focus sessions continuously ("keep focusing")
- **State restoration**: On reload, resumes using stored target end-time
- **Inactivity check**: When `focus` mode is active, the app tracks the last user interaction (pointer or keyboard). After `ceil(T / workDuration) × workDuration` minutes of no interaction (T = "Still focusing? check" setting, default 120 min), a prompt appears before the next session starts. The user must confirm to continue; if dismissed or ignored for 60 seconds, auto-chaining stops. No sessions are deleted — only future auto-starts are gated.
- **Dashboard indicators**: Small icon lights sit inside the timer ring near 6 o'clock. The `repeat` icon illuminates (green) when `focus` mode is active; clicking it toggles the setting directly.

### Controls
| Key | Action |
|---|---|
| `Space` | Start / pause |
| `R` | Reset |
| `N` | Skip |
| `1` / `2` / `3` | Switch Focus / Short Break / Long Break |

### Visual
- SVG circular progress ring
- Orbit shortcut buttons (preset durations: 10–60 min)
- Context strip: upcoming planned blocks shown above controls
- Inline stats strip: today's focus time + session count

---

## 5. Music

- MP3s streamed from Supabase Storage via `fetch → blob → objectURL` (required for COEP compliance)
- Track list fetched from `sounds` Supabase table, cached in `localStorage`
- Adding new tracks = insert row in `sounds` table + upload MP3 to Storage (no code change)
- Widget: dark pill with animated disc, prev / play-pause / next controls
- Loading guard: controls disabled during track download to prevent race conditions
- "Pause on break" toggle in Time settings (default: on)

---

## 6. Activity Panel

### Stats Cards
- Focus Time (today vs. yesterday trend)
- Sessions (today vs. yesterday trend)
- Streak (consecutive days with sessions)
- Trend down: muted gray. Trend up: green.

### Focus Distribution
- Pie chart by focus area (top 5 by time)
- Focus Hero badge: area with highest % share

### Activity Log (collapsed by default)
- Session table: focus area · category · duration · finished time
- Filters: Today / Week / All
- Sort: Newest / Oldest
- Category dropdown filter
- Pagination: 20 sessions per page
- Per-session actions: edit duration, delete (with confirmation)

---

## 7. Focus Planner

- Full calendar overlay (week + day view, grid or list)
- Drag to create blocks, drag to reschedule
- **Block fields**: focus area, label (optional), start time, sessions count, path (optional), reminder minutes
- Block duration auto-calculated from session settings
- Active hours range configurable (default 8am–10pm), full 24h toggle
- **Block reminders**: browser notification N minutes before start (default 10m)
- Planned vs. actual layers visible simultaneously; filter: All / Planned / Actual

---

## 8. Paths

- Learning paths: name, description, deadline (date), color (7 options)
- Attach planned blocks to a path
- Auto-archive when deadline passes
- Filterable in planner sidebar

---

## 9. Focus Areas

- Fields: name, category, color
- 7 default categories: Education, Health, Home, Work, Creative, Leisure, Uncategorized
- Inline edit, soft delete, bulk management mode, search

---

## 10. Focus Plan (Aims)

- Set a target: focus area + minutes + deadline
- Deadline options: Infinite · Today · Tomorrow · End of Week · Custom
- Progress tracked against completed sessions
- "Go Again" to renew a completed aim

---

## 11. Gamification

### XP & Levels
- 1 XP = 1 minute focused
- Level threshold = level × 1000 XP

### Ranks
| Level | Rank |
|---|---|
| 1 | Novice |
| 5 | Focused |
| 10 | Deep Worker |
| 20 | Flow State |
| 35 | Master |
| 50 | Zen Architect |

### Achievements
| Badge | Condition | Hidden? |
|---|---|---|
| 🌱 First Steps | Complete first session | No |
| 🔥 Habitual | 3-day focus streak | No |
| 🌊 Deep Diver | 10 hours total (600 XP) | No |
| 📐 Architect | 10 unique focus area targets | No |
| 📤 Socialite | Share progress | No |
| 👑 Unstoppable | 100 hours total (6000 XP) | No |
| 🦉 Night Owl | Session between 12am–4am | Yes |
| 🌅 Early Bird | Session started before 6am | Yes |

---

## 12. Settings

| Tab | Key options |
|---|---|
| **Time** | Focus/break durations, sessions per cycle, after-session mode (wait / break / focus), still-focusing check interval (1h–3h, visible only when mode is `focus`), active hours, pause music on break |
| **Sound** | Volume (0–100%), test sound, notification permission, test notification |
| **Music** | Track selector (from Supabase), pause on break |
| **Share** | 4 templates: Intent, Session, Milestone, Mood. Variables: `{focusArea}`, `{duration}`, `{time}`, `{xp}`, `{avatar}`, `{mood}` |
| **Notifications** | Permission request, reminder minutes |
| **Data** | Export (JSON), Import (JSON) — *Danger Zone*: Restore Default Areas, Reset Stats, Delete History (Last 7d / 30d / All) |

---

## 13. Data & Sync

### Storage
All data persists in a local SQLite database (OPFS, Web Worker). `localStorage` is used only for small ephemeral values (device ID, sounds cache, sidenav state).

### Tables
| Table | Synced |
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

All deletes are **soft** (`is_deleted` + `deleted_at`).

### Cloud Sync (Supabase)
- Auth: Google OAuth or magic link
- Delta sync every 30s using `last_pulled_at`
- Outbox pattern via `sync_log` table
- Row Level Security enforces per-user data isolation
- App is fully functional offline; sync is additive

### 4 AM Rollover
Sessions before 4:00 AM count toward the previous calendar day.

---

## 14. Notifications

### In-app
- Notification panel with type badges (success, warning, info, milestone)
- Persisted to DB, synced to cloud

### Browser (Notification API)
- Block reminders (N minutes before planned block start)
- Session completion / milestone / achievement unlocks
- Permission requested via Settings → Sound

---

## 15. Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Start / pause timer |
| `R` | Reset timer |
| `N` | Skip session |
| `G` | Toggle Focus Areas panel |
| `P` | Toggle Focus Planner |
| `1` | Focus mode |
| `2` | Short Break mode |
| `3` | Long Break mode |

---

## 16. Key Design Decisions

| Decision | Rationale |
|---|---|
| **Red = Focus, Green = Break** | Ring colors are reserved, never repurposed for other UI states |
| **4 AM rollover** | Late-night sessions shouldn't inflate next day's count |
| **No bundler** | ES modules work directly; dev server required only for COOP/COEP headers |
| **SQLite over localStorage** | Relational queries, soft deletes, sync-ready schema |
| **Web Worker timer** | Accurate countdown even when tab is backgrounded |
| **fetch→blob audio** | `<audio src="supabase-url">` is blocked by COEP; fetch→blob bypasses it |
| **Supabase is optional** | App works fully offline; auth is a sync mechanism, not a gate |
| **Soft deletes everywhere** | Enables conflict-free sync across devices |
| **Sounds table in DB** | New tracks added without code changes — insert row + upload MP3 |
