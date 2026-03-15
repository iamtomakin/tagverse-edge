# Tagverse Edge — Implementation Plan

**Document version:** 1.0  
**Date:** March 2026  
**Status:** Planning

---

## 1. Context & Scope

**Tagverse Edge** is a trading P/L calendar that:

- Shows **monthly** and **weekly** performance in a calendar view.
- Uses **R-multiples** instead of dollar amounts (-2R, -1R, 1R, +2R).
- Treats **Monday–Friday** as trading days; **Saturdays** show weekly totals; **Sundays** show no trades.
- Supports month/year picker, day selection, and dark theme with configurable loss/profit colors.

This plan defines how to take the current front-end prototype to a shippable product (MVP and beyond) without coding yet—architecture, product, frontend structure, backend, and QA.

---

## 2. Senior Software Architect — System Architecture

### 2.1 High-level architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT (Web App)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ Calendar UI │  │ Month Picker │  │ Settings / Preferences  │  │
│  └──────┬──────┘  └──────┬──────┘  └────────────┬──────────────┘  │
│         │                │                      │                 │
│         └────────────────┼──────────────────────┘                 │
│                          │                                         │
│                  ┌───────▼───────┐                                 │
│                  │  Client API   │  (fetch / WebSocket)             │
│                  │  / State      │                                 │
│                  └───────┬───────┘                                 │
└──────────────────────────┼────────────────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │   API       │  REST or BFF
                    │   Gateway   │
                    └──────┬──────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
┌────────▼────────┐ ┌──────▼──────┐ ┌───────▼───────┐
│  Trades / P&L   │ │   Users /   │ │  Preferences  │
│  Service        │ │   Auth      │ │  (themes, R)  │
└────────┬────────┘ └──────┬──────┘ └───────┬───────┘
         │                 │                 │
         └─────────────────┼─────────────────┘
                           │
                  ┌────────▼────────┐
                  │    Database     │  (PostgreSQL / etc.)
                  └─────────────────┘
```

- **Client:** SPA (current stack is vanilla HTML/CSS/JS; can remain or migrate to a framework).
- **API:** REST or a small BFF; optional WebSocket later for live updates.
- **Services:** Logical separation for trades/P&L, users/auth, and preferences.
- **Database:** Single DB for MVP; services can share it with clear schema ownership.

### 2.2 Core domains

| Domain        | Responsibility                          |
|---------------|-----------------------------------------|
| **Trades/P&L**| Trade records, daily R, weekly/monthly aggregates |
| **Users/Auth**| Identity, sessions, multi-tenant isolation |
| **Calendar**  | Read model: days, weeks, months, R values (derived from Trades) |
| **Preferences**| Theme, loss/profit colors, default view |

### 2.3 Non-functional choices (for implementation phase)

- **Auth:** JWT or session cookies; HTTPS only.
- **Data:** Trades immutable (append-only); aggregates computed or cached.
- **Scale:** Single region for MVP; stateless API for horizontal scaling later.

---

## 3. Product Manager — MVP Feature Verification

### 3.1 MVP feature list

| # | Feature | Supported by architecture? | Notes |
|---|---------|----------------------------|--------|
| 1 | Monthly calendar view with R per day (Mon–Fri) | Yes | Calendar domain + Trades/P&L |
| 2 | Saturday column = weekly R total | Yes | Derived from same trade data |
| 3 | Sunday = no trades (display only) | Yes | Frontend + backend only store weekday trades |
| 4 | Month/year picker, “Today” | Yes | Client + optional user preference |
| 5 | Day selection (visual state) | Yes | Client state; optional “selected day” persistence |
| 6 | R display: -2R, -1R, 1R, +2R; 0 → “-” | Yes | Format rules in one place (client + optional API) |
| 7 | Loss/profit/neutral colors; hover states | Yes | Preferences + frontend theme |
| 8 | Monthly P/L header (R or “-”) | Yes | Aggregate from Trades/P&L |
| 9 | Persistent user data (trades, preferences) | Yes | Users + DB |

### 3.2 Out of scope for MVP

- Multiple accounts/portfolios in one view.
- Dollar amounts (MVP is R-only as per current design).
- Real-time sync across devices (optional later).
- Native mobile app (web-first).

### 3.3 Acceptance criteria (summary)

- User can open a month and see correct R values for each weekday and weekly total in the Saturday column.
- 0R displays as “-” everywhere (day, week, month).
- Month picker and Today work; selection and theme behave as in the current prototype.

---

## 4. Frontend Engineer — UI Component Structure

### 4.1 Component hierarchy

```
App
├── MonthlySummary          (header: "Monthly P/L: <value>")
├── CalendarNav
│   ├── NavArrow (prev)
│   ├── MonthYearTrigger    (opens MonthPicker)
│   │   └── MonthPicker      (dialog: years + month grid, Today)
│   ├── NavArrow (next)
│   └── TodayButton
└── CalendarGrid
    ├── CalendarHeader       (Su … Sa)
    └── CalendarBody
        └── CalendarRow[]    (per week)
            ├── DayCell[]    (6 columns: Sun–Fri dates, R or empty)
            └── WeekCell     (1 column: Saturday = weekly R or "-")
