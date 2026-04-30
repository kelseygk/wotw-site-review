# WOTW Complimentary Site Review

An AI-powered website audit tool that lives on weekofthewebsite.com. Visitors paste a URL, get an instant review of what's working and where opportunities exist, and convert into Pipedrive leads.

## Architecture

```
Squarespace (iframe embed)
  └── Heroku (Express app)
        ├── public/index.html  — the widget UI
        └── server.js          — API proxy + static server
              ├── Anthropic API (site analysis)
              └── Zapier webhook → Pipedrive (lead capture)
```

## Deploy to Heroku

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "WOTW Site Review"
git remote add origin git@github.com:weekofthewebsite/site-review.git
git push -u origin main
```

### 2. Create a Heroku app

```bash
heroku create wotw-site-review
```

Or in the Heroku dashboard: New → Create new app.

### 3. Set environment variables

```bash
heroku config:set ANTHROPIC_API_KEY=sk-ant-your-key-here
heroku config:set WEBHOOK_URL=https://hooks.zapier.com/hooks/catch/your-hook
heroku config:set CALENDLY_URL=https://calendly.com/wotw/discovery
```

Or set them in Heroku dashboard → Settings → Config Vars.

### 4. Deploy

**From GitHub (recommended):**
Heroku dashboard → Deploy tab → Connect to GitHub → Select repo → Enable Automatic Deploys.

**Or via CLI:**
```bash
git push heroku main
```

### 5. Custom domain (optional)

```bash
heroku domains:add review.weekofthewebsite.com
```

Then add a CNAME record pointing `review.weekofthewebsite.com` to the Heroku DNS target shown in the output.

## Embed in Squarespace

Add a **Code Block** on any Squarespace page and paste:

```html
<div id="wotw-review-wrapper" style="width:100%;overflow:hidden;">
  <iframe
    id="wotw-review"
    src="https://wotw-site-review-abc123.herokuapp.com"
    style="width:100%;border:none;min-height:600px;"
    title="Complimentary Site Review by Week of the Website"
    loading="lazy"
  ></iframe>
</div>
<script>
window.addEventListener("message", function(e) {
  if (e.data && e.data.type === "wotw-review-height") {
    document.getElementById("wotw-review").style.height = e.data.height + "px";
  }
});
</script>
```

Replace the `src` with your Heroku app URL (or custom domain).

### Squarespace page setup

- Create a new page (e.g. /site-review)
- In Page Settings, uncheck "Enable Page Header" and "Enable Page Footer" for a full-width look
- Or keep header/footer and add the embed in the page body -- the iframe auto-resizes

## How it works

1. Visitor pastes their URL and clicks "Review My Site"
2. Widget calls `/api/review` on the Heroku server
3. Server calls Anthropic API with web_search to analyze the site
4. Returns structured JSON: first impression, strengths, opportunities, portfolio match
5. Widget renders the review with 3 opportunities visible, rest gated behind email
6. On email submit, widget calls `/api/review` with `action: "lead"`
7. Server POSTs to Zapier webhook → Pipedrive lead created
8. Calendly URL returned, "Book a Call" button appears with pre-filled params

### WOTW project detection

If the site has "Week of the Website" attribution anywhere (footer, credits, links), the API returns early with a minimal response. Widget shows a warm alumni card instead of the full audit, saving API tokens.

## Lead data sent to Pipedrive (via Zapier)

| Field | Description |
|---|---|
| `email` | Visitor's email |
| `site_url` | The URL they audited |
| `site_name` | Business name (from the audit) |
| `industry` | Matched portfolio collection key |
| `first_impression` | Opening review paragraph |
| `start_here` | Priority recommendation |
| `source` | "Complimentary Site Review" |
| `reviewed_at` | ISO timestamp |

## Zapier setup

1. New Zap → Trigger: **Webhooks by Zapier** → Catch Hook
2. Copy the webhook URL → set as `WEBHOOK_URL` config var in Heroku
3. Run a test submission so Zapier sees the payload
4. Action: **Pipedrive** → Create Lead
5. Map: email → contact, site_name → lead title, industry → label, first_impression + start_here → note, source → lead source

## Files

```
├── public/
│   └── index.html    ← Widget UI (vanilla HTML/CSS/JS)
├── server.js         ← Express server + API proxy
├── package.json      ← Dependencies
├── Procfile          ← Heroku process config
└── README.md         ← You are here
```

## Local development

```bash
npm install
ANTHROPIC_API_KEY=sk-ant-xxx node server.js
# Open http://localhost:3000
```

## Colors (WCAG AA verified)

| Usage | Color | On | Ratio |
|---|---|---|---|
| Primary text | #faf3ef | #26544a | 7.8:1 |
| Secondary text | #c5cbc5 | #26544a | 5.2:1 |
| Fine print | #b0c0ba | #26544a | 4.5:1 |
| Accent | #d4f266 | #26544a | 6.8:1 |
| Headings | #470f12 | #faf3ef | 14.2:1 |
| Body | #73322d | #faf3ef | 8.6:1 |
| Labels | #6b5d58 | #faf3ef | 5.7:1 |
