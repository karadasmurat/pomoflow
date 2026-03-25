# Focus Planner: Onboarding Aid Plan

## Philosophy
Contextual, just-in-time hints — not a modal wizard. Show guidance exactly where the user needs it, dismiss when they take the action.

---

## Trigger Conditions
- **Empty state**: No blocks exist when planner opens → show full onboarding hints
- **Partial state**: Has areas but no blocks → show calendar hints only
- **Returning user**: Never show again once ≥1 block has been created (persisted via an `onboarding_done` flag in state)

---

## Three Phases of Hints

### Phase 1 — Empty sidebar (no focus areas exist)
- Sidebar shows existing `sidebar-areas-empty` text, enhanced with an animated arrow pointing to `+ New` / `Create area` button
- Message: "Add a focus area to get started"

### Phase 2 — Has areas, no blocks (the main onboarding moment)
This is where drag-to-calendar is the key action to teach.

| Platform | Gesture | Hint |
|----------|---------|------|
| Desktop | Drag area card → calendar column | Pulsing arrow from sidebar → calendar + text "Drag to schedule" |
| Mobile | Tap area card | Pulse on area card + "Tap to schedule a session" |

The calendar columns get a subtle dashed-border highlight with a `+` drop zone indicator when the user hovers/touches a sidebar area card.

### Phase 3 — First block created (contextual micro-hints, one-time each)
- **Click-drag to create**: hint appears below the time header once, then dismisses after the first drag-create action
- **Path assignment**: subtle badge on the block popover's path selector if user hasn't used it yet

---

## Implementation Approach

### Data model
Single `onboarding` key in `state` (not persisted to DB — resets on refresh are fine):

```js
state.onboarding = {
  hasCreatedBlock: false,   // set true after first block save
  hasDragCreated: false,    // set true after first drag-create
  dismissed: false          // set true if user clicks ×
}
```

### Leverage existing CSS
`.area-drag-hint`, `.sidebar-areas-hint`, `.creation-chip-hint` are already defined in the stylesheet but never activated — enable them conditionally in `renderSidebar()` and `renderBody()`.

### New elements needed
1. **Drag-target highlight** on `.day-col` when dragging starts from sidebar (add `.drop-hint` class)
2. **Animated arrow overlay** (CSS-only, positioned absolutely) between sidebar and first calendar column
3. **Mobile tap-pulse** (`@keyframes`) on area cards

---

## What We're NOT Building
- No modal/overlay tutorial wizard
- No step-by-step "Next →" flows
- No persistent tooltip library
- No backend tracking of onboarding state

---

## Scope Estimate
- ~150 lines of JS (state checks + class toggles)
- ~80 lines of CSS (animations + hint styles)
- No new files — changes go in `planner.view.js` and `app.html` inline style
