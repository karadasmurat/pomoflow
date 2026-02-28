# Architecture & Design Standards

This document outlines the technical structure and design principles of PomoFlow to ensure consistency and maintainability.

## 1. State Management

PomoFlow uses a single, centralized `state` object in `app.js` to manage the application's lifecycle.

### Data Persistence
- **Storage:** All data is persisted in `localStorage` using the `flowtracker_` prefix.
- **Syncing:** The state is saved to storage on every major event (timer start/pause, goal completion, settings change) and periodically every 10 seconds during an active session.
- **Initialization:** The `init()` function handles the restoration of state, including re-calculating remaining time if the page was refreshed while a timer was running.

## 2. Timer Logic

The timer follows a "Station" based cycle rather than a simple count.

- **`cycleStation` (1-4):** Tracks the current position within a focus block. 
- **Auto-Advance:** When a focus session completes, the system automatically suggests a break based on the `cycleStation`:
    - Stations 1, 2, 3 -> Short Break.
    - Station 4 -> Long Break.
- **`sessionCount`:** A persistent lifetime total of completed focus sessions.

## 3. Design Constraints (CRITICAL)

To maintain visual clarity and brand identity, the following constraints must be strictly followed:

### Reserved Session Colors
- **Focus Mode:** Red (`--danger`) is reserved exclusively for the Focus session rings and high-priority alerts.
- **Break Mode:** Green (`--success`) is reserved exclusively for Break session rings and completion states.
- **Requirement:** No UI accents, goal colors, or icons should use these specific shades of red or green to avoid confusion with the session state.

### Terminology Standard
- **"Goal" over "Task":** The application uses intentional phrasing to encourage productivity. Use "Goal", "Daily Goals", or "Set a session goal" instead of "Task" in all user-facing strings.

## 4. UI Standards

### Button Hierarchy
- **Primary Controls (Start/Pause):** Height: 52px, Width: 100px. Vertical layout (icon top, text bottom).
- **Secondary Controls (Reset/Skip):** Height: 52px, Width: 60px. Vertical layout.
- **Utility Buttons (Filters, Clear All, Tasks):** 
    - **Height:** 30px (Strict)
    - **Font Size:** 13px
    - **Border Radius:** 8px
    - **Background:** Transparent (standard) or `var(--surface-elevated)` (hover).

### Goal Visuals
- **Color Palette:** Goals must use the high-contrast 8-color palette (Blue, Sky Blue, Indigo, Violet, Pink, Vivid Orange, Bright Yellow, Slate) to ensure accessibility and distinction.
- **Truncation:** Goal names use `text-overflow: ellipsis` but must **never** hide the "NEW" badge if it is present.

## 5. File Structure

- `index.html`: Skeleton and Modal definitions.
- `js/app.js`: All logic, including timer, state, and DOM manipulation.
- `css/styles.css`: All styling, utilizing CSS variables for theme support.
- `assets/`: Media and static assets.
- `about.html`: Static documentation for users.
