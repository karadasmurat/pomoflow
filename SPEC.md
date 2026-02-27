# PomoFlow - Specification

## 1. Project Overview

- **Project Name**: PomoFlow
- **Type**: Single-page web application (HTML/CSS/JS)
- **Core Functionality**: A Pomodoro-style timer with task tracking, session history, and task management
- **Target Users**: Professionals, students, and anyone needing focused time tracking

## 2. UI/UX Specification

### Layout Structure

- **Header**: App logo/title, date/time, theme toggle, settings button
- **Main Content**: Three-column layout on desktop, stacked on mobile
  - Left: Task list panel
  - Center: Timer display and controls
  - Right: Session history panel
- **Responsive Breakpoints**:
  - Mobile: < 768px (single column, stacked)
  - Tablet: 768px - 1024px (two columns)
  - Desktop: > 1024px (three columns)

### Visual Design

**Color Palette (Dark Theme)**:
- Background: `#0d1117` (deep night)
- Surface: `#161b22` (card background)
- Surface Elevated: `#21262d` (hover states)
- Primary: `#58a6ff` (blue accent)
- Success: `#3fb950` (green - focus sessions)
- Warning: `#d29922` (amber - break sessions)
- Danger: `#f85149` (red - stop/delete)
- Text Primary: `#f0f6fc`
- Text Secondary: `#8b949e`
- Border: `#30363d`

**Color Palette (Light Theme)**:
- Background: `#ffffff`
- Surface: `#f6f8fa`
- Surface Elevated: `#eaeef2`
- Primary: `#0969da`
- Success: `#1a7f37`
- Warning: `#9a6700`
- Danger: `#cf222e`
- Text Primary: `#1f2328`
- Text Secondary: `#656d76`
- Border: `#d0d7de`

**Typography**:
- Font Family: `'Roboto', sans-serif` for timer and time displays, `'DM Sans', sans-serif` for UI, `'JetBrains Mono', monospace` for code/data
- Timer Display: 64px, light weight (300), Roboto
- Headings: 20px, semibold
- Body: 14px, regular
- Small: 12px

**Spacing & Sizing System**:
- Base unit: 8px
- Card padding: 24px
- Gap between elements: 16px
- Section margins: 32px
- **Standard Row Height**: Interactive input rows (like the task input) use a fixed height of `42px`.
- **Standard Corner Radius**: Interactive row elements use a `10px` border-radius.

**Visual Effects**:
- Cards: `box-shadow: 0 8px 24px rgba(0,0,0,0.4)`
- Buttons: subtle glow on hover using box-shadow
- Timer: pulsing animation when running
- Task animations: slide-in for new tasks, slide-out for deleted tasks
- Empty task input: shake animation when submitting without text
- Transitions: 200ms ease for all interactive elements
- **Precision Feedback**: `scale(1.12)` on hover and `scale(0.92)` on active via `cubic-bezier(0.4, 0, 0.2, 1)`

### Components

**Timer Display**:
- Large circular progress ring (SVG)
- Time in MM:SS format centered (Roboto font)
- Current task indicator above timer: "Current Focus: [task name]" when task selected
- "Focus mode - select a task" when timer running without task
- Current mode indicator (Focus/Short Break/Long Break)
- Session count indicator (e.g., "Session 2 of 4")

**Timer Controls**:
- Start/Pause button (primary action)
- Stop/Reset button (secondary)
- Skip button (skip to next session)
- Mode selector tabs (Focus | Short Break | Long Break)

**Task List**:
- Add task input with "+" button
  - Both elements share `42px` height and `10px` border-radius for design consistency.
- Task items with:
  - Play button with **Twin Countdown Ring**: A mini SVG ring that mirrors the main timer's progress and color state.
  - Task name + total time
  - Swipe left to reveal menu: Edit | Done/Undo | Delete
- Inline task name editing: click edit in menu to modify name
- Active task highlight with primary color border
- Completed tasks moved to separate "Completed" section below active tasks
- Completed tasks have strikethrough on name

**Session History**:
- Visual chart (pie chart for Today, bar chart for Week/All)
- List of completed sessions with:
  - Task name
  - Duration in mm:ss format
  - Relative timestamp (Today/Yesterday/date)
  - Sliding menu with Edit/Delete buttons
- Edit via modal: click edit to open modal dialog to change minutes (1-480), saves to task totals
- Filter by: Today (default), This Week, All
- Sessions from deleted tasks are filtered out
- Clear history button

**Settings Panel**:
- Modal with Save button
- Sliders for durations
- Toggles for auto-start, time format, sound volume
- Data Management section with Export/Import buttons

## 3. Functionality Specification

### Browser Compatibility

**Important**: The app must work on all modern browsers including mobile (iOS Safari, Chrome on Android). Always check for API availability before use:

```javascript
// Always check for API availability
if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    // use Notification API
}

if (typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined') {
    // use Web Audio API
}
```

- Notification API: Check `typeof Notification !== 'undefined'` before using
- AudioContext: Check availability, handle suspended state on mobile
- Use feature detection, not browser detection
- Test on mobile devices before deploying

### Core Features

