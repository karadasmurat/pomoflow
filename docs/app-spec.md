# PomoFlow — App Specification

## Architecture

Vanilla JS SPA, no bundler, ES modules. SQLite via OPFS (Web Worker) for local storage. Supabase optional for cloud sync and auth. No build step — changes take effect on hard refresh.

```
js/
  app.js              # App init, event wiring, auth flow
  db.js + db-worker.js # SQLite via OPFS
  state/store.js      # Single source of truth
  engine/
    timer.js          # Web Worker timer engine
    music.js          # Audio streaming engine
  services/
    history.service.js
    focus.service.js
    sync.service.js
    settings.service.js
    notification.service.js
    timer.service.js
  ui/
    dashboard.view.js
    planner.view.js
    timer.view.js
    focus.view.js
```

---

## Layout

| Breakpoint | Layout |
|---|---|
| ≥1100px (desktop) | Two-column: timer panel sticky left (420px), activity panel fills right. Collapsible sidenav (280px / 56px). |
| 481–1099px (tablet) | Single centered column (max 650px). |
| ≤480px (mobile) | Full-width. Sidenav hidden. Bottom tab bar (5 tabs). |

---

## Timer

- **Modes**: Focus (25m default), Short Break (5m), Long Break (15m) — all configurable
- **Engine**: Web Worker for accuracy when backgrounded
- **Cycle**: 4 focus sessions → 1 long break (configurable)
- **Controls**: play/pause, reset, skip
- **Auto-start**: separate toggles for auto-start breaks and auto-start work
- **Ring**: SVG progress ring — red = focus, green = break (reserved, not repurposed)
- **Context strip**: upcoming planned blocks shown above timer controls
- **Inline stats**: focus time today + session count below the ring
- **Post-session**: stays at 0:00 (intentional breathing room before next cycle)
- **State restoration**: on reload, resumes timer using stored target end time

---

## Music

- Streams MP3s from Supabase Storage via `fetch → blob → objectURL` (bypasses COEP)
- Track list fetched from `sounds` Supabase table — add tracks without code changes
- Cached in `localStorage` for offline / instant startup
- Widget: dark pill with animated disc, prev / play / next controls
- Loading spinner guard prevents pause/skip race condition during download
- "Pause on break" toggle (in Time settings)

---

## Activity Panel

- **Stats cards**: Focus Time, Sessions, Streak — with trend indicators (green up, muted gray down)
- **Focus Distribution**: pie chart + Focus Hero badge (top area by time %)
- **Activity Log** (collapsed by default):
  - Session table: focus area, category, duration, finished time
  - Filters: Today / Week / All
  - Sort: Newest / Oldest
  - Category dropdown filter
  - Pagination: 20 sessions per page
  - Per-session actions: edit duration, delete

---

## Focus Planner

- Full calendar overlay: week view + day view (grid or list)
- Drag to create blocks, drag to reschedule
- **Block properties**: focus area, label, sessions count, start time, path association, reminder minutes
- Active hours range (default 8am–10pm), full 24h toggle
- **Block reminders**: browser notification N minutes before start (default 10m, configurable)

---

## Paths

- Learning paths with: name, description, deadline, color (7 options)
- Associate planned blocks to a path
- Archive on completion or past deadline
- Filterable in the planner sidebar

---

## Focus Areas (Tasks)

- **Properties**: name, category, color
- **7 default categories**: Education, Health, Home, Work, Creative, Leisure, Uncategorized
- Color palette per category (7 colors)
- Soft delete, inline edit, bulk management mode
- Search and filter by name

---

## Focus Plan (Aims)

- Set a target: focus area + target minutes + deadline
- **Deadline options**: Infinite, Today, Tomorrow, End of Week, Custom date
- Progress tracked against actual completed sessions
- "Go Again" to renew a completed aim

---

## Gamification

- **XP**: 1 XP per minute focused
- **Leveling**: threshold = level × 1000 XP
- **Ranks** (by level):

| Level | Rank |
|---|---|
| 1 | Novice |
| 5 | Focused |
| 10 | Deep Worker |
| 20 | Flow State |
| 35 | Master |
| 50 | Zen Architect |

- **Achievements** (8 total, 2 hidden):

| Achievement | Icon | Condition |
|---|---|---|
| First Steps | 🌱 | Complete first session |
| Habitual | 🔥 | 3-day focus streak |
| Deep Diver | 🌊 | 10 total hours (600 XP) |
| Night Owl *(hidden)* | 🦉 | Session between 12am–4am |
| Early Bird *(hidden)* | 🌅 | Session started before 6am |
| Socialite | 📤 | Share progress |
| Architect | 📐 | Reach 10 unique focus area targets |
| Unstoppable | 👑 | 100 total hours (6000 XP) |

- **Persona**: avatar emoji (15 options) + mood text — shown in profile and share templates

---

## Settings

| Tab | Options |
|---|---|
| **Time** | Focus / short break / long break durations, sessions per cycle, auto-start breaks, auto-start work, active hours range, pause music on break |
| **Sound** | Volume slider (0–100%), test sound button, notification permission request, test notification |
| **Music** | Track picker (from Supabase), pause on break toggle |
| **Share** | 4 templates: Intent, Session, Milestone, Mood. Variables: `{focusArea}`, `{duration}`, `{time}`, `{xp}`, `{avatar}`, `{mood}` |
| **Notifications** | Permission request, block reminder minutes |
| **Data** | Export (JSON), Import (JSON), *(Danger Zone)* Restore Default Areas, Reset Stats, Delete History (Last 7 days / Last 30 days / All time) |

---

## Data & Sync

**Database tables** (SQLite, all with soft deletes):

| Table | Purpose |
|---|---|
| `focus_areas` | Tasks with name, color, category, completion |
| `sessions` | Completed focus sessions with XP |
| `planned_blocks` | Scheduled blocks with reminders |
| `paths` | Learning paths with deadlines |
| `aims` | Focus area targets with deadlines |
| `notifications` | In-app notification log |
| `app_state` | Theme, timer state, UI preferences |
| `sync_log` | Pending operations for cloud sync |

- All deletes are **soft** (`is_deleted` + `deleted_at`)
- **4 AM logical day rollover** — sessions before 4am count toward the previous day
- **Supabase sync** (optional): Google OAuth or magic link, delta sync every 30s using `last_pulled_at`
- Fully **offline-capable** — Supabase is additive, not required

---

## Navigation

**Desktop sidenav**: Timer · Activity · Focus Areas · Focus Planner · Focus Plan · Settings · Profile · Theme toggle · Logout

**Mobile bottom tabs**: Timer · Planner · Activity · Paths · Areas

---

## Key Design Decisions

- **Red = Focus, Green = Break** — ring colors are reserved, never repurposed
- **4 AM rollover** — prevents late-night sessions inflating next day's count
- **No bundler** — ES modules loaded directly, dev server required for COOP/COEP headers
- **Supabase is optional** — app works fully offline; cloud sync is opt-in via auth
- **Soft deletes everywhere** — enables sync without conflict
- **Web Worker timer** — accurate countdown even when tab is backgrounded
- **fetch→blob audio** — bypasses COEP restriction on cross-origin audio elements
