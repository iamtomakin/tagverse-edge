# Tagverse Edge — Design Principles

**Document version:** 1.0  
**Status:** Living document

---

## Core principles

### 1. Clean, minimal interface

- **Less chrome:** No decorative borders, heavy shadows, or redundant labels. Every element earns its place.
- **Typography-led:** Clear hierarchy (e.g. Roboto Condensed for key numbers); consistent size and weight. No more than two type families.
- **Whitespace:** Generous padding and alignment so the calendar and numbers breathe. Grid and spacing follow a simple scale (e.g. 4px / 8px base).
- **Single focus:** One primary action per context—e.g. “log today” or “view month”—so the user isn’t choosing between many buttons.

*Inspiration: Habit trackers (Streaks, Done); productivity tools (Things, Linear).*

---

### 2. Dark mode first

- **Default theme:** Dark background (#1a1a1a–#2c2c2c) with light text. Designed for long sessions and low glare.
- **Color with purpose:** Loss/profit/neutral use a restrained palette. No bright decorative colors; accent (e.g. selection blue) is used sparingly.
- **Contrast:** Text and R values meet accessibility targets on dark. “-” and 0R states are clear but not loud.
- **Optional light mode:** Can be added later without changing layout; dark remains the primary experience.

*Inspiration: Trading dashboards (Thinkorswim dark, broker UIs); developer tools.*

---

### 3. Calendar-driven dashboard

- **Calendar as home:** The month view is the main screen. No dashboard “overview” that competes with it; the calendar is the overview.
- **R at a glance:** Daily R and weekly totals live in the grid. No drill-down required to see performance.
- **Progressive detail:** Click a day or week only when the user needs more (e.g. trade list or notes). Default view stays simple.
- **Time boundaries:** Week = Mon–Fri; Saturday = weekly total; Sunday = rest. The grid enforces this structure.

*Inspiration: Habit trackers (month grid with checkmarks); calendar-first tools (Fantastical, Google Calendar).*

---

### 4. Fast trade logging

- **Short path to log:** From calendar or a fixed entry point, one or two actions to log a trade (or day’s R). No long wizards.
- **Minimal fields for MVP:** e.g. date (default today), R outcome (-2R to +2R) or 1–2 trades with outcome. No required symbols or notes for first version.
- **Keyboard-first where possible:** Quick keys for “today,” “log,” “next/prev month” so power users rarely touch the mouse.
- **No blocking modals:** Inline or slide-over entry preferred so the calendar stays visible.

*Inspiration: Fast-capture (Things Quick Add, note apps); trading platforms (one-click order entry).*

---

### 5. Visual discipline feedback

- **R as the metric:** The product reinforces “R” as the unit. Numbers are -2R, -1R, 1R, +2R (and “-” for zero). No dollar amounts in the core view unless explicitly opted in.
- **Consistent encoding:** Loss = one visual treatment (e.g. color/hover); profit = another; neutral/rest = third. Same rules in day cells, week column, and monthly header.
- **Hover and state:** Subtle hover on cells and buttons confirms interactivity. Selected day is clearly indicated. No surprise interactions.
- **Calm feedback:** Success after logging is brief and non-intrusive (e.g. small check or toast). Errors are clear but not alarming.

*Inspiration: Habit trackers (streak and completion cues); trading (P&L color coding); productivity (done states).*

---

## UI inspiration summary

| Source | What we take |
|--------|----------------|
| **Habit trackers** | Grid-based progress, simple daily state, streaks/consistency, minimal controls. |
| **Trading dashboards** | Dark UI, P&L color coding, dense but readable data, fast actions. |
| **Productivity tools** | Clean layout, quick capture, keyboard support, one primary view (calendar/list). |

---

## Anti-patterns to avoid

- **Cluttered headers:** No nav bars with many items; no competing “home” vs “calendar.” Calendar is home.
- **Mixed metrics:** Don’t show both $ and R in the same view by default. Pick one (R) for the core loop.
- **Light-first design:** Don’t design for light mode and darken later. Start dark, then adapt.
- **Heavy logging flow:** Avoid multi-step trade entry or long forms. Prefer defaults and minimal fields.
- **Decorative visuals:** No illustrations, mascots, or decorative gradients in the main calendar. Color only for meaning (loss/profit/neutral/selection).

---

## Design tokens (reminder)

Align implementation with these principles:

- **Backgrounds:** Dark base (#1a1a1a), cells (#2c2c2c).
- **Loss:** Dedicated color (e.g. #552326) + hover; used only for negative R.
- **Profit:** Muted green default, brighter on hover.
- **Neutral / zero:** “-” in a calm color (e.g. white or secondary gray).
- **Accent:** One highlight color for selection and primary actions (e.g. blue).
- **Typography:** One sans for UI, one condensed or mono for numbers (e.g. Roboto Condensed for monthly P/L).

---

*These principles guide Tagverse Edge’s UI and should be referenced in feature and implementation decisions.*
