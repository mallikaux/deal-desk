# Deal Desk

A private desk for creators who get brand DMs. Paste a brand's message and get:

- **a quote** priced from your own rate card — ad rights, exclusivity, whitelisting, long-term and international ($) rates included. The AI never invents prices.
- **a reply** written in your voice, learned from replies you've sent before.
- **a media kit** with your **live Instagram numbers** (followers, reel views, engagement, audience age, gender, cities, countries, best reels) — as a link or a PDF, tailored to that brand.

Your numbers refresh on their own twice a week. Runs on free tiers: Netlify, Instagram's official API and Google Gemini.

Made by [@mallikaux](https://instagram.com/mallikaux).

---

## Set up your own (about 30 minutes, free)

You need: a GitHub account, a Netlify account, a Facebook account, and an Instagram **Creator or Business** account.

### 1. Copy this repo
Click **Fork** (top right) — or **Use this template** — to get your own copy.

### 2. Put it on Netlify
1. Netlify → **Add new project → Import an existing project → GitHub** → pick your copy.
2. Leave the build settings as they are and click **Deploy**.
3. Note your site address, e.g. `https://your-name.netlify.app`. You can rename it under Project configuration → Change project name.

### 3. Choose your password
Netlify → **Project configuration → Environment variables → Add a variable**:

| Key | Value |
|---|---|
| `DESK_PASSWORD` | any password — this is what opens your desk |

### 4. Free AI key (optional, recommended)
Get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and add it as `GEMINI_API_KEY`. Without it, the desk still works with a simpler built-in reader.

### 5. Instagram app (for live numbers)
1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Create app**.
   Name it anything, pick the use case **"Manage messaging & content on Instagram"**, skip the business portfolio.
2. In the app: **Use cases → Customize → API setup with Instagram login**.
   - Under **Set up Instagram business login**, add this redirect URL:
     `https://YOUR-SITE.netlify.app/api/ig/callback`
   - Copy the **Instagram app ID** and **Instagram app secret** shown on that page (not the Facebook App ID at the top).
3. **Use cases → Customize → Permissions and features**: add `instagram_business_basic` and `instagram_business_manage_insights`.
4. **App roles → Roles → Add People → Instagram Tester** → add your Instagram username(s).
5. Accept the invite in the Instagram app: **Settings → Website permissions → Apps and websites → Tester invites**.
6. Back in Netlify, add two more variables:

| Key | Value |
|---|---|
| `IG_APP_ID` | the Instagram app ID |
| `IG_APP_SECRET` | the Instagram app secret (tick "Contains secret values") |

You don't need Meta's app review — the app stays in development mode, which is fine for your own accounts.

### 6. Redeploy
Netlify → **Deploys → Trigger deploy → Deploy project**. Environment variables only apply after a deploy.

### 7. Use it
Open your site, enter your password, then in **Settings**:
- add your account, fill in your rate card, payment terms and rules (e.g. "No barter")
- paste 3–4 past brand messages and what you replied — new replies copy that voice
- tap **Connect Instagram**

Then paste any brand message on the Desk tab.

---

## Good to know
- **Two kinds of links.** Your desk link is private (password). Media kit links (`/k/…`) are public — that's what you send brands. They open on any phone, no login.
- **More than one Instagram account?** Add each as a tester and connect them one by one. Instagram connects whichever account is logged in at the time.
- **Netlify credits.** Each deploy uses credits on Netlify's free plan; everyday use barely does. When editing files on GitHub, add `[skip netlify]` to the commit message to save a deploy.
- **Your data** stays in your own Netlify storage. Nothing is shared with anyone else using this repo.
