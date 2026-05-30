# Handoff — The Box · by Still Point v2

## Where it lives

`/home/user/workspace/still-point-box-v2/`

Pure static frontend — no build step, no backend, no localStorage. Three editable JSON files in `data/` drive everything.

## How to run / preview locally

```bash
cd /home/user/workspace/still-point-box-v2
python3 -m http.server 8765
# open http://localhost:8765
```

Add `?preview=1` to demo unlocked answer view.

## Deploy

```python
deploy_website(project_path="/home/user/workspace/still-point-box-v2", site_name="The Box by Still Point")
```

No backend port, no build step. The whole directory is the site root.

## Key files the user will touch

| File                       | What it controls                                                                |
| -------------------------- | ------------------------------------------------------------------------------- |
| `data/objections.json`     | All 140 objection cards. Edit any field, add new entries with a unique `id`.    |
| `data/aliases.json`        | Extra search synonyms keyed by objection id. Optional — aliases also live inline. |
| `data/config.json`         | Brand line, pricing labels (`$2`, `$49`), chips list, Stripe key slots, footer.  |
| `index.html`               | "How to use" and "Signal Reading" modal copy at the bottom — plain HTML.        |
| `README.md`                | Full schema docs + voice rules.                                                  |
| `build_objections.py`      | Optional rebuild script if user wants to re-merge from box_data.json.            |

## What was built

- **Premium black + restrained gold + signal-green accents.** Fraunces display serif paired with Inter body sans. Subtle gradient panel surfaces. No emojis, no AI-aesthetic gradients.
- **Single search card, mobile-first.** Sticky topbar, big search input, 8 chips that auto-search on click, live partial matching, enter to search, clear button.
- **Fuzzy search** over: title, customer line, aliases (inline + external), keywords, category. Exact alias matches score highest (150). Stopwords filtered. Polished cards get a small relevance nudge only when they already match.
- **Result card layout** matches the brief exactly: customer line / signal pill / Soft Open / Pivot / Close / If they push back / Follow-up rail (2–3 prompts).
- **Locked-card paywall**:
  - Default state: blurred answer, visible customer line + signal pill.
  - Two unlock buttons: **Unlock this card — $2**, **Get unlimited — $49**.
  - Opens a modal with both options + a **Preview unlock (no charge)** button for QA.
  - Modal explains Stripe wiring is ready to connect; no false claim of real payment.
  - Footer **Preview mode toggle** flips global locked state. `?preview=1` URL param works too.
- **How to Use modal**: 3-step explanation in Still Point voice (Type → Read top-down → Ask final question, stop talking) + tone pills.
- **Signal Reading modal**: 8 signals (price / trust / delay / spouse / risk / control / payment / prior bad experience) each with a one-liner read.
- **Accessibility**: skip link, `aria-live` results, `aria-pressed`, Escape closes modals, focus on close button when modal opens, no empty focusable buttons, `prefers-reduced-motion` respected, high contrast, larger body text on mobile.
- **Copy card** button on every unlocked card → puts a formatted "across the desk" version on the clipboard.
- **No-match state** shows curated, category-diverse polished cards as suggestions.
- **Custom SVG logo + favicon** — square mark with crosshairs (still-point crosshair) in gold.

## Content quality

- **All 139 objections are polished** in Still Point voice. Every card has a hand-written soft_open, pivot, close, pushback, and 3 follow_up prompts. All appear with a small green **POLISHED** badge.
- Polished copy follows the voice rules: short, calm, witty when appropriate, no padding, no AI-sales fluff, across-the-desk-sayable. No long paragraphs anywhere.

## Editing workflow for the user

The README has a full schema guide. Short version:

- **Edit a card**: open `data/objections.json`, find by `id` (e.g. `G-01`), change any field, refresh browser.
- **Change a price**: edit `data/config.json` → `pricing.single_card_display` or `unlimited_display`.
- **Add an objection**: append to `objections` array with a unique `id` (use `SP-XXX` for new entries).
- **Add an alias**: either inline on the objection or under the id in `data/aliases.json`.

## What's intentionally NOT here

- **Real Stripe checkout.** UI is ready (config slots for keys + price IDs, `handlePay()` stub in `app.js`). When the user provides Stripe keys, wire the redirect inside `handlePay()`. README explains.
- **User accounts / auth.** Out of scope for the preview brief. The second build's auth scaffolding wasn't carried over because the brief said "static frontend if sufficient."
- **Backend database.** Not needed. The original `data.db` was for auth state. JSON files are the system of record.
- **The gold bull asset.** Brief said "prefer a clean mark if asset is heavy." Used a custom inline SVG (still-point crosshair) instead. The bull PNG is still available at `/home/user/workspace/the-box-execution-review/gold_bull.png` if you want to swap.

## Caveats / things to note

1. **Unlock state is session-memory only.** No localStorage by design (sandbox compatibility + brief explicitly forbids it). User refreshes → state resets. For the preview this is correct; once real Stripe is wired you'll get a server-side session.
2. **All 139 cards are fully polished.** Every objection has been rewritten in Still Point voice with unique, card-specific soft_open, pivot, close, pushback, and follow_ups. No generic placeholder text remains.
3. **Search is heuristic, not vector-based.** Works well for the actual objection language we tested (chips, polished cards, partials). If the user encounters a phrase that doesn't match, add it to that card's `aliases` array — search will pick it up on next page load.
4. **Two debug helpers** for the user: the **Preview mode** toggle in the footer (also via `?preview=1`) and the **Preview unlock** button inside the pay modal. The first unlocks everything; the second unlocks just the current card.
5. **QA screenshots** are saved alongside source files (`qa_*.png`). They're not referenced by the app — safe to keep for review or delete before deploy.

## Files for the parent agent

Production files (deploy these):
- `index.html`, `styles.css`, `app.js`
- `assets/favicon.svg`
- `data/objections.json`, `data/aliases.json`, `data/config.json`

Source / docs (keep alongside, harmless):
- `README.md`, `HANDOFF.md`
- `build_objections.py`

QA artifacts (optional, for parent agent review):
- `qa_desktop_empty.png`, `qa_desktop_locked.png`, `qa_unlocked.png`
- `qa_mobile_empty_v2.png`, `qa_mobile_locked.png`, `qa_mobile_unlocked.png`, `qa_mobile_paymodal.png`
- `qa_howto.png`, `qa_signals.png`, `qa_paymodal.png`
- `qa_chip_gap.png`, `qa_nomatch_diverse.png`, `qa_unpolished_sample.png`
