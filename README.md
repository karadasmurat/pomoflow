# PomoFlow

A minimalist, privacy-focused Pomodoro timer built for focus and intent. PomoFlow helps you track your deep work sessions with wall-clock accuracy and daily planning.

## Features

### Timer & Smart Flow

- **Accurate Tracking** - Uses target end times to ensure your timer stays accurate even when the tab is in the background or the device sleeps.
- **Dynamic Guidance** - Context-specific post-session messages (e.g., "Let's start a break!" or "Let's start a long break!") guide you through your cycle.
- **Intentional Transitions** - The timer stays at `0:00` after a session finishes, allowing you to breathe and choose when to start the next phase.
- **Smart Auto-Advance** - Optional automatic transition between focus and break sessions via settings.
- **Visual Progress Ring** - Animated circular progress indicator synchronized with active goals.
- **Audio Notifications** - Subtle tone and push notifications when sessions complete.

### Intent & Planning

- **Daily Aims** - Decoupled daily targets that let you plan your focus time fresh each day.
- **Contextual Prompting** - Conversational "What are you focusing on?" interface encourages goal attribution.
- **Progress Visualization** - Today-only progress bars on goal cards and a main HUD to track budget vs. actual.
- **Date-Aware Tracking** - Intelligent "Logical Day" handling (4 AM rollover) ensures night-owl sessions are attributed correctly.

### Goal Management

- **Goal Tracking** - Create, edit, complete, and delete goals.
- **Multi-Goal Support** - Flexible selection UI showing single names or "x Goals Selected" for batch planning.
- **Time Attribution** - Track focused time spent on each goal with visual totals and progress rings.
- **High-Contrast Palette** - Distinct colors designed for clarity and focus.

### Analytics & History

- **Session History** - Detailed history of focus sessions filtered by Today/Week/All.
- **Session Editing** - Correct unintended logs or adjust durations after the fact.
- **Focus Stats** - Track today's focus time, session counts, and day streaks.
- **Visual Charts** - Pie chart for daily goal breakdown.

### Experience

- **Modern UI** - Clean, responsive design with a refined "Pill/Tag" aesthetic.
- **Theming** - Light and Dark modes that respect your system preferences.
- **Privacy Focused** - All data is stored locally in your browser's `localStorage`. No accounts, no tracking.

## Keyboard Shortcuts

| Key     | Action                |
| ------- | --------------------- |
| `Space` | Start/Pause timer     |
| `R`     | Reset current session |
| `N`     | Skip to next session  |
| `G`     | Toggle Goals drawer   |
| `P`     | Toggle Plan drawer    |
| `1`     | Switch to Focus mode  |
| `2`     | Switch to Short Break |
| `3`     | Switch to Long Break  |

## Getting Started

1. Open `index.html` in any modern browser.
2. Add a goal you want to work on in the **Goals** section.
3. Link your current session to a goal using the **[+ Goal]** button.
4. Start your focus session and earn XP.

## License

MIT
