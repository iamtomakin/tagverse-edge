# Fix profile (Supabase `profiles` table)

Your app saves profile data to **`public.profiles`**. If **Save profile** fails or you see **`PGRST205`** / **“table … not in schema cache”**, run the setup below on the **same** Supabase project as `SUPABASE_URL` in `index.html` (currently **`iyrqvxizbdzjdkjykwdq`**).

## 1. Run the SQL

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → select **that** project.
2. **SQL Editor** → **New query**.
3. Open **`supabase-profiles-setup.sql`** from this repo, copy **all** of it, paste, **Run**.

You should see **Success** with no errors.

## 2. Data API (if errors persist)

**Project Settings** → **Data API** → under **Exposed schemas**, ensure **`public`** is listed → **Save**.

Then run **only** this in SQL Editor:

```sql
notify pgrst, 'reload schema';
```

Or **Pause project** → **Resume** (forces services to restart).

## 3. Test in the app

1. Deploy / open the live site with the **same** `SUPABASE_URL` + anon key as that project.
2. **Sign in**.
3. **Settings** → enter **Username** (required, **globally unique** — stored lowercase) → **Save profile**.

You should see **Profile updated.** and a row in **Table Editor → `public.profiles`**.

## Files

| File | Purpose |
|------|--------|
| `supabase-profiles-setup.sql` | **Run this** in SQL Editor |
| `supabase-profiles-journal-options.sql` | Adds `journal_options` (categories / emotions / risk labels) if your DB is older |

**Daily Log vocabulary (signed-in users):** After adding `journal_options`, custom categories and related pickers sync to `profiles.journal_options`. Run the small migration file above if `upsert` logs errors about unknown column.
| `supabase-profiles-bootstrap.sql` | Same logic (legacy name); use **setup** file above |
| `supabase-schema.sql` | Full project schema (includes `profiles` + other tables) |
