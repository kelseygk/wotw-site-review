const express = require("express");
const path = require("path");
const app = express();

app.use(express.json());

// CORS for Squarespace iframe embed
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("X-Frame-Options", "ALLOWALL");
  res.setHeader("Content-Security-Policy", "frame-ancestors *");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Serve the widget
app.use(express.static(path.join(__dirname, "public")));

// ── CONFIG ──
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
const CALENDLY_URL = process.env.CALENDLY_URL || "";

const COLLECTIONS = [
  "hospitality", "wellness", "small_business", "nonprofit", "education",
  "creator", "agency", "real_estate", "legal", "author", "ecommerce", "consulting"
].join(", ");

// ── API ENDPOINT ──
app.post("/api/review", async (req, res) => {
  const { action, url, email, site_name, industry, first_impression, start_here } = req.body || {};

  // ── LEAD CAPTURE ──
  if (action === "lead") {
    if (WEBHOOK_URL && email) {
      try {
        await fetch(WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            site_url: url,
            site_name: site_name || "",
            industry: industry || "",
            first_impression: first_impression || "",
            start_here: start_here || "",
            source: "Complimentary Site Review",
            reviewed_at: new Date().toISOString(),
          }),
        });
      } catch (_) {}
    }
    return res.json({ ok: true, calendly: CALENDLY_URL });
  }

  // ── SITE REVIEW ──
  if (action !== "review" || !url) {
    return res.status(400).json({ error: 'Send { action: "review", url: "..." }' });
  }

  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  }

  const domain = url.replace(/https?:\/\/(www\.)?/, "").split("/")[0];

  const prompt = `Senior web strategist at Week of the Website (WOTW). 1,000+ launches since 2014. Warm, direct, specific voice. Analyze ${url} via web search.

FIRST: Check for "Week of the Website" or "WOTW" or "weekofthewebsite" anywhere on the site (footer, credits, links). Also search "${domain} week of the website". If found, return ONLY: {"is_wotw":true,"site_name":"Business Name"}

OTHERWISE return JSON (no backticks):
{
  "is_wotw":false,
  "site_name":"Business Name",
  "first_impression":"2-3 sentences, first person plural. Honest first take on what the site communicates in 5 seconds. Reference actual content. Discovery-call tone.",
  "strengths":[{"title":"What's working","detail":"1-2 sentences referencing their actual site."}],
  "opportunities":[{"title":"Opportunity name","observation":"What we noticed. Reference actual content.","suggestion":"What we'd do. Start with a verb."}],
  "start_here":"One sentence: single most impactful change and why.",
  "collections":["key1"],
  "collection_context":"Why this collection matches. 1 sentence."
}

2 strengths. 4-5 opportunities. Honest but kind. Reference actual site content. No scores/grades. Collections from: ${COLLECTIONS}`;

  try {
    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2500,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await apiRes.json();
    const txt = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    const clean = txt.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      const m = clean.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : null;
    }

    if (!parsed) return res.status(500).json({ error: "Could not parse review" });

    return res.json({ ...parsed, calendly: CALENDLY_URL });
  } catch (e) {
    console.error("Review error:", e.message);
    return res.status(500).json({ error: "Review failed" });
  }
});

// Fallback to widget for any other route
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`WOTW Site Review running on port ${PORT}`));
