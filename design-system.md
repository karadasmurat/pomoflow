# PomoFlow Design System

> Living document — reflects the actual CSS token values in `css/styles.css` and `css/sidenav.css`.

---

## Principles

- **Elevation over decoration.** Depth is communicated through surface color steps, not shadows or gradients.
- **Token-first.** Every color, radius, and font is a CSS custom property. Hardcoded values in rules are a bug.
- **Theme-adaptive.** Every token has both a dark and light value. No component needs to know which theme is active.
- **Minimal noise.** No ambient blobs, no decorative animations on backgrounds. Motion is reserved for meaningful feedback.

---

## Themes

The app ships two themes toggled via `data-theme` on `<html>`.

| Theme | Attribute | Default |
|-------|-----------|---------|
| Dark (Void) | *(no attribute)* | yes |
| Light | `data-theme="light"` | — |

---

## Elevation Scale

The single most important system. Every background in the UI maps to one of these four levels.

| Token | Dark | Light | Used for |
|-------|------|-------|----------|
| `--bg` | `#18181A` | `#F0EFED` | Page canvas, full-height panels, sticky headers |
| `--surface` | `#1F1F22` | `#FAFAF8` | Cards, drawers, modals, side panels |
| `--surface-elevated` | `#26262A` | `#EDECEA` | Inputs, chips, hover fills, nested UI elements |
| `--surface-warning` | `#2d2410` | `#fdf4e0` | Warning-tinted surfaces (milestone toasts, achievement badges) |

### Rules

- A panel or drawer that slides over content uses `--surface` + `border-right: 1px solid var(--border)`. No box-shadow.
- Inputs always use `--surface-elevated`. Focus state changes border-color and adds a glow; background stays `--surface-elevated`.
- Sticky/fixed headers use `--bg` so scrolling content disappears cleanly behind them.

### Compatibility aliases

Two legacy names are kept as aliases for `--surface` so that the shwn. design system files (`base.css`, `app-shwn.css`, `planner.css`) continue to work without modification:

```css
--white:   var(--surface);
--bg-card: var(--surface);
```

New code should always use `--surface` directly.

---

## Color Tokens

### Ink (text)

| Token | Dark | Light | Usage |
|-------|------|-------|-------|
| `--ink` | `rgba(255,255,255,0.92)` | `#1A1917` | Primary text |
| `--ink-mid` | `rgba(255,255,255,0.52)` | `#6B6860` | Secondary text, labels |
| `--ink-soft` | `rgba(255,255,255,0.32)` | `#A8A49E` | Placeholder, disabled, captions |

### Semantic aliases

```css
--text-primary:   var(--ink);
--text-secondary: var(--ink-mid);
--border:         var(--rule);
```

### Rule (dividers & subtle fills)

| Token | Dark | Light |
|-------|------|-------|
| `--rule` | `rgba(255,255,255,0.06)` | `#E2DFD9` |

`--rule` is the same as `--border`. Use `var(--border)` in rules, `var(--rule)` in token definitions.

### Accent

The brand color. Dark uses a forest green; light uses a deeper, more saturated green for accessibility.

| Token | Dark | Light |
|-------|------|-------|
| `--accent` | `#3D8F5A` | `#2D4A3E` |
| `--accent-dim` | `rgba(61,143,90,0.15)` | `#E6EDEA` |

`--accent-dim` is used for selected/active states (e.g. active sidenav item).

### Semantic colors

| Token | Dark | Light |
|-------|------|-------|
| `--primary` | `#58a6ff` | `#0969da` |
| `--success` | `#3fb950` | `#1a7f37` |
| `--warning` | `#d29922` | `#9a6700` |
| `--danger` | `#f85149` | `#cf222e` |
| `--primary-muted` | `rgba(88,166,255,0.1)` | `rgba(9,105,218,0.05)` |
| `--danger-muted` | `rgba(248,81,73,0.15)` | `rgba(207,34,46,0.1)` |
| `--success-muted` | `rgba(63,185,80,0.15)` | `rgba(26,127,55,0.1)` |

