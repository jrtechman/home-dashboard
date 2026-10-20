# Home Dashboard

A touchscreen family board: week calendar (with your Apple Calendars), per-person tasks, a photo-based dish box with a dinner list, a grocery list sorted by aisle, a photo frame and screensaver, and your YNAB budget at a glance.

It runs on **Vercel** only: the page and its small server functions, an **Upstash Redis** database and a **Blob** store for photos, both added from Vercel's Storage tab. The code lives in **GitHub**.

## What's in here

| Path | What it does |
|---|---|
| `public/index.html` | The whole dashboard screen |
| `api/login.js` | Household passcode sign-in (stays signed in for a year) |
| `api/state.js`, `api/db.js` | Read and save tasks, lists, dishes, events, settings |
| `api/upload.js` | Save and remove photos |
| `api/calendar.js` | Reads your Apple Calendar links every 5 minutes |
| `api/budget.js` | Reads YNAB (read-only), only the categories you choose |
| `api/draft-recipe.js` | Sends a dish photo to Claude to draft the recipe |

## Set it up (about 20 minutes)

### 1. Put the code on GitHub
1. Create a new **private** repository on github.com, e.g. `home-dashboard`.
2. Upload the contents of this folder (drag the files onto the repo page), or from a terminal:
   ```sh
   git init && git add . && git commit -m "Home dashboard"
   git branch -M main
   git remote add origin https://github.com/YOUR-NAME/home-dashboard.git
   git push -u origin main
   ```

### 2. Create the Vercel project
1. On vercel.com, **Add New → Project** and import the GitHub repo. Leave the framework as **Other** and click **Deploy**.
2. Open the project's **Storage** tab:
   - **Create Database → Upstash for Redis** (the free plan is plenty). Connect it to this project.
   - **Create → Blob**. Connect it to this project.

   Each one adds its settings to the project automatically.

### 3. Add your settings
Project → **Settings → Environment Variables**. Use `.env.example` as the checklist.

- **`HOUSEHOLD_PASSCODE`** (required): what each screen asks for once.
- **`CALENDARS`**: your Apple Calendar link(s) as `Name|link`, separated by `;`.
  To get a link: Calendar on Mac or iCloud.com → share the calendar → turn on **Public Calendar** → copy. The name you give it (e.g. `Family`, or a person's name from the dashboard's Settings) labels the event; if it matches a family member, their color is used.
- **`YNAB_TOKEN`** and **`YNAB_CATEGORIES`**: token from YNAB → Account Settings → Developer Settings. List only the categories you're comfortable showing on a wall, e.g. `Groceries, Dining Out, Fun Money`. If you leave `YNAB_CATEGORIES` empty, the Home card tells you which category names exist (names only, no amounts).
- **`ANTHROPIC_API_KEY`**: from console.anthropic.com, for "Fill in from the photo". Each photo costs a few cents or less.

Then **Deployments → ⋯ → Redeploy** so the new settings take effect.

### 4. Set up the touchscreen
1. Open your project's address (e.g. `home-dashboard-yourname.vercel.app`) and enter the passcode.
2. Add it to the home screen (iPad: Share → Add to Home Screen; Android: ⋮ → Add to Home screen). It opens full screen like an app.
3. Do the same on your phones to add groceries and dishes on the go.
4. In the dashboard's **Settings**, add each family member and pick their color.

On an iPad wall mount, also turn on **Settings → Accessibility → Guided Access**, and set **Display & Brightness → Auto-Lock → Never** so it stays on.

## Good to know

- **New versions install themselves.** Every push to `main` makes Vercel redeploy, and open screens reload to the new version within a few seconds (they wait if someone is typing).
- **Updates show up in about 4 seconds** on every screen. Calendar changes made on your phones appear within about 5 minutes.
- **Apple Calendar events are read-only** on the board; change them on your phone.
- **Privacy:** data and the budget sit behind the passcode. Photos are stored at long, unguessable web addresses; anyone given one of those addresses could open that photo. Anyone with a calendar's public link can view that calendar; to revoke, turn Public Calendar off and on again in Apple Calendar (this makes a new link, so update `CALENDARS`).
- **Changing the passcode** signs every screen out (unless you set `SESSION_SECRET`).
- **Run it locally:** `npm install`, then `npx vercel link` and `npx vercel env pull`, then `npm run dev`.
