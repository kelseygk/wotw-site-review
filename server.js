const express = require("express");
const path = require("path");
const rateLimit = require("express-rate-limit");

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "10kb" }));

const ALLOWED_ORIGINS = [
  "https://www.weekofthewebsite.com",
  "https://weekofthewebsite.com",
];
const FRAME_ANCESTORS = [
  "https://www.weekofthewebsite.com",
  "https://weekofthewebsite.com",
  "https://*.squarespace.com",
].join(" ");

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Security-Policy", `frame-ancestors ${FRAME_ANCESTORS}`);
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.static(path.join(__dirname, "public")));

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
const CALENDLY_URL = process.env.CALENDLY_URL || "";
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
const WEB_SEARCH_TOOL = "web_search_20250305";

const COLLECTIONS = [
  "hospitality", "wellness", "small_business", "nonprofit", "education",
  "creator", "agency", "real_estate", "legal", "author", "ecommerce", "consulting",
].join(", ");

const apiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again in an hour." },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TEXT = 2000;
const MAX_URL = 500;

function validateUrl(input) {
  if (typeof input !== "string" || input.length === 0 || input.length > MAX_URL) return null;
  try {
    const u = new URL(input);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (/[\r\n\t]/.test(input)) return null;
    return u;
  } catch {
    return null;
  }
}

function clamp(value) {
  return typeof value === "string" ? value.slice(0, MAX_TEXT) : "";
}

app.post("/api/review", apiLimiter, async (req, res) => {
  const { action, url, email, site_name, industry, first_impression, start_here } = req.body || {};

  if (action === "lead") {
    if (typeof email !== "string" || !EMAIL_RE.test(email) || email.length > 254) {
      return res.status(400).json({ error: "Valid email required" });
    }
    if (!WEBHOOK_URL) {
      console.error("WEBHOOK_URL not configured — lead dropped:", email);
      return res.status(500).json({ error: "Lead capture unavailable" });
    }

    fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        site_url: clamp(url),
        site_name: clamp(site_name),
        industry: clamp(industry),
        first_impression: clamp(first_impression),
        start_here: clamp(start_here),
        source: "Complimentary Site Review",
        reviewed_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(5000),
    })
      .then((r) => {
        if (!r.ok) console.error("Zapier webhook non-2xx:", r.status, email);
      })
      .catch((err) => console.error("Zapier webhook failed:", err.message, email));

    return res.json({ ok: true, calendly: CALENDLY_URL });
  }

  if (action !== "review") {
    return res.status(400).json({ error: 'Send { action: "review", url: "..." }' });
  }

  const parsedUrl = validateUrl(url);
  if (!parsedUrl) {
    return res.status(400).json({ error: "Valid http(s) URL required" });
  }

  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  }

  const safeUrl = parsedUrl.toString();
  const domain = parsedUrl.hostname.replace(/^www\./, "");

  const prompt = `Senior web strategist at Week of the Website (WOTW). 1,000+ launches since 2014. Warm, direct, specific voice. Analyze ${safeUrl} via web search.

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
    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        tools: [{ type: WEB_SEARCH_TOOL, name: "web_search" }],
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(28000),
    });

    const data = await anthropicResponse.json();

    if (!anthropicResponse.ok || data.type === "error") {
      console.error(
        "Anthropic API error:",
        anthropicResponse.status,
        JSON.stringify(data).slice(0, 800),
      );
      return res.status(502).json({ error: "Upstream review service error" });
    }

    const responseText = (data.content || [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    const clean = responseText.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      try {
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } catch {
        parsed = null;
      }
    }

    if (!parsed) {
      console.error(
        "Could not parse Anthropic response. stop_reason=",
        data.stop_reason,
        "content_types=",
        (data.content || []).map((b) => b.type).join(","),
        "text=",
        clean.slice(0, 500),
      );
      return res.status(500).json({ error: "Could not parse review" });
    }

    return res.json({ ...parsed, calendly: CALENDLY_URL });
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      console.error("Anthropic request timed out");
      return res.status(504).json({ error: "Review timed out, please try again" });
    }
    console.error("Review error:", err.message);
    return res.status(500).json({ error: "Review failed" });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`WOTW Site Review running on port ${PORT}`));
