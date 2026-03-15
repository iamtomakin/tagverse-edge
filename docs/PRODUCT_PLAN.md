# Tagverse Edge — Product Plan

**Roles:** Senior Product Manager, Startup CTO, AI-Native Software Architect  
**Product:** Tagverse Edge  
**Version:** 1.0 (pre-build)  
**Status:** Planning

---

## A. Product definition (one paragraph)

**Tagverse Edge** is a behavioural trading dashboard for the Tagverse community. It helps traders who all trade the same setup (NQ, New York open) with a hard rule of 1–2 trades per day. The product’s job is not to log trades for accounting—it’s to improve discipline, behavioural consistency, and risk awareness by making the daily process visible and measurable. It emphasises process over outcome, discipline over profit, and horizontal scaling (more consistent days) over chasing big wins. The experience is calendar-first, dark-mode, mobile-friendly, and built so that logging is fast and the system visually reinforces whether the user stuck to the rules. It is designed for students and young traders and will be sold as a one-time payment product.

---

## B. Clearest MVP scope

**In scope for MVP (ship this first):**

| # | Feature | Why in MVP |
|---|---------|------------|
| 1 | **Calendar trading dashboard** | Primary home: month view, R per day (Mon–Fri), weekly total in Saturday column, 0 → “-”. |
| 2 | **Daily trading declaration** | One simple commitment per day (e.g. “1 or 2 trades today”) before trading; timestamped. |
| 3 | **Simple trade logging** | Fast capture: date (default today), outcome as R (-2R, -1R, 1R, +2R). No symbols, no notes required. |
| 4 | **Rule violation detection** | System flags: &gt;2 trades in a day, no declaration, or declaration vs actual mismatch. |
| 5 | **Discipline score** | Single number (e.g. 0–100) from: declaration adherence, trade-count rule, consistency. |
| 6 | **Discipline streak** | Consecutive days with declaration + rule-compliant trades. Visible on calendar or header. |
| 7 | **Basic performance analytics** | One screen: win rate, average R, green day %, maybe total R for period. Derived from logged trades. |
| 8 | **Shareable performance snapshot** | One link or image: e.g. “This month: 12 green, 5 red, 3 grey, streak 7, score 82.” No auth required to view. |

**Explicitly out of MVP:**  
Risk of ruin, drawdown simulator, backtest vs live, first vs second trade analysis, community benchmark, owner dashboard, reflection prompts, plan vs execution, session compliance, income projection. These are post-MVP.

**MVP calendar rules (fixed):**  
NQ, NY open only (no instrument/session picker in v1). Max 1 or 2 trades per day; system enforces and surfaces violations.

---

## C. Key user flow: open app → log a trade

1. **Open app** → User lands on **calendar dashboard** (current month, dark theme). Sees: monthly R (or “-”), week totals in Saturday column, daily R in Mon–Fri cells. Optional: streak and discipline score in header.
2. **Optional: daily declaration** → If not yet declared today, a small prompt or banner: “Today’s plan: 1 or 2 trades?” User taps 1 or 2 (and optionally “skip” with a soft nudge). Stored with timestamp. No long form.
3. **Log a trade (same day)** → User taps **today’s cell** (or a persistent “Log trade” / “Quick log” entry point). Modal or slide-over: “How did today go?” → Choose: -2R, -1R, 1R, +2R (and implicitly 1 or 2 trades from that choice). Single tap + confirm (or auto-save). No symbol, no time of trade required for MVP.
4. **Feedback** → Cell updates to the chosen R; if they logged 2 outcomes in one day, system can combine or second tap adds second trade (product decision: one “day result” vs two separate entries). Streak and score recalc. Optional: short confirmation (“Logged +2R”).
5. **Rule check** → If they log a third “trade” for the day, or declare “1” and log 2, system marks violation; discipline score and possibly streak adjust. No blocking—just visible feedback.

**Design goal:** From cold open to logged trade in &lt;10 seconds for returning users.

---

## D. Recommended stack for building fast in Cursor

