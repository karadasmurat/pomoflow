# PomoFlow - Agent Instructions

## Project Overview

PomoFlow is a single-page Pomodoro timer web application with task tracking and session history. Built with vanilla HTML, CSS, and JavaScript.

## File Structure

- **index.html** - Main HTML structure
- **styles.css** - All CSS styling (dark/light theme support)
- **app.js** - All JavaScript logic

## Running the App

Simply open `index.html` in a browser. No build step or server required.

## Key Features

- Pomodoro timer with work/short break/long break modes
- **Twin Countdown Rings**: The play button of the active task contains a mini circular progress ring that mirrors the main timer's state, color, and progress.
- Task list with time tracking per task
- Session history with filtering (Today/This Week/All)
- Dark/light theme toggle
- Settings persistence via localStorage
- Export/Import data (JSON backup)
- Custom confirmation modals
- Task slide animations

## CSS Variables

Key CSS variables in `:root`:
- `--font-time` - Font for timer and time displays (defaults to Roboto)
- `--font-sans` - UI font (DM Sans)
- `--font-mono` - Monospace font (JetBrains Mono)

To change time-related fonts, update `--font-time` in styles.css.

## Data Storage

All data stored in localStorage:
- `flowtracker_tasks` - Task list
- `flowtracker_sessions` - Session history
- `flowtracker_settings` - User preferences
- `flowtracker_state` - Timer state
- `theme` - Theme preference (dark/light)

## Common Tasks

### Mobile Browser Compatibility
The app must work on mobile browsers (iOS Safari, Chrome on Android). Always use feature detection:

```javascript
// Notification API
if (typeof Notification !== 'undefined') { ... }

// AudioContext
if (typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined') { ... }
```

Never assume an API exists - always check `typeof` first.

### Adding a new feature
1. UI: Add HTML to index.html, CSS to styles.css
2. Logic: Add JavaScript functions to app.js
3. Connect: Add event listeners in setupEventListeners()

### Theme support
- Dark theme is default via CSS :root variables
- Light theme via [data-theme="light"] selector override
- Theme toggle in header (themeToggle button)

### Modifying timer behavior
- Timer logic in app.js: startTimer(), pauseTimer(), completeSession()
- Duration settings in state.settings
- **Syncing Mini Rings**: The `updateTimerDisplay` function must calculate `strokeDashoffset` for both the main ring and any active task rings (using `.taskRing-${taskId}` selector).

### Modifying history/charts
- renderHistory() handles session list
- renderChart() handles pie/bar charts
- Filter: 'today', 'week', 'all'

### Export/Import Data
- exportData() - Downloads JSON backup
- handleImportFile() - Handles file import
- performImport(mode) - 'replace' or 'merge' mode
- Uses custom confirm() async function for user confirmations

### Custom Confirm Modal
- confirm(message) - Async function that returns Promise<boolean>
- Opens modal, waits for user response
- Used in deleteTask() and clearHistory()

### List Animations & Visual Feedback
All list-based UI (tasks, sessions, history) should provide visual feedback when items are created or removed:

- **Create**: Use `slide-in` and `highlight` classes to animate new items with slide + flash effect
- **Remove**: Use `slide-out` class to animate items sliding out to the right
- **300ms animation duration** (slide), **500ms** (highlight)
- **Auto-scroll**: When a new item is created (e.g., session completed), scroll it into view with `scrollIntoView({ behavior: 'smooth', block: 'center' })`
- **State tracking**: Use `lastSessionId` / `lastTaskId` in state to track newly created items, then clear after rendering

### Swipeable List Pattern (Sliding Menu)
Both task list and session history use a two-layer swipeable pattern:

**HTML Structure**:
```html
<div class="item-container">
    <div class="slide-wrapper">
        <!-- Front content: task info or session details -->
        <button class="more-btn">...</button>
    </div>
    <div class="menu-layer">
        <!-- Back layer: action buttons (Edit, Delete, etc.) -->
        <button>Edit</button>
        <button>Delete</button>
    </div>
</div>
```

