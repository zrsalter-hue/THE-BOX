# The Box · by Still Point — v2

A premium, fast, calm F&I objection tool. Type the objection → get the move.

This is a **static frontend**. No build step. No backend required. No localStorage. All content lives in editable JSON files in `data/`.

---

## Run it locally

You need to serve over HTTP so the browser can `fetch` the JSON files. Any of these work:

```bash
# Python (recommended — no install)
cd still-point-box-v2
python3 -m http.server 8080

# Node
npx serve .

# PHP
php -S 0.0.0.0:8080
```

Open `http://localhost:8080`.

Add `?preview=1` to the URL to demo unlocked mode.

---

## File layout

```
still-point-box-v2/
├── index.html
├── styles.css
├── app.js
├── assets/
│   └── favicon.svg
├── data/
│   ├── objections.json      ← all 140 objection cards
│   ├── aliases.json         ← search aliases keyed by objection id
│   └── config.json          ← branding, prices, chips, paywall settings
├── build_objections.py      ← optional: regenerate objections.json
└── README.md                ← this file
```

To deploy, upload the entire directory. There is no build step.

---

## How to edit content

### 1. Change prices or the brand line

Edit `data/config.json`:

```json
{
  "brand": {
    "name": "The Box",
    "byline": "by Still Point",
    "footer": "A Still Point tool · Adapted from Zach Salter's Finance Office Field Manual"
  },
  "pricing": {
    "single_card_cents": 200,
    "single_card_display": "$2",
    "unlimited_cents": 4900,
    "unlimited_display": "$49"
  },
  "chips": ["GAP", "Service Contract", "Cash buyer", "..."]
}
```

- `*_display` strings are what shows on buttons. Change them freely.
- `*_cents` are Stripe-ready integers; wire to your Stripe price IDs in `paywall.stripe_*_price_id`.
- `chips` controls the quick-search chips under the search bar.

### 2. Edit an objection card

Open `data/objections.json` and find the entry by `id` (e.g. `G-01`, `T-02`, `SP-CASH`).

```json
{
  "id": "G-01",
  "category": "GAP Protection",
  "category_code": "G",
  "title": "I don't need GAP — I'm a good driver.",
  "customer_line": "I don't need GAP — I'm a good driver.",
  "signal": "risk",
  "soft_open": "If GAP were for bad drivers, we'd sell it in traffic court.",
  "pivot": "GAP isn't about how you drive...",
  "close": "Skill doesn't close that gap...",
  "pushback": "You can be the best driver on the road...",
  "follow_ups": [
    "Has your insurance ever told you the actual payout on a total loss?",
    "How much down are you putting — five percent, ten, none?",
    "Want me to show you the gap on this exact deal in writing?"
  ],
  "aliases": ["i'm a good driver", "don't crash"],
  "keywords": "good driver gap safe driver",
  "polished": true,
  "page": 30
}
```

#### Field guide

| Field             | Purpose                                                                      |
| ----------------- | ---------------------------------------------------------------------------- |
| `id`              | Stable short id. Used internally and in `aliases.json`. Don't change casually. |
| `category`        | Human-readable section (shown on the card).                                  |
| `category_code`   | Single-letter code (`C`, `G`, `L`, `P`, `T`, `W`, `X`).                       |
| `title`           | Used in copy text, often matches `customer_line`.                            |
| `customer_line`   | The headline of the card — what the customer actually says.                  |
| `signal`          | One of: `price`, `trust`, `delay`, `spouse`, `risk`, `control`, `payment`, `prior`. Drives the colored pill. |
| `soft_open`       | One short calm sentence. Defuses emotion.                                    |
| `pivot`           | One or two sentences. Shifts from opinion to structure.                      |
| `close`           | Assigns ownership without pressure. Short.                                   |
| `pushback`        | One line for when they don't yield. Optional but recommended.                |
| `follow_ups`      | 2–3 short prompts/questions for the follow-up rail.                          |
| `aliases`         | Extra phrases that should match this card. Lowercase.                        |
| `keywords`        | Space-separated keywords (legacy from box_data).                             |
| `polished`        | `true` if the card has been hand-written in Still Point voice.                |
| `page`            | Page in the manual, if known.                                                |

