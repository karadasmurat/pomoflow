# Architecture & Design Standards

This document outlines the technical structure and design principles of PomoFlow to ensure consistency and maintainability.

## 1. Modular Architecture

PomoFlow has transitioned from a monolithic `app.js` to a modular architecture using ES Modules to improve maintainability and performance.

### Core Modules
- **`js/state/store.js`:** The single source of truth for the application state (`state` object) and global constants. It exposes reactive state mutations.
- **`js/engine/timer.js`:** A dedicated `TimerEngine` class that encapsulates the Web Worker, AudioContext, and time calculation logic.
- **`js/app.js`:** The central controller that coordinates between the State, the Engine, and the UI.

## 2. State Management & Persistence

### Data Persistence (SQLite First)
- **Primary Storage:** All data (Tasks, Sessions, Aims, Settings, User Profile) is persisted in a local **SQLite database** using the **Origin Private File System (OPFS)**.
- **No LocalStorage:** `localStorage` has been deprecated and is no longer used for storing application data. It is only accessed during a one-time migration for legacy users.
- **Web Worker:** Database operations run in a dedicated worker (`js/db-worker.js`) to keep the UI thread responsive.
- **Cross-Origin Isolation:** The application requires `COOP` and `COEP` headers (provided by `coi-serviceworker.js` on GitHub Pages or `dev-server.js` locally) to enable `SharedArrayBuffer` for SQLite.

## 3. Timer Logic & Session Transitions

The timer logic is encapsulated in `js/engine/timer.js`.

- **`TimerEngine`:** Manages the tick loop via a Web Worker to ensure accuracy even when the tab is backgrounded.
- **`cycleStation` (1-4):** Tracks the current position within a focus block.
- **Dynamic Guidance:** Upon completion or skip of a running session, the UI displays a context-specific message (e.g., "Let's start a long break!") based on the current station.
- **Intentional 0:00 State:** When a session finishes, the timer stays at `0:00` while the guidance message is visible.

## 4. Logical Day & Planning

PomoFlow implements an intent-first planning model.

- **Logical Day Rollover:** All daily stats and history filters use a 4:00 AM rollover. This ensures that sessions completed after midnight but before 4 AM are correctly attributed to the previous day's effort.
- **`state.aims`**: A collection of objects containing `goalId`, `date` (YYYY-MM-DD), and `targetMinutes`.

## 5. UI Standards

### Visual Hierarchy
- **Primary Controls:** Rounded vertical buttons for high-frequency actions (Start/Pause, Reset, Skip).
- **Secondary Actions:** Sleek, pill-shaped buttons with a 1px border, matching the `clear-all-btn` aesthetic (30px height, 13px font).
- **Conversational UX:** Use of uppercase slot labels (e.g., "WHAT ARE YOU FOCUSING ON?") to provide context for interactive elements.

### Reserved Session Colors
- **Focus Mode:** Red (`--danger`) is reserved for Focus session rings.
- **Break Mode:** Green (`--success`) is reserved for Break session rings.

## 6. File Structure

- `index.html`: Main entry point, loads `app.js` as a module.
- `coi-serviceworker.js`: Enables cross-origin isolation for SQLite on GitHub Pages.
- `dev-server.js`: Local Node.js server for development.
- `js/`
  - `app.js`: Main controller.
  - `db.js` & `db-worker.js`: SQLite database interface and worker.
  - `state/`: Core state management (`store.js`).
  - `engine/`: Logic engines (`timer.js`).
  - `components/`: Modular UI elements (`progress-pill.js`, etc.).
- `css/styles.css`: All styling, utilizing CSS variables.