### Interactive states

| Token | Dark | Light |
|-------|------|-------|
| `--hover-glow` | `rgba(255,255,255,0.05)` | `rgba(0,0,0,0.1)` |
| `--text-on-accent` | `#ffffff` | `#ffffff` |

---

## Focus Areas Drawer

The Focus Areas drawer uses a modern, actionable list structure designed for touch-first interaction.

### Layout Principles

- **Increased Touch Targets:** Row height is set to `48px` (desktop) and `56px` (mobile), aligning with standard touch target accessibility.
- **Permanent Visibility:** Primary actions (`Play` and `More`) are permanently visible on mobile devices to ensure discoverability.
- **Visual Hierarchy:**
    - Title: `14px`, `Semibold (600)` weight.
    - Subtitle: `11px`, `Regular (400)`, `0.8` opacity, containing the item count.
    - Mini-badge: `10px`, `Bold (700)` inside a container (`background: var(--surface-elevated)`, `border: 1px solid var(--border)`).
- **Interactive State:** Currently active focus areas use the `active` class, applying `var(--primary-muted)` background and a left border (`3px solid var(--primary)`) to provide clear visual feedback without relying on hover states.

### Category Item Structure

Categories use a dual-row structure to separate the Title from the descriptive subtitle (e.g., "6 Focus Areas"):

```css
.fa-cat-info { 
    display: flex; 
    flex-direction: column; 
    justify-content: center; 
    gap: 2px; 
}
```

---

## Typography

| Token | Stack | Used for |
|-------|-------|----------|
| `--font-sans` | `'Manrope', -apple-system, BlinkMacSystemFont, sans-serif` | All UI text |
| `--font-mono` | `ui-monospace, 'SF Mono', 'Cascadia Code', monospace` | Code, technical labels |
| `--font-time` | `'JetBrains Mono', ui-monospace, monospace` | Timer countdown, time values, duration columns |

### Font loading

```html
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@300;400&display=swap" rel="stylesheet">
```

### Timer text

```css
.timer-time {
    font-family: var(--font-time);
    font-size: 64px;
    font-weight: 300;
    font-variant-numeric: tabular-nums; /* prevents digit-shift on each tick */
}
```

`tabular-nums` is required. Without it, variable-width digits cause the layout to shift every second.

---

## Border Radius Scale

| Token | Value | Used for |
|-------|-------|----------|
| `--r-xs` | `4px` | Tags, badges, tiny chips |
| `--r` | `6px` | Base — default for most elements |
| `--r-md` | `8px` | Buttons, interactive controls |
| `--r-input` | `10px` | Input fields, search boxes |
| `--r-lg` | `12px` | Cards, panels, modals |
| `--r-xl` | `20px` | Pill-shaped elements |
| `--radius` | `var(--r-lg)` | Legacy alias — prefer `--r-lg` |

---

## Shadows

| Token | Dark | Light | Used for |
|-------|------|-------|----------|
| `--shadow-main` | `0 8px 24px rgba(0,0,0,0.4)` | `0 8px 24px rgba(0,0,0,0.1)` | Floating elements, FAB |
| `--shadow-modal` | `0 4px 12px rgba(0,0,0,0.3)` | `0 4px 12px rgba(0,0,0,0.1)` | Modal dialogs |
| `--overlay-bg` | `rgba(0,0,0,0.6)` | `rgba(0,0,0,0.4)` | Modal backdrops |

Panels and drawers do **not** use box-shadows. They use `border-right: 1px solid var(--border)` and a surface color step for separation.

---

## Button Sizes

| Token | Value |
|-------|-------|
| `--btn-size-lg` | `44px` |
| `--btn-size-md` | `36px` |
| `--btn-size-sm` | `28px` |
| `--btn-size-xs` | `20px` |

