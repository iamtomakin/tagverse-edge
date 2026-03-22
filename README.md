# Tagverse Edge

## Data architecture

**Supabase** = source of truth (Postgres + Auth) for persisted domain data when signed in.

**In-memory state** = UI state — not a competing master copy.

**localStorage** = temporary cache only, never authoritative. Optional; it must not quietly become a second source of truth. Reconcile from Supabase after sign-in; don’t prefer cache over server for domain data.

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
