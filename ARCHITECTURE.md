# Architecture & Design Standards

This document outlines the technical structure and design principles of PomoFlow to ensure consistency and maintainability.

## 1. State Management

PomoFlow uses a single, centralized `state` object in `app.js` to manage the application's lifecycle.

### Data Persistence
- **Storage:** All data is persisted in `localStorage` using the `flowtracker_` prefix.
- **Syncing:** The state is saved to storage on every major event (timer start/pause, goal completion, settings change) and periodically during an active session.
- **Initialization:** The `init()` function handles the restoration of state, including re-calculating remaining time if the page was refreshed while a timer was running.

## 2. Timer Logic & Session Transitions

The timer follows a "Station" based cycle and prioritizes user intent during transitions.

- **`cycleStation` (1-4):** Tracks the current position within a focus block. 
- **Dynamic Guidance:** Upon completion or skip of a running session, the UI displays a context-specific message (e.g., "Let's start a long break!") based on the current station.
- **Intentional 0:00 State:** When a session finishes, the timer stays at `0:00` while the guidance message is visible. This prevents jarring jumps to the next duration and lets the user manually initiate the next phase.
- **Logical Day Rollover:** All daily stats and history filters use a 4:00 AM rollover. This ensures that sessions completed after midnight but before 4 AM are correctly attributed to the previous day's effort.

## 3. Daily Planning & Aims

PomoFlow implements an intent-first planning model where daily targets are decoupled from static goal definitions.

- **`state.aims`**: A collection of objects containing `goalId`, `date` (YYYY-MM-DD), and `targetMinutes`.
- **Progress Calculation:** Progress is calculated by comparing total session duration against the resolved daily aim for the logical date.
- **Multi-Selection UI:** The planning interface supports selecting multiple goals simultaneously, displaying a count (e.g., "3 Goals Selected") or a single name for clarity.

## 4. UI Standards

### Visual Hierarchy
- **Primary Controls:** Rounded vertical buttons for high-frequency actions (Start/Pause, Reset, Skip).
- **Secondary Actions:** Sleek, pill-shaped buttons with a 1px border, matching the `clear-all-btn` aesthetic (30px height, 13px font).
- **Conversational UX:** Use of uppercase slot labels (e.g., "WHAT ARE YOU FOCUSING ON?") to provide context for interactive elements.

### Reserved Session Colors
- **Focus Mode:** Red (`--danger`) is reserved for Focus session rings.
- **Break Mode:** Green (`--success`) is reserved for Break session rings.
- **Requirement:** No UI accents or goal colors should use these specific shades to avoid confusion.

## 5. File Structure

- `index.html`: Main application skeleton and modern modal definitions.
- `js/app.js`: Central logic, including timer, state management, and "Logical Day" calculations.
- `js/components/`: Modular UI elements like `progress-pill` and `progress-compact`.
- `css/styles.css`: All styling, utilizing CSS variables for theme support and shared button aesthetics.
- `about.html`: Static documentation for users.