**Voice rules** (keep these — they are what makes The Box The Box):

- Short sentences. Across-the-desk-sayable.
- Calm, direct, witty when appropriate.
- No long paragraphs. No motivational fluff.
- Never cheesy. Never AI-sales-y.

### 3. Add a new objection

Append a new object to `objections` in `objections.json`. Use a unique `id` — for net-new entries that aren't in the original manual, prefix with `SP-` (e.g. `SP-EVCHARGE`).

You don't need to touch `aliases.json`; aliases can live inside the objection itself in `aliases`.

### 4. Add search aliases (synonyms)

Two ways:

- **Inline:** Add to the `aliases` array on the objection.
- **External:** Add to `data/aliases.json` keyed by objection `id`:

```json
{
  "G-01": ["i'm a careful driver", "haven't had a wreck in years"]
}
```

The app merges both at load time. Either works.

### 5. Toggle Preview mode for demos

- Click the **Preview mode: off → on** toggle in the footer.
- Or append `?preview=1` to the URL.

Preview mode unlocks every card so you can demo the answer view. It is purely session-memory; refreshing the page reverts to locked.

---

## How the paywall works (preview)

By default, every card shows:

- The customer line (title)
- The signal pill
- A blurred teaser of soft open / pivot / close
- An unlock CTA with two buttons (single + unlimited)

The unlock state is **in-memory only**. Single-unlock survives within the same tab session for the unlocked card. Unlimited unlocks every card until reload. There is intentionally no `localStorage` so the user can't fake state, and so the preview is honest.

### Wiring real payments later

The UI is already pointing at the config. To go live with Stripe:

1. Fill in `data/config.json` → `paywall.stripe_publishable_key`, `paywall.stripe_single_price_id`, `paywall.stripe_unlimited_price_id`.
2. Replace the `handlePay()` function in `app.js` with a redirect to Stripe Checkout (or your own checkout flow).
3. On return from successful payment, set `state.unlimited = true` (or push to `state.unlocked`) before re-rendering.

A simple Express + Stripe Checkout server can sit alongside this without changing the frontend.

### Preview unlock

Inside the paywall modal there's a **Preview unlock (no charge)** button. It unlocks just the current card for QA without flipping the full preview-mode toggle. This is what reviewers should use to see the answer view.

---

## How to Use & Signal Reading content

Both are pure HTML inside `index.html`. Edit them directly — they're at the bottom of the file under their respective `<div class="overlay">` blocks.

---

## Search behavior

- **Fuzzy/partial.** Token-based with stopword filtering. Matches on title, customer line, aliases, keywords, category.
- **Aliases weighted heavily.** Exact alias match scores 150; partial alias inclusion scores up to 40.
- **Live search.** Triggers after 2+ characters.
- **Enter** runs an immediate full search.
- **Chips** auto-search immediately.
- **No match** state shows curated polished suggestions so the rep is never stuck.

---

## Regenerating objections.json

If you ever want to re-merge the original `box_data.json` with the polished overrides, edit `build_objections.py` and run:

```bash
python3 build_objections.py
```

The script reads from `../the-box-execution-review/box_data.json` and writes `data/objections.json`. Polished entries are inside the `POLISHED` dict at the top of the script — you can move newly-hand-edited cards back into Python overrides there to keep them in version control, or just edit `objections.json` directly. Either approach works.

---

## Accessibility

- Skip-to-search link
- Keyboard-navigable modals (Esc to close, focused on open)
- `aria-live` on results
- `aria-pressed` on the preview toggle
- High-contrast text on dark surfaces
- No empty focusable buttons
- Respects `prefers-reduced-motion`

---

## Credits

A Still Point tool · Adapted from Zach Salter's Finance Office Field Manual.
