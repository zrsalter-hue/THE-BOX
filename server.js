/* The Box by Still Point — standalone server (Render/Railway/any Node host)
 *
 * This single Node process serves BOTH the website (static files) and the
 * Stripe API. Unlike the Perplexity build, the Stripe secret key is read
 * directly from the STRIPE_SECRET_KEY environment variable you set in your
 * host's dashboard, and we call api.stripe.com directly.
 *
 * Required environment variables (set these in your host dashboard):
 *   STRIPE_SECRET_KEY   - your live secret key (sk_live_...)
 *   PUBLIC_URL          - your site's full URL (e.g. https://thebox.com) — used
 *                         to build Stripe success/cancel redirect URLs
 *   PORT                - assigned automatically by Render/Railway (do not set)
 *   DB_PATH (optional)  - where to store the payments database (default ./data.db)
 */
const express = require("express");
const Database = require("better-sqlite3");
const https = require("https");
const path = require("path");
const { URLSearchParams } = require("url");

const app = express();
app.use(express.json());

// ---- DB (paid visitors) ----
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data.db");
const db = new Database(DB_PATH);
db.exec(`CREATE TABLE IF NOT EXISTS paid (
  visitor_id TEXT,
  session_id TEXT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

// ---- Usage events (visits, searches, unlocks, paywall views) ----
db.exec(`CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  visitor_id TEXT,
  detail TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_events_type_time ON events(type, created_at)`);

// ---- Stripe ----
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || "";
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/+$/, "");
const PRICE_CENTS = 4900;
const PRODUCT_NAME = "The Box — Unlimited Access";

function stripeRequest(p, method, formObj) {
  return new Promise((resolve, reject) => {
    const body = formObj ? new URLSearchParams(formObj).toString() : "";
    const req = https.request(
      {
        hostname: "api.stripe.com",
        path: p,
        method,
        headers: {
          Authorization: `Bearer ${STRIPE_SECRET}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 400) reject(json.error || json);
            else resolve(json);
          } catch (e) {
            reject({ message: "Bad Stripe response", raw: data });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const stripeConfigured = () => !!STRIPE_SECRET;

// On a single-origin host we identify visitors by a cookie-free token the
// client sends. We fall back to IP if absent. (For higher accuracy later,
// issue a signed cookie or have the client persist a UUID in localStorage.)
function visitorId(req) {
  return (
    req.header("X-Visitor-Id") ||
    req.body?.visitor_id ||
    req.query?.visitor_id ||
    req.ip ||
    "anonymous"
  );
}

// Build the return base from PUBLIC_URL if set, else from the request.
function returnBase(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const proto = req.header("x-forwarded-proto") || req.protocol || "https";
  const host = req.header("host");
  return `${proto}://${host}`;
}

// ---- API routes ----
app.get("/api/stripe/status", (req, res) => {
  res.json({ configured: stripeConfigured(), price_cents: PRICE_CENTS });
});

// Record a usage event. type = visit | search | unlock | paywall_view
const ALLOWED_EVENTS = new Set(["visit", "search", "unlock", "paywall_view"]);
app.post("/api/track", (req, res) => {
  try {
    const type = String(req.body && req.body.type || "").slice(0, 32);
    if (!ALLOWED_EVENTS.has(type)) return res.status(400).json({ ok: false });
    const v = visitorId(req);
    const detail = req.body && req.body.detail ? String(req.body.detail).slice(0, 200) : null;
    db.prepare("INSERT INTO events (type, visitor_id, detail) VALUES (?, ?, ?)").run(type, v, detail);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false });
  }
});

// Usage stats for the morning briefing. ?token= must match STATS_TOKEN env (if set).
app.get("/api/stats", (req, res) => {
  const need = process.env.STATS_TOKEN || "";
  if (need && req.query.token !== need) return res.status(403).json({ error: "forbidden" });
  const since24 = "datetime('now','-1 day')";
  const countToday = (type) =>
    db.prepare(`SELECT COUNT(*) n FROM events WHERE type = ? AND created_at >= ${since24}`).get(type).n;
  const countAll = (type) =>
    db.prepare("SELECT COUNT(*) n FROM events WHERE type = ?").get(type).n;
  const uniqVisitors24 =
    db.prepare(`SELECT COUNT(DISTINCT visitor_id) n FROM events WHERE created_at >= ${since24}`).get().n;
  const uniqVisitorsAll =
    db.prepare("SELECT COUNT(DISTINCT visitor_id) n FROM events").get().n;
  const paidCount = db.prepare("SELECT COUNT(*) n FROM paid").get().n;
  res.json({
    last24h: {
      unique_visitors: uniqVisitors24,
      visits: countToday("visit"),
      searches: countToday("search"),
      unlocks: countToday("unlock"),
      paywall_views: countToday("paywall_view"),
    },
    all_time: {
      unique_visitors: uniqVisitorsAll,
      visits: countAll("visit"),
      searches: countAll("search"),
      unlocks: countAll("unlock"),
      paywall_views: countAll("paywall_view"),
      paid_unlocks: paidCount,
    },
  });
});

app.get("/api/access", (req, res) => {
  const v = visitorId(req);
  const row = db.prepare("SELECT 1 FROM paid WHERE visitor_id = ? LIMIT 1").get(v);
  res.json({ unlimited: !!row });
});

app.post("/api/checkout", async (req, res) => {
  if (!stripeConfigured()) return res.status(400).json({ error: "Stripe not configured" });
  const base = returnBase(req);
  const v = visitorId(req);
  try {
    const session = await stripeRequest("/v1/checkout/sessions", "POST", {
      mode: "payment",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][product_data][name]": PRODUCT_NAME,
      "line_items[0][price_data][unit_amount]": String(PRICE_CENTS),
      "line_items[0][quantity]": "1",
      "metadata[visitor_id]": v,
      success_url: `${base}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/?checkout=cancel`,
    });
    res.json({ url: session.url, id: session.id });
  } catch (err) {
    res.status(400).json({ error: err.message || "Checkout failed" });
  }
});

app.post("/api/verify", async (req, res) => {
  if (!stripeConfigured()) return res.status(400).json({ error: "Stripe not configured" });
  const sessionId = req.body && req.body.session_id;
  if (!sessionId) return res.status(400).json({ error: "Missing session_id" });
  if (!/^cs_(live|test)_[a-zA-Z0-9]+$/.test(String(sessionId))) {
    return res.status(400).json({ error: "Invalid session_id" });
  }
  const v = visitorId(req);
  try {
    const session = await stripeRequest(`/v1/checkout/sessions/${sessionId}`, "GET");
    if (session.payment_status === "paid") {
      db.prepare("INSERT OR IGNORE INTO paid (visitor_id, session_id) VALUES (?, ?)").run(v, sessionId);
      return res.json({ unlimited: true });
    }
    res.json({ unlimited: false, status: session.payment_status });
  } catch (err) {
    res.status(400).json({ error: err.message || "Verify failed" });
  }
});

// ---- Static site (serves index.html, app.js, styles.css, data/, assets/) ----
app.use(express.static(__dirname, { extensions: ["html"] }));

// SPA-ish fallback: any non-API GET returns index.html
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, "0.0.0.0", () => console.log(`The Box running on ${PORT}`));
