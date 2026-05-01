# Recipe Atlas

Multi-page recipe organizer with consistent measurement display and cooking flow helpers.

## Pages

- `index.html`: home dashboard and recent recipes.
- `recipes.html`: all recipes with search, category filter, and sorting.
- `add-recipe.html`: add by URL or pasted text, then preview and save.
- `recipe.html`: detailed recipe view with scaling, timers, cook mode, comments, and snapshots.

## Measurement Rules

- Base view (`1x`) shows converted metric values and original amounts.
- Liquids show both `g` and `ml`.
- Scaled view (`0.5x`, `2x`, `3x`, `4x`, custom) hides original values and shows only scaled metric output.

## Storage

- Data is stored in browser `localStorage` under `recipe_atlas_v1`.
- Includes recipes, reviews, uploaded result photos (as data URLs), and snapshots.
- Optional cloud sync is available through `sync-config.js` and Supabase.

## Notes

- URL import may fail on some websites due to CORS restrictions in browser security.
- In those cases, paste the recipe text directly.

## Supabase Sync Setup (free plan)

1. Create a free Supabase project.
2. Run SQL:

```sql
create table if not exists app_store (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz default now()
);
```

3. In Supabase, set RLS policy for this table according to your security preference.
4. Open `sync-config.js` and fill:
   - `enabled: true`
   - `supabaseUrl`
   - `anonKey`
5. Reload the site and use Home page sync controls.

## Add Recipe AI + Firestore

The Add Recipe page now supports:
- `Analyze Recipe with AI` using Gemini.
- Editable English fields: name, category, ingredients, instructions.
- `Save to Cloud` to Firestore.

Fill these values in `sync-config.js`:
- `firebaseProjectId`
- `firebaseApiKey`
- `geminiApiKey`
- Optional: `geminiModel` (default: `gemini-1.5-flash`)

Firestore collection used:
- `recipes`