**CSS Requirements**:
- Container: `position: relative`, `overflow: hidden`
- Slide wrapper: `position: absolute`, `z-index: 2`, full size
- Menu layer: `position: absolute`, `z-index: 1`, behind wrapper
- On `.menu-open .slide-wrapper`: `transform: translateX(-Npx)` where N = menu button widths + gaps
- Menu layer must extend far enough right to be revealed when wrapper slides

**JavaScript**:
- `toggleMenu(id)` - Opens/closes menu, closes other open menus
- Click outside container closes menu
- Use `event.stopPropagation()` on buttons to prevent menu close

**Task-specific**:
- Play button is INSIDE the slide-wrapper so it slides with the content
- Calculate slide distance: 3 buttons × 50px + gaps ≈ 160px

### Utility Functions
Key helper functions used throughout the app:

- `escapeHtml(str)` - Prevents XSS by escaping HTML entities in user-generated content
- `formatTime(seconds)` - Formats seconds into MM:SS or HH:MM:SS
- `formatTimestamp(isoString)` - Formats ISO date string to readable time
- `saveData()` - Persists all state to localStorage
- `loadData()` - Loads state from localStorage on app init
- `setupEventListeners()` - Binds all event listeners (called at init)
- `editTask(taskId)` - Opens modal for task name editing
- `toggleTaskMenu(taskId)` - Opens sliding action menu for tasks
- `toggleSessionMenu(sessionId)` - Opens sliding action menu for sessions
- `editSession(sessionId)` - Opens modal for session duration editing
- `confirm(message)` - Async function for custom confirmation dialogs

### Notifications & Audio
Audio and system notification handling:

- `playNotificationSound()` - Plays notification sound using AudioContext (handles missing API)
- `sendNotification(session)` - Sends browser notification with session details
- Notification permission is requested on first timer start
- Always check `typeof Notification !== 'undefined'` before using

### State Structure
The main state object in app.js:

```javascript
let state = {
    tasks: [],           // Array of task objects
    sessions: [],       // Array of completed session objects
    settings: {         // User preferences
        workDuration: 25,
        shortBreakDuration: 5,
        longBreakDuration: 15,
        sessionsBeforeLongBreak: 4,
        autoStartBreaks: false,
        autoStartWork: false,
        soundVolume: 70,
        use12Hour: false
    },
    currentTask: null,  // Currently selected task ID
    timerState: {       // Timer state
        mode: 'work',   // 'work', 'shortBreak', 'longBreak'
        isRunning: false,
        remainingTime: 1500,
        totalTime: 1500,
        sessionCount: 0,
        startTime: null,
        activeTaskId: null
    },
    notificationPermission: 'default',
    lastSessionId: null, // For session animation tracking
    lastTaskId: null    // For task animation tracking
};
```

### Data Migration
Data versioning to handle schema changes:

- `CURRENT_VERSION` - Current data schema version (currently 1)
- Migration logic runs in `loadData()` if stored version < CURRENT_VERSION
- Future changes should increment CURRENT_VERSION and add migration cases

### Accessibility
ARIA attributes and accessibility best practices:

- Use `aria-live="polite"` for dynamic content updates (timer, notifications)
- Ensure keyboard navigation for all interactive elements
- Focus management for modal dialogs
- Icon-only buttons must have aria-label

## Development Guidelines

### Design Consistency
Maintain a unified look and feel across all interactive components:
- **Component Height**: Use a fixed height of `42px` for standard input-row elements (like the task textarea/input and its associated "+" add button) to ensure perfect vertical alignment and generous touch targets.
- **Border Radius**: Use a matching `10px` border-radius for these elements to create a consistent, modern visual language.
- **Interactive Feedback**: Interactive elements should use `scale(1.12)` on hover and `scale(0.92)` on active via `cubic-bezier(0.4, 0, 0.2, 1)`.

### Calculate, Don't Guess
Always derive values from actual requirements/measurements rather than guessing:

- **CSS**: If buttons are 32px + 8px gap + 12px padding = 52px minimum, calculate slide distance accordingly
- **JavaScript**: Calculate timeouts, array indices, loop counts from data, not arbitrary numbers
- **General**: Any numeric value in code should be based on measurable requirements

Always test the result to verify the calculation is correct before considering it done.
