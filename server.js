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