**Timer**:
- Default durations: Focus 25min, Short Break 5min, Long Break 15min
- Configurable durations via settings
- Auto-start next session option (toggle)
- Audio notification when session ends (subtle beep)
- Browser notification support (with permission)
- Settings panel with configurable durations

### Keyboard Shortcuts
- Spacebar: Start/Pause timer
- R: Reset current session
- N: Skip to next session
- 1/2/3: Switch to Focus/Short Break/Long Break mode

### Streak Definition
- A streak counts as a day with at least one completed focus session
- Streak breaks if no focus sessions completed on a calendar day
- Consecutive days with sessions = streak count

### Pomodoro Cycle
- Default: 4 focus sessions before long break (configurable)
- After 4th focus session → Long Break
- After 1st-3rd focus session → Short Break

### Notification Permission Flow
- Show subtle prompt on first session start to enable notifications
- Gracefully handle denial (audio still works)
- Permission status visible in settings

### Session Splitting
- When switching tasks while timer is running, the current session is saved
- Session is attributed to the task that was active during that time
- Timer resets and continues for the new task
- This ensures accurate time tracking per task

### Export/Import Data
- Export all data (tasks, sessions, settings) to JSON file
- Import with two options:
  - Replace All: Overwrites existing data
  - Merge: Adds new items, skips duplicates

### Custom Confirmation Dialogs
- Async confirm(message) function returns Promise<boolean>
- Consistent styling with app theme
- Used for delete task and clear history actions

### Settings Panel (Modal)
- Work duration: slider (1-60 min, default 25)
- Short break duration: slider (1-30 min, default 5)
- Long break duration: slider (1-60 min, default 15)
- Sessions before long break: number input (1-10, default 4)
- Auto-start breaks: toggle
- Auto-start work sessions: toggle
- Sound volume: slider (0-100, default 70)
- 12h time format: toggle

### Theme Toggle
- Dark theme is default
- Light theme via [data-theme="light"] selector override
- Persisted in localStorage

### Data Persistence

**localStorage Keys**:
- `flowtracker_tasks`: JSON array of task objects
- `flowtracker_sessions`: JSON array of session objects
- `flowtracker_settings`: JSON object of user preferences
- `flowtracker_state`: Current timer state (for resume)
- `flowtracker_version`: Schema version number (current: 1)
- `theme`: Theme preference (dark/light)

**Schema Versioning**:
- Version 1: Initial schema
- On load, check version; if outdated, attempt migration or reset

All data saved to localStorage
- Auto-save on every change
- Load on app start
- On schema version mismatch: attempt migration, fallback to reset with user confirmation

### User Interactions

1. **Starting a session**: Click play on task → Click Start → Timer runs
2. **Completing a session**: Timer reaches 0 → Notification → Session saved to history → Auto-advance to break (if enabled)
3. **Managing tasks**: Type task name → Press Enter or click Add → Task appears in list → Click to select as active

### Edge Cases

- Timer running when tab is closed: Save state (timestamp, remaining time), resume on return
- No task selected: Allow timing but mark as "Untracked"
- Empty task name: Prevent creation, show validation
- Deleting active task: Stop timer, deselect
- Multiple sessions complete while tab backgrounded: Queue notifications, record each session
- Notification permission denied: Fall back to audio-only
- localStorage full: Show warning, suggest clearing old sessions

### Empty States

**No Tasks**:
- Display friendly message: "No tasks yet. Add one above to get started!"
- Icon: Checkbox or list icon

**No Session History**:
- Display: "No sessions recorded. Complete a focus session to see your history."
- Icon: Clock or history icon

**Stats with No Data**:
- Show 0:00 for time, 0 for sessions, "--" for streak

### Accessibility (A11y)

- All buttons have visible focus states (outline matching primary color)
- Timer uses `aria-live="polite"` for screen readers to announce time
- Progress ring has `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`
- Task checkboxes use appropriate markup
- Color is not sole indicator (icons accompany status changes)
- Minimum touch target: 44x44px
- Keyboard navigation: Tab through interactive elements, Enter/Space to activate

## 4. Acceptance Criteria

- [x] Timer displays correctly with progress ring animation
- [x] Start/Pause/Stop controls work correctly
- [x] Timer counts down accurately
- [x] Sessions are recorded in history when timer completes
- [x] Tasks can be created, selected, completed, and deleted
- [x] Active task is visually highlighted
- [x] Time is tracked per task
- [x] Data persists across page refreshes
- [x] Responsive layout works on mobile and desktop
- [x] Visual design matches specification (colors, fonts, spacing)
- [x] Audio notification plays on session complete
- [x] Theme toggle works (dark/light)
- [x] Play/pause timer on tasks
- [x] Charts display in session history
- [x] Twin progress rings implemented and synchronized

## Future Enhancements (Out of Scope for v1)

- **Cloud Integration**: Transition from localStorage to a real-time database (e.g., Supabase, Firebase) for cross-device synchronization.
- **Goal Tracking**: Implement daily/weekly focus goals with progress visualization.
- Different notification sounds
- Drag-to-reorder tasks
- Break timer "walking" suggestion (suggest physical activity during long break)