- **Frontend:** **React** (Vite) or **Next.js** (if you want SSR/API routes in one repo). TypeScript. Tailwind for layout and theming; keep existing design tokens (dark, loss/profit colours). Cursor works very well with React + Vite + TS.
- **Backend:** **Next.js API routes** (if Next) or **Node (Express/Fastify) + separate React app**. Auth: **Clerk** or **Supabase Auth** (fast, good DX; one-time payment can be Stripe “one-time” or Lemon Squeezy).
- **Database:** **Supabase (PostgreSQL)**. Tables: users, declarations, trades (or daily_results), discipline_events. Supabase gives Postgres + auth + optional realtime; fits “ship fast” and Cursor.
- **Hosting:** **Vercel** (Next) or **Vercel (frontend) + Railway/Render (API)** if split. DB on Supabase cloud.
- **Why this stack:** Single language (TS), minimal context switching, great Cursor support, Supabase dashboard for quick schema/data checks, Vercel deploy in one click. Avoid microservices and extra queues for v1.

---

## 1. Product planning document (structure)

### 1.1 Vision and principles (summary)

- **Process over outcome** — UI shows adherence and consistency first; P&L second.
- **Discipline over profit** — Violations and streak are first-class; profit is a consequence.
- **Horizontal scaling** — More good days (green / rule-compliant) over chasing big R.
- **Simple daily use** — One declaration, one quick log; no feature overload.

### 1.2 Success criteria for v1

- Traders open the app at least on trading days (calendar as habit anchor).
- Declaration and log each take &lt;15 seconds.
- Discipline score and streak feel meaningful (users mention them).
- Shareable snapshot is used (e.g. in community or for accountability).

---

## 2. MVP and post-MVP phases

### Phase 1 — MVP (v1.0)

- Calendar dashboard (R, week total, “-” for 0).
- Daily declaration (1 or 2 trades, timestamped).
- Simple trade log (R outcome per day; 1–2 trades per day enforced).
- Rule violation detection (no declaration, &gt;2 trades, declaration vs actual).
- Discipline score (formula TBD; e.g. declaration % + rule compliance % + recency).
- Discipline streak (consecutive compliant days).
- Basic analytics (win rate, avg R, green day %).
- Shareable snapshot (public link or image for a period).

**Exit condition:** 10+ Tagverse members using it daily for 2 weeks without critical bugs.

### Phase 2 — Retention and trust (v1.1)

- Green/red/yellow/grey day calendar (already partly there; formalise).
- Timestamped declaration history (when they declared).
- Win rate, average R, green day % refined and visible.
- End-of-day reflection prompt (optional one question).
- Plan vs execution summary (declared 1 vs did 2, etc.).

### Phase 3 — Depth (v1.2+)

- Trade count decision + max risk + breakeven declarations.
- First trade vs second trade analysis.
- Backtest vs live separation.
- Breakeven analytics.
- Session compliance (did they trade only NY open).

### Phase 4 — Community and monetisation

- Community performance benchmark (anonymised).
- Weekly/monthly Tagverse report.
- Owner dashboard.
- Horizontal scaling planner / income projection.
- Risk of ruin, drawdown simulator, risk alerts.

---

## 3. User personas

### Primary: Tagverse student / young trader

- Trades NQ, NY open; wants to stick to 1–2 trades.
- Time-poor; needs fast log and clear feedback.
- Motivated by streak and “not breaking the chain.”
- May share snapshot for accountability or in community.
- **Goal:** Build discipline without overthinking; see progress simply.

### Secondary: Tagverse mentor / experienced member

- Same rules; uses product to stay consistent and model behaviour.
- Cares about analytics and possibly sharing with group.
- **Goal:** Track self and optionally show others “I follow the rules.”

### Tertiary: Tagverse owner

- Post-MVP: dashboard across members (anonymised or aggregated).
- **Goal:** See community discipline and report; not in MVP.

---

## 4. Main user journeys

### J1: Morning — Set the day (declaration)

1. Open app → Calendar.
2. See “Declare today” (if not done).
3. Tap “1 trade” or “2 trades” (and optionally “Max R” later).
4. Done; banner dismisses. Timestamp stored.

