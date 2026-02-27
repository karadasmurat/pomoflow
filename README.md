# PomoFlow

A beautiful Pomodoro-style timer with task tracking, session history, and focus analytics.

## Features

### Timer

- **Pomodoro Timer** - Focus sessions with short (5 min) and long (15 min) breaks
- **Twin Progress Rings** - Real-time synchronization between the main timer and the active task's play button
- **Customizable Durations** - Adjust focus/break times to fit your workflow
- **Smart Auto-Advance** - Automatically transition between focus and break sessions
- **Visual Progress Ring** - Animated circular progress indicator
- **Audio Notifications** - Subtle sound when sessions complete

### Task Tracking

- **Task Management** - Create, edit, complete, and delete tasks
- **Time Tracking** - Track focused time spent on each task with visual totals
- **Quick Controls** - Play/pause timer directly from task items
- **Sliding Menu** - Edit task name, complete, or delete via sliding action menu
- **Session History** - View completed sessions with charts filtered by Today/This Week/All
- **Session Editing** - Adjust duration or correct unintended logs after completion

### Focus Analytics

- **Today's Focus Time** - Total time spent in focus sessions
- **Sessions Completed** - Number of focus sessions done today
- **Day Streak** - Consecutive days with completed focus sessions
- **Visual Charts** - Bar chart for weekly overview, pie chart for today's task breakdown

### Design & Experience

- **Modern UI** - Clean, consistent design following modern CSS principles
- **Unified Design Standards** - Harmonized input heights (42px) and rounded corners (10px) across all interactive elements
- **Tactile Feedback** - Interactive scale (1.12x) and active states (0.92x) using precision cubic-bezier timing
- **Dark/Light Mode** - Toggle between themes with persistent preference

### Keyboard Shortcuts

| Key     | Action                |
| ------- | --------------------- |
| `Space` | Start/Pause timer     |
| `R`     | Reset current session |
| `N`     | Skip to next session  |
| `1`     | Switch to Focus mode  |
| `2`     | Switch to Short Break |
| `3`     | Switch to Long Break  |

## Getting Started

1. Open `index.html` in any modern browser
2. Add tasks you want to work on
3. Click the play button on a task to start tracking
4. Focus until the timer completes

## Browser Support

- Chrome/Edge 80+
- Firefox 75+
- Safari 14+

## Data Storage

All data is stored locally in your browser using localStorage:

- Tasks and time tracking
- Session history
- User preferences
- Timer state (survives page refresh)
- Theme preference

## License

MIT
