# PomoFlow - Agent Instructions

This document provides context and guidelines for AI agents working on the PomoFlow codebase.

## 1. Project Philosophy

- **Simplicity First**: Avoid external dependencies unless absolutely necessary. Stick to vanilla JS, HTML, and CSS.
- **Visual Fidelity**: Every interaction should feel polished. Use CSS transitions and transformations for high-quality feedback.
- **User Privacy**: All data stays on the user's device via `localStorage`.

## 2. Technical Stack Context

- **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3.
- **Storage**: `localStorage` with a simple versioned schema.
- **State Management**: Reactive UI updates through centralized `render` functions triggered by state changes.

## 3. UI/UX Standards

### Geometry & Sizing
- **Interactive Rows**: Elements like the task input wrapper, add button, and color picker MUST share a height of `42px` and a border-radius of `10px`.
- **Spacing**: Use `16px` gaps between panels and `24px` padding inside cards.

### Visual Feedback
- **Transitions**: Use `cubic-bezier(0.4, 0, 0.2, 1)` for all transitions.
- **Hover/Active**: Apply `scale(1.12)` on hover and `scale(0.92)` on active states for precision feedback.
- **Color Transitions**: Ensure `-webkit-autofill` backgrounds are overridden for both `var(--surface-elevated)` and `var(--bg)` states to maintain theme consistency.

### Ring Geometry
- **Main Ring**: Radius `r=45`, Circumference `282.7`.
- **Mini Task Rings**: MUST mirror the main ring's `stroke-dashoffset` logic and color. Selector pattern: `#taskRing-${id}`.

## 4. Terminology & Formatting

### Labels
- **Handled Tasks Section**: Use "Check off time" as the header for completed/archived tasks.
- **History Header**: Use "CHECKED OFF AT" for the session completion timestamp column.

### Data Display
- **Task Duration**: Display on task cards MUST follow the zero-padded `Total: HH:MM` format. Do NOT use terms like "focused" or "mins".

## 5. Development Workflow

- **Atomic Changes**: Break down large UI updates into smaller, verifiable tool calls.
- **Cross-File Integrity**: Always update `SPEC.md` and related tests when modifying core functionality or terminology.
- **Mobile First**: Verify all changes against the mobile layout (stacked columns) and touch target sizes (min 44x4px).

## 6. Known Patterns

- **Notification Prompt**: Tracked via `flowtracker_notification_prompt` in `localStorage`.
- **Session Splitting**: If the timer is running and the user switches tasks, save the current session progress to the old task before starting the new one.
