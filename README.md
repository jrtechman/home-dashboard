# Home Dashboard

A touchscreen family board: week calendar (with your Apple Calendars), per-person tasks, a photo-based dish box with a dinner list, a grocery list sorted by aisle, a photo frame and screensaver, and your YNAB budget at a glance.

It runs on **Vercel** only: the page and its small server functions, an **Upstash Redis** database and a **Blob** store for photos, both added from Vercel's Storage tab. The code lives in **GitHub**.

## What's in here

| Path | What it does |
|---|---|
| `public/index.html` | The whole dashboard screen |
| `lib/routes/login.js` | Household passcode sign-in (stays signed in for a year) |
| `lib/routes/state.js`, `lib/routes/db.js` | Read and save tasks, lists, dishes, events, settings |
| `lib/routes/upload.js` | Save and remove photos |
| `lib/routes/calendar.js` | Reads your Apple Calendar links every 5 minutes |
| `lib/routes/apple.js`, `lib/caldav.js` | Saves, moves and removes dashboard events in your iCloud calendar |
| `lib/routes/passkey.js` | Face ID / Touch ID sign-in for phones (passkeys) |
| `lib/routes/budget.js` | Reads YNAB (read-only), only the categories you choose |
| `lib/routes/import-recipe.js` | Imports a recipe from a recipe website link (free, no AI) |
| `lib/routes/album.js` | Reads your shared iCloud photo album for the frame and slideshow |
| `lib/routes/draft-recipe.js` | Optional: sends a dish photo to Claude to draft the recipe (needs an API key) |

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
- **`ICLOUD_ID`**, **`ICLOUD_APP_PASSWORD`** and **`ICLOUD_CALENDAR`** (optional): lets events you add on the dashboard also appear in your Apple Calendar. Make an app-specific password at account.apple.com → Sign-In and Security → App-Specific Passwords (never use your real Apple password). `ICLOUD_CALENDAR` is the calendar new events go to by default, e.g. `Family`.
- **`ESV_API_KEY`** (optional): free key from api.esv.org (create an account, then an application). It makes the Home "Verse of the day" card show the ESV text; without it the card shows the reference and a link. Weather needs no key: pick a city, or use a phone's location, from the Weather card on Home.
- **`YNAB_TOKEN`** and **`YNAB_CATEGORIES`**: token from YNAB → Account Settings → Developer Settings. List only the categories you're comfortable showing on a wall, e.g. `Groceries, Dining Out, Fun Money`. If you leave `YNAB_CATEGORIES` empty, the Home card tells you which category names exist (names only, no amounts).
- **`PHOTO_ALBUM`**: a shared iCloud album for the photo frame. In Photos, open the shared album → people icon → turn on **Public Website** → copy the link. Anyone in the album can add photos from their iPhone and they show up on the board within about 15 minutes.
- **`ANTHROPIC_API_KEY`** (optional, paid): from console.anthropic.com, for "Fill in from the photo", about 1 cent per draft. Without it, use **Paste a recipe** (text from the Claude app, a note or a website) or **Import a recipe** (a recipe website link); both are free.

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
- **Shared album:** this uses the same requests as the album's public web page, since Apple has no official API for it, so an Apple change could stop it until the code is updated. Apple's newest album links (`photos.icloud.com/shared/album/…`) can't be read this way. Photos you add on the dashboard's Photos tab are a backup that always works.
- **Recipe import** works with most recipe sites. A few block outside requests; for those, copy the recipe text and use Paste.
- **Apple Calendar events are read-only** on the board; change them on your phone. Events you add on the dashboard can be saved to Apple Calendar too (set the `ICLOUD_` variables); editing or deleting them on the dashboard updates Apple, but changes you make to them in Apple Calendar don't come back.
- **Privacy:** data and the budget sit behind the passcode. Photos are stored at long, unguessable web addresses; anyone given one of those addresses could open that photo. Anyone with a calendar's public link can view that calendar; to revoke, turn Public Calendar off and on again in Apple Calendar (this makes a new link, so update `CALENDARS`).
- **Face ID:** after signing in with the passcode on a phone, tap **Turn on Face ID** (offered once, or in Settings). Later sign-ins use Face ID. Each phone is listed in Settings, where you can remove it. Passkeys belong to the web address they were made on, so if you change the address, set Face ID up again. Changing the passcode does not remove Face ID phones; remove them in Settings.
- **Changing the passcode** signs every screen out (unless you set `SESSION_SECRET`).
- **Run it locally:** `npm install`, then `npx vercel link` and `npx vercel env pull`, then `npm run dev`.

## Wyze cameras (Menu, Cameras)

The dashboard stores only addresses: each camera has a **picture address** (a still image, refreshed every 5 seconds in the tile) and a **live address** (opened when you tap the tile; a web page such as a WebRTC player, or an `.m3u8` HLS stream). Wyze has no official live-video service, so the video comes from a helper running at home, such as [docker-wyze-bridge](https://github.com/mrlt8/docker-wyze-bridge), made reachable over **https** (for example with Tailscale Serve). Add cameras with Menu, Cameras, Edit. Nothing is added to Vercel and no new environment variables are needed. See the project notes `wyze-cameras-setup` for the home-side steps.

## Push notifications

Settings, Notifications (this device), turns on notifications for that phone or tablet. People get a notification when someone else adds to the shopping list, or taps **Ask for help** on the Meals tab. The person who did it is not notified. On iPhone and iPad the dashboard must first be added to the Home Screen (Share, Add to Home Screen) and opened from there. No keys to set up: the notification keys are created on first use and kept in Redis (`hd:vapid`); phones are listed in `hd:push`.
