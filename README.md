# Deal Desk

A private desk for brand deals. Paste a brand's message and get:

- a reply in your own voice, written from your past replies,
- a quote priced from your rate card (ad rights, exclusivity, whitelisting, long-term rates),
- a media kit with your **live Instagram numbers**, refreshed every morning, as a link or a PDF.

Free to run: Netlify (hosting, functions, storage), Instagram's official API, Gemini's free tier.

## Environment variables (Netlify → Project configuration → Environment variables)

| Key | What |
|---|---|
| `DESK_PASSWORD` | The password that opens the desk |
| `IG_APP_ID` | Instagram app ID (Meta developer app → Instagram → API setup with Instagram login) |
| `IG_APP_SECRET` | Instagram app secret (same page) |
| `GEMINI_API_KEY` | Free key from Google AI Studio (optional — without it the built-in reader is used) |
| `SESSION_SECRET` | Optional. Any long random string |

Instagram redirect URL to add in the Meta app: `https://<your-site>.netlify.app/api/ig/callback`

Made by [@mallikaux](https://instagram.com/mallikaux).
