# Tagverse Edge

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