---

## Sidenav

The sidenav delegates all color decisions to the main design system. No separate palette.

| Token | Resolves to |
|-------|-------------|
| `--sidenav-bg` | `var(--bg)` |
| `--sidenav-text-primary` | `var(--text-primary)` |
| `--sidenav-text-secondary` | `var(--text-secondary)` |
| `--sidenav-hover-bg` | `var(--surface-elevated)` |
| `--sidenav-active-bg` | `var(--accent-dim)` |
| `--sidenav-border` | `var(--border)` |
| `--sidenav-width` | `280px` |
| `--sidenav-width-collapsed` | `56px` |
| `--sidenav-transition` | `0.3s` |

---

## Timer — Skeuo Watch Crown

The timer widget uses a deliberate skeuo style (raised bezel, machined face). It intentionally uses a separate slate/blue-gray palette to suggest a physical instrument — this is a design choice, not an inconsistency.

| Token | Dark | Light |
|-------|------|-------|
| `--skeuo-trench` | `#0f172a` | `#f1f5f9` |
| `--skeuo-face` | `#21262d` | `#ffffff` |
| `--skeuo-rim` | `#4a5568` | `#cbd5e1` |
| `--skeuo-well` | `rgba(0,0,0,0.6)` | `rgba(0,0,0,0.12)` |

### Gold crown accent

| Token | Dark | Light |
|-------|------|-------|
| `--gold` | `#FFD700` | `#9a6700` |
| `--gold-glow` | `rgba(255,215,0,0.4)` | `rgba(154,103,0,0.3)` |
| `--gold-muted` | `#b8860b` | `#734d00` |
| `--timer-accent` | `var(--gold)` | `var(--gold)` |
| `--timer-accent-glow` | `var(--gold-glow)` | `var(--gold-glow)` |

---

## Icons

**Phosphor Icons is the sole icon library.** No other icon font, no inline SVG icons, no Unicode symbol substitutes.

```html
<!-- Loaded once in app.html -->
<script src="https://unpkg.com/@phosphor-icons/web"></script>
```

### Usage

Always use the `<i class="ph ph-{name}">` pattern. Never use SVG paths, Unicode characters (▾ ▭ ▶ ◎ ×), or other icon fonts as UI icons.

```html
<!-- correct -->
<i class="ph ph-caret-down"></i>
<i class="ph ph-x"></i>
<i class="ph ph-trash"></i>

<!-- wrong -->
<span>▾</span>
<svg viewBox="0 0 256 256">...</svg>
×
```

### Weights

Phosphor supports `ph-thin`, `ph-light`, `ph` (regular), `ph-bold`, `ph-fill`, `ph-duotone`. Use **regular** everywhere unless there is a specific semantic reason to differ. The sidenav uses regular weight.

### Sizing

Icons inherit `font-size` from their parent. Set explicit size only when the icon must differ from surrounding text:

```css
.my-icon { font-size: 18px; }
```

Do not set `width`/`height` on `<i>` elements — Phosphor icons are font-based and scale with `font-size`.

### Icon reference (used in this app)