### J2: End of day — Log outcome

1. Open app → Calendar.
2. Tap today’s cell (or “Log today”).
3. Select outcome: -2R, -1R, 1R, +2R (and system infers 1 or 2 trades from your choice if needed, or ask “1 or 2 trades?” once).
4. Save → cell updates, streak/score refresh.
5. If violation (e.g. third log): message and score/streak reflect it.

### J3: Review progress

1. Open app → Calendar.
2. Scan month: green/red/grey, weekly totals, streak in header.
3. Optional: open Analytics (win rate, avg R, green %).
4. Optional: open Share → copy link or generate image.

### J4: Share snapshot (MVP)

1. From dashboard or analytics → “Share”.
2. Choose period (e.g. this month).
3. Get link or image: calendar thumbnail + streak + score + key metrics.
4. Share link; recipient views read-only, no login.

---

## 5. Main dashboard screens

### Screen 1: Calendar dashboard (home)

- **Header:** Monthly R (or “-”); optional streak + discipline score.
- **Nav:** Month picker, Today, prev/next month.
- **Grid:** 7 columns (Su–Sa); 6 day columns (R or “-”), 7th = weekly total. Mon–Fri only show R; Sunday empty; Saturday = week total.
- **Cells:** Tap day → log or view; selected day highlighted.
- **Footer or FAB:** “Log today” or “Declare” if missing.

### Screen 2: Log / declaration entry

- **Context:** Today (default) or selected date.
- **Declaration (if not set):** “1 trade” / “2 trades” — single choice, save.
- **Log:** -2R, -1R, 1R, +2R — single choice; if day already has one trade and user picks second, second R is added (or combined per product rule). Save.
- **Validation:** If &gt;2 trades, show warning and still save (violation recorded).

### Screen 3: Analytics (basic)

- **Metrics:** Win rate, average R, green day % (and total R for period).
- **Period:** This month, last 30 days, or custom (MVP: this month + last 30).
- **Charts:** Optional simple bar or list; avoid heavy charts in MVP.

### Screen 4: Shareable snapshot

- **Content:** Period, calendar thumbnail, streak, score, win rate, avg R, green %.
- **Output:** Link (public, no auth) or image download.
- **No edit:** Read-only view for recipient.

### Screen 5: Settings (minimal)

- **Profile:** Email, display name (if needed).
- **Theme:** Dark (default) / light.
- **Account:** Log out; payment status if one-time purchase.

---

## 6. Tech stack (detailed)

- **Frontend:** React 18 + Vite + TypeScript, or Next.js 14 (App Router) + TypeScript. Tailwind CSS; design tokens in CSS variables. React Query (TanStack Query) for server state.
- **Backend:** Next.js API routes (recommended) or Express/Fastify. Node 20+.
- **Database:** Supabase (PostgreSQL). Use Supabase Auth or Clerk for auth.
- **Payments:** Stripe one-time or Lemon Squeezy (creator-friendly, one-time).
- **Hosting:** Vercel (frontend + API). Supabase cloud for DB.
- **Tooling:** Cursor, ESLint, Prettier. No heavy BaaS beyond Supabase for v1.

---

## 7. Database tables and high-level schema

### Core tables

- **users**  
  `id (uuid, PK), email, display_name, created_at, updated_at`

- **declarations**  
  `id (uuid, PK), user_id (FK), date (date), trade_count_planned (1|2), max_r_planned (nullable, post-MVP), created_at (timestamp)`

- **daily_results** (or trades)  
  `id (uuid, PK), user_id (FK), date (date), trade_1_r (nullable), trade_2_r (nullable), created_at, updated_at`  
  Alternatively: one row per trade with `date, user_id, r_value, trade_index (1|2)` and enforce max 2 per day in app + DB constraint.

- **discipline_events** (violations and positives)  
  `id (uuid, PK), user_id (FK), date (date), event_type (e.g. 'no_declaration', 'over_trade', 'declaration_mismatch', 'compliant_day'), metadata (jsonb), created_at`