```

### 4.2 Component responsibilities

| Component | Responsibility | Data / props (conceptual) |
|-----------|----------------|---------------------------|
| **MonthlySummary** | Show monthly R or “-”; apply loss/profit/neutral style | `monthlyR`, `theme` |
| **CalendarNav** | Month navigation, open picker, Today | `currentMonth`, `onMonthChange`, `onToday` |
| **MonthPicker** | Year list + month grid; emit selection and Today | `currentMonth`, `onSelect`, `onToday` |
| **CalendarGrid** | Layout and structure only | — |
| **CalendarRow** | One week row | `weekIndex`, `year`, `month` |
| **DayCell** | Single day: date, R or “-”, selection, loss/profit styling | `date`, `r`, `isSelected`, `isWeekday` |
| **WeekCell** | Saturday slot: “Week N”, weekly R or “-” | `weekNumber`, `weekR` |

### 4.3 State ownership (conceptual)

- **Global / container:** `currentMonth`, `selectedDate`, `tradesByDay` (or `dailyRByDay`).
- **Derived:** `monthlyR`, `weeklyR[]`, per-day R (from `tradesByDay` + R rules).
- **Local:** MonthPicker open/closed; hover states.

### 4.4 Theming / design tokens

- Keep existing tokens: `--loss-bg`, `--profit-bg`, `--loss-bg-hover`, `--profit-bg-hover`, `--cell-default`, `--text-primary`, etc.
- Centralize in one file (e.g. `theme.css` or variables in `styles.css`) for consistency and future backend-driven themes.

---

## 5. Backend Engineer — Database and APIs

### 5.1 Database schema (conceptual)

**Users**

- `users`: id, email, created_at, etc.

**Trades (append-only for MVP)**

- `trades`: id, user_id, symbol (optional), **date** (trade date), **amount** (or P&L), **r_value** (e.g. -2, -1, 1, 2), created_at.
- Constraint: one logical “day result” per user per date (or one row per trade and aggregate by date in app/views).

**Preferences**

- `user_preferences`: user_id, theme (e.g. loss/profit hex), default_view, updated_at.

**Aggregates (optional for performance)**

- `daily_r`: user_id, date, total_r (signed), trade_count — materialized/cached from `trades` for fast calendar reads.

### 5.2 API design (REST)

| Method | Endpoint | Purpose |
|-------|----------|--------|
| GET | `/api/trades?from=YYYY-MM-DD&to=YYYY-MM-DD` | Trades or daily R in range (for calendar) |
| POST | `/api/trades` | Ingest trade(s) for a day (MVP: optional) |
| GET | `/api/calendar?year=&month=` | Pre-aggregated calendar (days + week totals) — optional BFF endpoint |
| GET | `/api/user/preferences` | Theme, display options |
| PUT | `/api/user/preferences` | Update preferences |

### 5.3 R rules on the backend

- **Storage:** Store either raw trades (amount + count) or derived daily R; keep one source of truth.
- **Aggregation:** Weekly R = sum of daily R for Mon–Fri in that week; monthly R = sum of daily R for the month. Same rules as frontend so UI and API stay in sync.

### 5.4 Security and multi-tenancy

- All trade and preference endpoints scoped by `user_id` (from auth).
- No cross-user data exposure; validate date ranges and payload sizes.

---

## 6. QA Engineer — Risks and Edge Cases

### 6.1 Data and business logic

- **Empty month:** All days 0R → monthly and all week cells show “-”; no errors.
- **Partial week:** e.g. month starts Wednesday; Week 1 has only Wed–Fri; weekly R is sum of those days only.
- **Timezone:** Trade “date” must be defined (e.g. UTC or user TZ); consistent across client and API.
- **R rules:** Backend and frontend use identical logic for amount+trades → R and for 0 → “-”.

### 6.2 UI and interaction

- **Month picker:** Close on outside click and Escape; no double-open; correct month/year after selection.
- **Selection:** Selected day persists across month change (or resets to “today”) — product decision to be consistent.
- **Accessibility:** Keyboard navigation, focus trap in month picker, ARIA labels (e.g. “Choose month and year”).

### 6.3 Performance and environment

- **Large date range:** If loading many months, paginate or load by visible month.
- **Offline:** MVP can be online-only; document behavior when API fails (e.g. show “-” or cached last data).
- **Browsers:** Test on target browsers (e.g. Chrome, Safari, Firefox) for layout and JS.

### 6.4 Regression checklist (before release)

- [ ] Mon–Fri show R or “-”; Sat shows week total; Sun no trades.
- [ ] 0R → “-” in day, week, and monthly header.
- [ ] Loss/profit/neutral colors and hover correct.
- [ ] Month picker and Today work; selected day visible.
- [ ] API and DB respect user isolation and date ranges.

---

## 7. Implementation Order (Recommended)

1. **Backend:** DB schema + auth + trades (or daily R) read API + preferences read/write.
2. **Backend:** Optional `/api/calendar` aggregation.
3. **Frontend:** Refactor current prototype into the component structure above; plug in API for trades/calendar.
4. **Frontend:** Wire preferences (theme) to API.
5. **QA:** Execute edge-case and regression checks; fix and re-check.

---

## 8. Open Decisions (For Product/Team)

- Store raw trades (amount + count) and derive R in backend, or store daily R only?
- Single trade per day vs multiple trades per day (current R rules assume 1 or 2 trades per day).
- Whether “selected day” is persisted per user.
- Exact auth method (e.g. email/password, OAuth) and token format.

---

*This plan is the shared reference for the Tagverse Edge calendar feature. Implementation should follow this structure and update the doc when decisions or scope change.*