| Icon | `ph-name` | Used for |
|------|-----------|----------|
| Close / dismiss | `ph-x` | All close buttons on panels, modals, popovers |
| Caret down | `ph-caret-down` | Collapsed picker / dropdown |
| Caret up | `ph-caret-up` | Expanded picker / dropdown |
| Caret left | `ph-caret-left` | Sidenav collapse |
| Caret right | `ph-caret-right` | Category drill-in chevron |
| Search | `ph-magnifying-glass` | Search inputs |
| Pencil / edit | `ph-pencil` | Edit actions |
| Trash | `ph-trash` | Delete actions |
| Three dots | `ph-dots-three-vertical` | Overflow / more-actions menu |
| Play | `ph-play` | Start timer / focus session |
| Pause | `ph-pause` | Pause timer |
| Circle dashed | `ph-circle-dashed` | Path / deadline marker |
| Folder | `ph-folder` | Default category icon |
| Calendar blank | `ph-calendar-blank` | Empty calendar state |
| Share | `ph-share-network` | Share milestone |
| Plus circle | `ph-plus-circle` | Re-budget action |
| Arrow clockwise | `ph-arrow-clockwise` | Go again / reset |
| Timer | `ph-timer` | Bottom nav — Timer tab |
| Calendar dots | `ph-calendar-dots` | Focus Planner nav item |
| Map trifold | `ph-map-trifold` | Bottom nav — Paths tab |
| Lightning | `ph-lightning` | Bottom nav — Areas tab |
| Sun / Moon | `ph-sun` / `ph-moon` | Theme toggle |
| Gear | `ph-gear` | Settings |
| Sign out | `ph-sign-out` | Logout |

### What stays as emoji

Emoji are intentional and **not** replaced with Phosphor:

- **Avatars** (🦉 🦊 🐼 etc.) — user-selectable personality icons
- **Achievement icons** (🎯 📚 💪 etc.) — motivational, expressive
- **Email confirmation** (✉️) — one-off contextual use

The Google OAuth logo SVG is also kept as-is (branded, cannot be substituted).

---

## Form Panels

Floating panels (popovers, modals) that contain forms follow a strict elevation and hierarchy contract.

### Panel shell

| Property | Value |
|----------|-------|
| Background | `--surface` — one level above page canvas, not `--surface-elevated` |
| Border | `1px solid var(--border)` |
| Border radius | `var(--r-lg)` (12px) |
| Shadow | `var(--shadow-main)` |
| Padding | `20px` |
| Gap between fields | `14px` |

### Viewport-aware positioning

**All popovers, dropdowns, and floating panels MUST account for viewport boundaries.**

```js
const rect = anchorEl.getBoundingClientRect();
const popoverRect = popover.getBoundingClientRect();
const viewportHeight = window.innerHeight;

let top = rect.bottom + 5;
let left = rect.left;

// Flip up if popover would extend past viewport bottom
if (top + popoverRect.height > viewportHeight) {
    top = rect.top - popoverRect.height - 5;
}

// Ensure popover stays within viewport left edge
if (left < 0) {
    left = rect.left;
}

popover.style.top = `${top}px`;
popover.style.left = `${left}px`;
```

**Rules:**
- Always check if `top + popoverHeight > viewportHeight` — if so, position above the anchor
- Ensure `left >= 0` — popover must not extend past viewport left edge
- Use `getBoundingClientRect()` on both anchor AND popover before positioning
- Add 5px gap between anchor and popover for visual breathing room

### Title

```css
font-size: 15px;
font-weight: 800;
letter-spacing: -0.02em;
color: var(--ink);
```

The title must visually anchor the panel. 12px/700 is insufficient — always use 15px/800 minimum.

### Field labels

```css
font-size: 11px;
font-weight: 700;
letter-spacing: 0.07em;
text-transform: uppercase;
color: var(--ink-mid);  /* not --ink-soft — legibility matters */
margin-bottom: 6px;
```

Optional labels use an inline `<span class="label-optional">` at 10px, `font-weight: 500`, no tracking, `--ink-soft`.

### Text / time inputs

```css
background: var(--surface-elevated);
border: 1px solid var(--border);
border-radius: var(--r-input);  /* 10px */
padding: 9px 12px;
font-size: 13px;
font-weight: 500;
color: var(--ink);
```

Focus state: `border-color: var(--accent)` only — no background change, no glow.

### Picker pills (select controls)

A pill replaces `<select>`. It opens an inline dropdown picker below it.

```css
min-height: 42px;
padding: 0 12px;
background: var(--surface-elevated);
border: 1px solid var(--border);
border-radius: var(--r-input);
font-size: 13px;
font-weight: 700;
```