- **discipline_scores** (cached or computed)  
  `user_id (PK), score (int 0–100), streak_days (int), last_calculated_at`  
  Or compute on read from declarations + daily_results + discipline_events.

### Supporting

- **share_snapshots**  
  `id (uuid, PK), user_id (FK), token (unique), period_start, period_end, payload (jsonb), created_at, expires_at`

- **user_preferences**  
  `user_id (PK), theme, timezone, created_at, updated_at`

### Constraints

- Unique (user_id, date) for declarations and for daily_results.
- Check: trade_count_planned in (1, 2); r_value in (-2, -1, 1, 2) or equivalent.

---

## 8. Risks

### Product risks

- **Low stickiness:** Traders forget to declare or log. Mitigation: calendar as home, streak prominent, optional reminder (post-MVP).
- **Gaming the score:** Users log only wins. Mitigation: treat “no log” as grey day; streak requires declaration + log; don’t over-gamify.
- **One-time payment vs ongoing value:** Churn is N/A but retention still matters. Mitigation: make daily use obviously useful; consider optional annual “pro” later.

### UX risks

- **Declaration feels like friction:** Mitigation: one tap, default “2 trades,” skip allowed but streak/score reflect it.
- **Logging on mobile is slow:** Mitigation: big touch targets, max 2 taps to save; consider widget or shortcut later.
- **Shareable snapshot abuse:** Mitigation: tokenised links, optional expiry, rate limit.

### Technical risks

- **Supabase limits or lock-in:** Mitigation: use standard Postgres; avoid Supabase-only features for critical paths so migration is possible.
- **Score/streak logic wrong:** Mitigation: formula in one place (backend or shared fn); tests; document formula in PRODUCT_PLAN or DESIGN.
- **Overbuilding:** Mitigation: ship MVP table above only; add tables when a concrete feature needs them.

---

## 9. Clean architecture for version 1

- **Monolith:** One repo (Next.js or Vite + small API). No microservices.
- **Layers:**  
  - **UI:** React components and pages (calendar, log, analytics, share).  
  - **Application:** Use cases in plain TS (e.g. `logDayResult`, `getDisciplineScore`, `createShareSnapshot`).  
  - **Data:** Repositories or Supabase client; no business logic in DB layer.
- **Auth:** Middleware or guard on API routes; all queries filter by `user_id`.
- **Computation:** Discipline score and streak in one module; call from API and optionally from a cron if you cache.
- **Share:** Generate token and store payload; public route reads by token only (no auth).

Avoid: event bus, message queues, multiple DBs, “platform” abstractions. Add when a real scaling or feature need appears.

---

## 10. Avoiding overbuilding

- **MVP = 8 features only.** Anything else is backlog. No “quick” risk-of-ruin or community benchmark in v1.
- **One R model.** Don’t support multiple instruments or sessions in MVP; no “strategies” or “portfolios.”
- **Declaration = 1 or 2 trades.** No max R, breakeven, or session time in MVP.
- **Analytics = one screen.** No dashboards per strategy, no custom date ranges beyond “this month” and “last 30 days” if needed.
- **Share = one format.** One snapshot layout; no templates or white-label in v1.
- **Score = one formula.** Ship one discipline score; refine later with data.
- **No realtime.** Poll or refetch after log; no WebSockets for MVP.
- **No mobile app.** Responsive web only; consider PWA later.

---

## Summary

- **Product:** Behavioural trading dashboard for Tagverse (NQ, NY open, 1–2 trades/day); process and discipline first.
- **MVP:** Calendar, declaration, simple log, violations, discipline score, streak, basic analytics, shareable snapshot.
- **Flow:** Open → calendar → (declare) → tap day → pick R → save; &lt;10 s to log.
- **Stack:** React (Vite) or Next.js, TypeScript, Tailwind, Supabase (Postgres + auth), Vercel; build fast in Cursor.
- **Schema:** users, declarations, daily_results, discipline_events, (discipline_scores or computed), share_snapshots, user_preferences.
- **Risks:** Stickiness, gaming score, declaration friction, mobile speed; mitigated by simplicity and one formula.
- **Architecture:** Monolith, thin layers, single score module, no extras until needed.
