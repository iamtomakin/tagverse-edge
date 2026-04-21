# Tagverse Edge

## Data architecture

**Supabase** = source of truth (Postgres + Auth) for persisted domain data when signed in.

**In-memory state** = UI state — not a competing master copy.

**localStorage** = temporary cache only, never authoritative. Optional; it must not quietly become a second source of truth. Reconcile from Supabase after sign-in; don’t prefer cache over server for domain data.

### Analytics (win rate, streaks, drawdown)

See [`docs/ANALYTICS.md`](docs/ANALYTICS.md) for how win rate and related stats are calculated, including **breakeven days**, weekends, and empty days.

---

## Deployment (Vercel)

This app is deployed on **Vercel** (repo connected to Git).

- Push to the branch Vercel uses (e.g. `main`) → **automatic redeploy**.
- No `vercel.json` is required for a plain static site; the project root is the site root (`index.html` at top level).
- After deploy, **hard refresh** the live URL if the browser still serves an old `app.js` from cache.

### Phone vs desktop: different strategy selected or P/L

- **Same account** should share **which strategy is selected** and **instrument** via `profiles.calendar_preferences` (run `supabase-profiles-calendar-preferences.sql` if the column is missing).
- After deploy, use **Settings → Sync calendar from cloud** on both devices once.
- The **first “Default” pill** can rename to match your profile (`profiles.default_strategy_name`); a **separate** strategy (e.g. “50points”) is its own row in `strategies` and must exist on every device — the app now **fetches that row from Supabase** if it was missing from the merged list.

---

## Local preview (static site)

From this folder:

```bash
python3 -m http.server 8765
```

Open **http://localhost:8765** in your browser.

Or use the helper:

```bash
chmod +x serve.sh
./serve.sh
```

### “Address already in use” / server won’t start

Port **8765** is already taken (another terminal, old server, or another app).

**Option A — use another port**

```bash
python3 -m http.server 8080
```

Then open **http://localhost:8080**

**Option B — free port 8765 (macOS / Linux)**

```bash
lsof -i :8765
kill <PID>
```

Then start the server again.

### Wrong page / blank

The server must run from the **project root** (the folder that contains `index.html`), not a parent folder.