**Unselected / required**: `border-style: dashed` signals the field needs input. Color dot is hidden; placeholder text in `--ink-soft`.

**Selected / optional**: `border-style: solid`. Color dot (10px) is visible. A `.has-path` / removing `.is-empty` class switches the state.

**Chevron**: `margin-left: auto` pushes it to the right edge.

### Stepper controls (sessions)

```css
height: 38px;
background: var(--surface-elevated);
border: 1px solid var(--border);
border-radius: var(--r-input);
overflow: hidden;
```

Decrease/increase buttons: `38px × 38px`, `font-size: 18px`, `color: --ink-mid`. Separator: `1px solid var(--border)`.

### Computed info rows

Derived/computed values (e.g. "total focus", "ends at") render as a **plain caption line** — no background, no border, no box. A boxed treatment at the same elevation as inputs is visually indistinguishable from an editable field.

```
total focus 40 min  ·  ends at 09:10
```

Each item is `display: flex; align-items: baseline; gap: 4px`. Items are separated by a `·` pseudo-element. Label: `11px / 500 / --ink-soft`. Value: `12px / 700 / --ink-mid`.

### Primary CTA button

```css
height: 44px;          /* var(--btn-size-lg) */
border-radius: var(--r-md);
background: var(--accent);
color: var(--text-on-accent);
font-size: 14px;
font-weight: 700;
```

---

## Picker Dropdowns

A picker is an inline list that opens below a pill control, not a floating menu.

### Container

```css
background: var(--surface-elevated);
border: 1px solid var(--border);
border-radius: var(--r-lg);
overflow: hidden;       /* clips search pill top corners */
```

### Search field (iOS pill style)

```css
/* Pill wrapper */
background: var(--bg);
border-radius: var(--r-xl);  /* 20px — full pill */
padding: 6px 10px;
margin: 8px 8px 4px;
display: flex;
align-items: center;
gap: 6px;
```

Contents: magnifier icon (`--ink-soft`, 13px) · flex input (no border, transparent bg) · circular clear button (`16px × 16px`, `--ink-soft` bg, `--surface-elevated` ×, only visible when text present).

### List items

```css
padding: 6px 8px;
border-radius: var(--r-xs);
font-size: 12px;
font-weight: 600;
```

Active item: `background: var(--bg)`. Hover: `background: var(--surface)`.

Color dot (area/path indicator): `8px × 8px`, `border-radius: 50%`, `flex-shrink: 0`.

---

## What Not To Do

- **No hardcoded hex colors** in component rules. If a value doesn't have a token, create one.
- **No `rgba(255,255,255,...)` values** outside `:root`. Use `--rule`, `--hover-glow`, or `--border`.
- **No decorative background animations** on the page canvas.
- **No box-shadows on slide-out panels.** Use surface color + border.
- **No separate color palette for navigation.** The sidenav inherits from the main system.
- **Don't use `--bg` for inputs.** All form inputs use `--surface-elevated`.
- **Don't use `--white` or `--bg-card` in new code.** They are compatibility aliases only.
- **Don't use `--accent-dim` on computed/read-only info.** It signals interactivity or selection. Use `--surface-elevated` for neutral info chips.
- **Don't use 12px/700 for panel titles.** Panels need 15px/800 minimum to anchor the form.
- **Don't make picker pills the same height as text inputs.** Picker pills are 42px (touch-friendly primary controls); text inputs are 36–38px (secondary fields).
- **Don't use `--rule` for borders inside form panels.** `--rule` is nearly invisible in light mode. Use `--border` for all structural borders.
- **Don't vary confirmation button order or styling.** All delete confirmations must show `[Cancel] [Delete]` where Delete is styled as danger (red). The Delete button must include the trash icon: `<i class="ph ph-trash"></i> Delete`. Consistent placement reduces accidental deletions.
