# Analytics metrics (Tagverse Edge)

Implementation lives in `app.js` (`computeMetricsFromResults`, `getResultsInRange`, `getResultsInCustomRange`, etc.). The Analytics screen and **Compare strategies** use the same definitions.

---

## Win rate

**Formula**

\[
\text{win rate} = \frac{\text{green days}}{\text{days in sample}} \times 100
\]

- **Green day:** a logged day where **`totalR > 0`** for the **selected strategy** and **selected instrument**.
- **Days in sample:** only **weekdays (Mon–Fri)** in the chosen period **that have at least one logged result** for that strategy + instrument. Days with no log are **not** in the denominator.

So win rate is **day-based**, using each day’s **total R for that instrument** (not individual trades).

---

## Edge cases

| Case | Effect on win rate |
|------|-------------------|
| **`totalR > 0`** | Counts as a **win** (green day). |
| **`totalR < 0`** | Counts as a **non-win**; still in the denominator. |
| **`totalR === 0`** (breakeven, shown as “—” in the UI) | **Not** a win; still **included** in the denominator if that day is logged. Lowers win rate versus treating breakeven as half a win or ignoring it. |
| **Weekends** | Excluded from the date walk; no Saturday/Sunday rows. |
| **No log for a weekday** | That day is **omitted** entirely (not a loss and not a win). |
| **Custom date range** | Same rules; only weekdays with data for the strategy + instrument. |

---

## Other metrics (same `results` array)

- **Total R:** sum of `totalR` over the sample days.
- **Max drawdown (R):** peak-to-trough of the **cumulative** running total of `totalR` over days **in chronological order** in the sample.
- **Win / lose streaks:** consecutive days with `totalR > 0` or `totalR < 0`. **`totalR === 0` resets both streaks** (neither win nor loss streak continues through a breakeven day).

---

## Changing the period

Presets **Today**, **Week** (Mon–Fri window containing today), **Month** (calendar month to date), and **Custom** only change which weekdays are considered; the rules above stay the same.

---

## Evaluation Account planner (historical EOD)

The **Evaluation Account planner** screen (UI name; internal id `proprisk`) compares a **custom date range** (inclusive start/end) of **logged** `dailyResults` for a selected strategy against a **generic custom limit set** (profit target, max drawdown, minimum trading days, optional consistency cap). It is **rules-based and historical**, not Monte Carlo. Maximum range length is **400 calendar days** (`PROP_EVAL_MAX_RANGE_DAYS`).

### Flow

- `aggregateStrategyPerformanceInRange(strategyId, startDateKey, endDateKey, dollarsPerR, startingBalance)` builds period metrics from the same per-day R aggregation as `getStrategyForecastStats` (all instruments summed per weekday with a row in range).
- `evaluateCustomHistoricalEvaluation(aggregated, rules)` applies **EOD-only** checks: static drawdown from starting balance vs **trailing high-water** EOD drawdown, min days, optional consistency (largest green day ÷ total green), profit target. Outcomes: **Passed**, **Failed**, **Close to Pass** (≥85% of target, no other failures), **Insufficient Data**.
- `findEvaluationPassDatesFromDayRows(dayRows, rules)` walks logged days in order: **profit target first hit** = first day cumulative P&amp;L in the period ≥ target; **all rules first pass** = first prefix of the selected range where target + drawdown + min days + consistency (if on) are all satisfied (same rules as the full-range check, applied to data through that day only).

### Limitations

- **Intraday** is not modelled; copy must say so.
- Dollar P&amp;L uses **$ per 1R** from user input to map logged R to dollars.
- **Max daily loss** is not evaluated in this slice (would need intraday or stronger assumptions).

### Snapshot strip

- **Strategy snapshot** remains **all-time** `getStrategyForecastStats` for context; the evaluation uses **range-scoped** aggregation only.

---

## Funded Account Planner (scenario, not historical)

Forward-looking **projections** from user inputs (`computeFundedAccountPlannerScenario` in `app.js`). **Not** the prop pass-check engine; optional **prefill** pulls win rate, R:R, and trades/day from **`getStrategyForecastStatsInRange(strategyId, startDateKey, endDateKey)`** (calendar month or custom inclusive range; weekday rows only), or all-time if bounds are null. The **Risk & survival** screen uses a dashboard layout (hero metrics, guide strip, scenario cards); copy stays plain-language.

- **EV per trade (R):** \(w \cdot RR - (1-w)\); dollar EV × `riskPerTrade`.
- **Monthly trades:** `tradesPerDay × tradingDaysPerMonth`.
- **Losing streak:** \(\log(N)/\log(1/(1-w))\) for a rough long-run patch; **breach** block compares streak loss to `maxDrawdownPerAccount` with a simple fleet split.
- **Streak-in-window:** `fundedPlannerProbabilityAtLeastKConsecutiveLosses(n, winRate, k)` — Markov-style DP for P(at least one run of `k` losses in `n` trials). The planner shows four cards (`k` ∈ 5, 10, 15, 20) using `n = 100` (`FAP_PROB_WINDOW`) and **win rate from the Win rate (%) input** (often prefilled from the selected strategy’s logs).
