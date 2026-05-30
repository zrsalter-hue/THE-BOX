# Deploy "The Box" to Your Own Domain — Step-by-Step

This package is a self-contained Node app that serves **both** the website and the
Stripe payment API from one server. It runs as-is on **Render** (my recommendation),
Railway, Fly.io, or any host that runs Node. The guide below is written for Render
because it has a free tier, runs your Node + database with no rewrites, gives you a
free HTTPS certificate, and connects a custom domain in a couple of clicks.

You will do five things. Total time: ~20 minutes.

1. Buy a domain
2. Put this code on GitHub
3. Create the Render service
4. Paste your Stripe secret key + site URL into Render
5. Point your domain at Render

---

## Step 1 — Buy a domain (~$10/yr)

Pick a registrar and search for a name:

- **Cloudflare Registrar** — cheapest, at-cost pricing, no upsells (needs a free Cloudflare account)
- **Porkbun** — cheap, clean, free WHOIS privacy
- **Namecheap** — easy, popular, free WHOIS privacy

### Name ideas (check availability when you search)

| Domain | Angle |
|---|---|
| `thebox.fi` | Short, ".fi" reads as F&I |
| `getinthebox.com` | Action-oriented, memorable |
| `thebox-fi.com` | Literal, clear |
| `stillpointbox.com` | Ties to your Still Point brand |
| `objectionvault.com` | Describes what it is |
| `theboxmanual.com` | Pairs with your field manual |

Buy whichever is available and you like. Come back with the exact domain
(e.g. `getinthebox.com`) — you'll need it in Step 4 and Step 5.

---

## Step 2 — Put the code on GitHub

Render deploys from a GitHub repo.

1. Create a free account at **github.com** if you don't have one.
2. Click **New repository** → name it `the-box` → keep it **Private** → **Create**.
3. On the next page, GitHub shows an "upload existing files" link, OR if you prefer
   the command line, I can hand you the exact `git` commands. Easiest path:
   - On the new empty repo page, click **uploading an existing file**.
   - Drag in **all the files** from the `thebox_render` folder I gave you
     **EXCEPT** the `node_modules` folder and any `data.db` file. (Render installs
     dependencies itself.)
   - Commit.

> Tip: the included `.gitignore` already tells git to skip `node_modules` and the
> database, so if you use the command line those are excluded automatically.

---

## Step 3 — Create the Render service

1. Go to **render.com** → sign up (you can sign in with GitHub).
2. Dashboard → **New +** → **Web Service**.
3. Connect your GitHub and pick the **the-box** repo.
4. Render auto-detects the settings from the included `render.yaml`. Confirm:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** Starter ($7/mo, recommended — stays awake and includes the
     persistent disk for your payment records). The Free plan also works but the
     server sleeps after inactivity and the payment database is wiped on each
     restart, so paid users would lose their unlock. **Use Starter for a real launch.**
5. Click **Create Web Service**. The first build takes 2–3 minutes.

---

## Step 4 — Add your two secrets in Render

In the new service, open the **Environment** tab and add two variables:

| Key | Value |
|---|---|
| `STRIPE_SECRET_KEY` | your live secret key, starts with `sk_live_...` (get it from Stripe → Developers → API keys) |
| `PUBLIC_URL` | your full site URL, e.g. `https://getinthebox.com` (use the exact domain you bought) |

> The `DB_PATH` and `NODE_VERSION` variables are already set for you by `render.yaml`.

Click **Save Changes**. Render redeploys automatically. Once live, visit the
temporary Render URL (looks like `https://the-box.onrender.com`) and confirm the
site loads and a checkout button reaches Stripe.

---

## Step 5 — Connect your domain

1. In Render → your service → **Settings** → **Custom Domains** → **Add Custom Domain**.
2. Enter your domain (both `getinthebox.com` and `www.getinthebox.com` if you want both).
3. Render shows you the DNS records to add. Typically:
   - An **A record** (or **ALIAS/CNAME** for the root) pointing to Render's target
   - A **CNAME** for `www` pointing to your `onrender.com` address
4. Go to your registrar's DNS settings (Cloudflare/Porkbun/Namecheap) and add exactly
   those records.
5. Wait 5–30 minutes for DNS to propagate. Render auto-issues a free HTTPS certificate.
6. Once the custom domain shows **Verified** in Render, **update the `PUBLIC_URL`
   env var (Step 4) to your real domain** if you hadn't already, and save (redeploys).

Done. `https://yourdomain.com` is now live, public, and taking real payments.

---

## After it's live

- Test one real $49 purchase yourself, then refund it in the Stripe dashboard.
- Your payment records live in the persistent disk (`/var/data/data.db`) and survive
  restarts on the Starter plan.
- To make a content change later: edit files locally → push to GitHub → Render
  auto-redeploys.

## Costs summary

| Item | Cost |
|---|---|
| Domain | ~$10/year |
| Render Starter plan | $7/month (recommended) |
| Stripe | 2.9% + 30¢ per successful charge, no monthly fee |

## If anything breaks

- **Site loads but checkout fails:** `STRIPE_SECRET_KEY` is wrong or missing in Render env.
- **Redirect after payment goes to the wrong place:** `PUBLIC_URL` doesn't match your real domain.
- **Paid users lose access after a while:** you're on the Free plan — upgrade to Starter for the persistent disk.
