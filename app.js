/* The Box · by Still Point
 * Static frontend. Loads /data JSON. Fuzzy search.
 * In-memory state only. No localStorage, sessionStorage, or cookies.
 */
(function () {
  "use strict";

  // ---------- API base (local + deployed proxy) ----------
  const API = ""; // same-origin: the Node server serves both the site and the API

  // ---------- State (memory only) ----------
  const state = {
    config: null,
    objections: [],
    aliases: {},
    unlocked: new Set(),     // ids unlocked via the free allowance this session
    unlimited: false,         // paid (or owner/founder) — unlocks everything
    previewMode: false,       // unlocks all answers
    accessRole: "visitor",
    accessExpires: "",
    userEmail: "",
    currentResult: null,
    freeUnlocks: 3,           // how many free card unlocks a visitor gets
    stripeReady: false,       // backend reports a usable Stripe key
  };

  // ---------- DOM helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const esc = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  // ---------- Usage tracking (fire-and-forget) ----------
  let _lastSearchTrack = 0;
  function track(type, detail) {
    try {
      // throttle search events so live-typing doesn't flood: max 1 per 1.5s
      if (type === "search") {
        const now = Date.now();
        if (now - _lastSearchTrack < 1500) return;
        _lastSearchTrack = now;
      }
      fetch(`${API}/api/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: type, detail: detail || null }),
        keepalive: true,
      }).catch(() => {});
    } catch (e) { /* ignore */ }
  }

  // ---------- Load data ----------
  async function loadJson(path) {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`);
    return r.json();
  }

  async function bootstrap() {
    try {
      const [config, objData, aliasesData] = await Promise.all([
        loadJson("data/config.json"),
        loadJson("data/objections.json"),
        loadJson("data/aliases.json"),
      ]);
      state.config = config;
      state.objections = objData.objections || [];
      state.aliases = aliasesData || {};
      // Apply aliases from aliases.json into objection entries if missing
      state.objections.forEach((o) => {
        const aliasList = state.aliases[o.id] || [];
        const merged = Array.from(new Set([...(o.aliases || []), ...aliasList]));
        o._search_blob = [
          o.title,
          o.customer_line,
          o.category,
          o.signal,
          o.keywords || "",
          merged.join(" "),
        ].join(" ").toLowerCase();
        o._aliases_all = merged;
      });

      state.freeUnlocks = (config.paywall && Number.isInteger(config.paywall.free_unlocks))
        ? config.paywall.free_unlocks : 3;

      applyConfig();
      buildChips();
      bindEvents();
      checkUrlParams();
      renderEmpty();
      track("visit");
      // Backend: is Stripe live, and has this visitor already paid?
      await syncAccessFromServer();
      await handleCheckoutReturn();
    } catch (err) {
      console.error(err);
      $("#results").innerHTML = `<div class="empty"><h3>Couldn't load the data</h3><p>${esc(err.message)}</p></div>`;
    }
  }

  // ---------- Backend access sync ----------
  async function syncAccessFromServer() {
    try {
      const s = await fetch(`${API}/api/stripe/status`).then((r) => r.json());
      state.stripeReady = !!(s && s.configured);
    } catch (e) { state.stripeReady = false; }
    try {
      const a = await fetch(`${API}/api/access`).then((r) => r.json());
      if (a && a.unlimited) {
        state.unlimited = true;
        if (state.currentResult) renderResults(state.currentResult);
      }
    } catch (e) { /* offline / local: ignore */ }
  }

  async function handleCheckoutReturn() {
    const params = new URLSearchParams(window.location.search);
    const co = params.get("checkout");
    if (!co) return;
    if (co === "success") {
      const sessionId = params.get("session_id");
      if (sessionId) {
        try {
          const r = await fetch(`${API}/api/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sessionId }),
          }).then((r) => r.json());
          if (r && r.unlimited) {
            state.unlimited = true;
            showToast("Payment confirmed. All cards unlocked.");
          }
        } catch (e) { /* ignore */ }
      }
    } else if (co === "cancel") {
      showToast("Checkout canceled. No charge made.");
    }
    // Clean the URL so a refresh doesn't re-trigger
    const clean = window.location.pathname;
    window.history.replaceState({}, "", clean);
    if (state.currentResult) renderResults(state.currentResult);
  }

  function showToast(msg) {
    let t = $("#toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "toast";
      t.className = "toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 4000);
  }

  function applyConfig() {
    const c = state.config;
    if (!c) return;
    // pay button label
    const upp = $("#payUnlimitedPrice");
    if (upp) upp.textContent = c.pricing.unlimited_display || "$49";
    // Document title from brand
    if (c.brand && c.brand.name) {
      document.title = `${c.brand.name} · ${c.brand.byline || "by Still Point"}`;
    }
    // Footer
    if (c.brand && c.brand.footer) {
      $(".footline").textContent = c.brand.footer;
    }
    updateAccessUi();
  }

  // ---------- Chips ----------
  function buildChips() {
    const chips = (state.config && state.config.chips) || [];
    $("#chips").innerHTML = chips
      .map((c) => `<button type="button" class="chip" data-chip="${esc(c)}">${esc(c)}</button>`)
      .join("");
    $$("#chips .chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const q = btn.dataset.chip;
        $("#q").value = q;
        runSearch(q);
        // Smooth-scroll to results
        $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  // ---------- URL params (preview mode) ----------
  function checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const preview = params.get("preview");
    if ((preview === "1" || preview === "true") && isOwnerEmail(state.userEmail)) {
      enablePreviewMode(true);
    }
  }

  function enablePreviewMode(on) {
    state.previewMode = !!on && isOwnerEmail(state.userEmail);
    const btn = $("#previewToggle");
    btn.setAttribute("aria-pressed", state.previewMode ? "true" : "false");
    btn.textContent = `Preview mode: ${state.previewMode ? "on" : "off"}`;
    // Re-render if there is a result
    if (state.currentResult) renderResults(state.currentResult);
  }

  // ---------- Bind events ----------
  function bindEvents() {
    const input = $("#q");
    const form = $("#searchForm");
    const clear = $("#clearBtn");

    bindGate();

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      runSearch(input.value);
    });
    input.addEventListener("input", () => {
      const val = input.value;
      clear.hidden = val.length === 0;
      // Live search if 2+ chars
      if (val.trim().length >= 2) {
        runSearch(val, { live: true });
      } else if (val.trim().length === 0) {
        state.currentResult = null;
        renderEmpty();
      }
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        runSearch(input.value);
      }
    });
    clear.addEventListener("click", () => {
      input.value = "";
      clear.hidden = true;
      input.focus();
      state.currentResult = null;
      renderEmpty();
    });

    // Modals
    $("#btnHowto").addEventListener("click", () => openModal("howtoOverlay"));
    $("#btnSignals").addEventListener("click", () => openModal("signalsOverlay"));
    $$(".overlay [data-close]").forEach((el) =>
      el.addEventListener("click", () => closeAllModals())
    );
    $$(".overlay").forEach((ov) =>
      ov.addEventListener("click", (e) => {
        if (e.target === ov) closeAllModals();
      })
    );
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAllModals();
    });

    // Preview toggle
    $("#previewToggle").addEventListener("click", () => {
      enablePreviewMode(!state.previewMode);
    });

    // Pay modal button (single $49 unlimited checkout)
    $("#payUnlimited").addEventListener("click", () => handlePay("unlimited"));
    $("#previewUnlock").addEventListener("click", () => {
      // Unlock the most recent card
      if (state.currentResult && state.currentResult[0]) {
        state.unlocked.add(state.currentResult[0].id);
      }
      closeAllModals();
      if (state.currentResult) renderResults(state.currentResult);
    });
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function captureLead(email, source) {
    try {
      fetch(`${API}/api/lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, source: source || "gate" }),
        keepalive: true,
      }).catch(() => {});
    } catch (e) { /* ignore */ }
  }

  // Gate removed — users land directly in the app. Free unlocks gate the
  // valuable content via the Stripe paywall in updateAccessUi() /
  // bindResultEvents(). Email is no longer required up-front; we keep
  // applyAccessForEmail() callable in case an owner/founder email arrives
  // via URL param later.
  function bindGate() {
    // no-op
  }

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function isExpired(dateString) {
    const value = String(dateString || "").trim();
    if (!value) return false;
    return value < todayIso();
  }

  function isOwnerEmail(email) {
    const access = (state.config && state.config.access) || {};
    const owners = access.owner_emails || [];
    const normalized = normalizeEmail(email);
    return owners.map(normalizeEmail).includes(normalized);
  }

  function getFounderPass(email) {
    const access = (state.config && state.config.access) || {};
    const passes = access.founder_passes || [];
    const normalized = normalizeEmail(email);
    return passes.find((pass) => normalizeEmail(pass.email) === normalized && !isExpired(pass.expires));
  }

  function applyAccessForEmail(email) {
    const normalized = normalizeEmail(email);
    state.userEmail = normalized;
    state.accessRole = "visitor";
    state.accessExpires = "";
    state.unlimited = false;
    state.previewMode = false;

    if (isOwnerEmail(normalized)) {
      state.accessRole = "owner";
      state.unlimited = true;
    } else {
      const founderPass = getFounderPass(normalized);
      if (founderPass) {
        state.accessRole = "founder";
        state.accessExpires = founderPass.expires || "";
        state.unlimited = true;
      }
    }

    updateAccessUi();
    if (state.currentResult) renderResults(state.currentResult);
  }

  function updateAccessUi() {
    const status = $("#accessStatus");
    const previewToggle = $("#previewToggle");
    const previewUnlock = $("#previewUnlock");
    const payLead = $("#payLead");

    if (previewToggle) {
      const showPreview = !!(state.config && state.config.paywall && state.config.paywall.show_preview_mode_toggle);
      previewToggle.hidden = !(showPreview && state.accessRole === "owner");
    }

    if (previewUnlock) {
      previewUnlock.hidden = state.accessRole !== "owner";
    }

    if (payLead) {
      payLead.textContent = (state.accessRole !== "visitor" || state.unlimited)
        ? "Your access is already active. Close this window and use the full card."
        : "You've used your 3 free unlocks. Unlock every move — forever — with one payment.";
    }

    if (!status) return;
    if (state.accessRole === "owner") {
      status.hidden = false;
      status.textContent = "Owner access active. All cards unlocked.";
    } else if (state.accessRole === "founder") {
      status.hidden = false;
      status.textContent = state.accessExpires
        ? `Founder access active through ${state.accessExpires}. All cards unlocked.`
        : "Founder access active. All cards unlocked.";
    } else {
      status.hidden = true;
      status.textContent = "";
    }
  }

  function openModal(id) {
    const ov = document.getElementById(id);
    ov.hidden = false;
    document.body.style.overflow = "hidden";
    // Focus first close button for keyboard
    const closeBtn = ov.querySelector("[data-close]");
    if (closeBtn) closeBtn.focus();
  }
  function closeAllModals() {
    $$(".overlay").forEach((ov) => (ov.hidden = true));
    document.body.style.overflow = "";
  }

  // Number of free unlocks the visitor has remaining
  function freeRemaining() {
    return Math.max(0, state.freeUnlocks - state.unlocked.size);
  }

  async function handlePay(type) {
    const c = state.config;
    const cfg = c.paywall || {};
    // Already has full access
    if (state.unlimited || state.previewMode) {
      closeAllModals();
      if (state.currentResult) renderResults(state.currentResult);
      return;
    }
    const btn = $("#payUnlimited");
    if (btn) { btn.disabled = true; btn.textContent = "Opening secure checkout..."; }
    try {
      const res = await fetch(`${API}/api/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin: window.location.origin + window.location.pathname }),
      }).then((r) => r.json());
      if (res && res.url) {
        window.location.href = res.url; // redirect to Stripe Checkout
        return;
      }
      throw new Error((res && res.error) || "Could not start checkout.");
    } catch (err) {
      showToast("Checkout unavailable right now. Please try again.");
      if (btn) { btn.disabled = false; btn.textContent = `${c.pricing.unlimited_label || "Get unlimited"} — ${c.pricing.unlimited_display || "$49"}`; }
    }
  }

  // ---------- Search (fuzzy) ----------
  function tokenize(q) {
    return (q || "")
      .toLowerCase()
      .replace(/[^\w'\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t && t.length >= 2 && !STOP.has(t));
  }
  const STOP = new Set([
    "the","a","an","i","im","i'm","is","it","to","of","in","on","my","me","you",
    "we","they","this","that","be","do","does","just","but","and","or","as","at",
    "for","so","not","no","yes","ok","okay","with","about","really","get","got",
    "have","has","had","need","want","like","can","cant","can't","won","won't",
    "don","don't","didn","didn't","what","why","how","is","are","was","were"
  ]);

  function scoreObjection(obj, qRaw, qTokens) {
    const blob = obj._search_blob;
    const q = qRaw.toLowerCase().trim();
    let score = 0;

    // Exact match in title or customer line. Huge boost.
    if (obj.title.toLowerCase() === q) score += 200;
    if (obj.title.toLowerCase().includes(q) && q.length >= 4) score += 60;
    if (obj.customer_line.toLowerCase().includes(q) && q.length >= 4) score += 50;

    // Phrase intent matters more than a lone keyword. Keep common customer
    // phrasing from collapsing into a generic "think" match.
    if (q.includes("think about") && blob.includes("think about")) score += 90;
    if (q.includes("want to think") && blob.includes("need to think")) score += 80;

    // Alias matches
    for (const a of obj._aliases_all) {
      const al = a.toLowerCase();
      if (al === q) score += 150;
      else if (q.length >= 3 && al.includes(q)) score += 40;
      else if (al.includes(q) && q.length >= 2) score += 15;
    }

    // Category match
    if (obj.category.toLowerCase().includes(q)) score += 25;

    // Token-based
    let tokenHits = 0;
    for (const t of qTokens) {
      if (blob.includes(t)) {
        tokenHits++;
        score += 6;
      }
      // boost match in title
      if (obj.title.toLowerCase().includes(t)) score += 4;
      // boost match in aliases
      for (const a of obj._aliases_all) {
        if (a.toLowerCase().includes(t)) { score += 3; break; }
      }
    }
    // If we have tokens, require at least one hit anywhere. No boost-only matches.
    if (qTokens.length >= 1 && tokenHits === 0 && score === 0) return 0;
    // For multi-token queries, require at least one hit.
    if (qTokens.length > 1 && tokenHits === 0) return 0;

    // Polished boost so good cards rise. Only if there's already a real match.
    if (score > 0 && obj.polished) score += 4;

    return score;
  }

  function search(query) {
    const q = (query || "").trim();
    if (!q) return [];
    const tokens = tokenize(q);
    const scored = state.objections
      .map((o) => ({ obj: o, score: scoreObjection(o, q, tokens) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    return scored.map((s) => s.obj);
  }

  function runSearch(query, opts) {
    opts = opts || {};
    const q = (query || "").trim();
    if (!q) {
      state.currentResult = null;
      renderEmpty();
      return;
    }
    const results = search(q);
    state.currentResult = results;
    track("search", q.slice(0, 120));
    if (results.length === 0) {
      renderNoMatch(q);
      $("#searchMeta").textContent = "No match. Try a shorter phrase or pick a suggestion.";
    } else {
      renderResults(results);
      $("#searchMeta").textContent = `${results.length} match${results.length === 1 ? "" : "es"}. Top result first.`;
    }
  }

  // ---------- Render ----------
  function isUnlocked(obj) {
    return state.previewMode || state.unlimited || state.unlocked.has(obj.id);
  }

  function renderEmpty() {
    $("#searchMeta").textContent = "";
    $("#results").innerHTML = "";
  }

  function renderNoMatch(q) {
    // suggest one polished card per category for breadth
    const seen = new Set();
    const sample = [];
    for (const o of state.objections) {
      if (!o.polished) continue;
      if (seen.has(o.category)) continue;
      seen.add(o.category);
      sample.push(o);
      if (sample.length >= 4) break;
    }
    const sugg = sample
      .map((o) => `<button type="button" class="chip" data-id="${esc(o.id)}">${esc(o.customer_line)}</button>`)
      .join("");
    $("#results").innerHTML = `
      <div class="no-match">
        <h3>Nothing matched "${esc(q)}".</h3>
        <p>Try a shorter phrase or pick one of these to get unstuck:</p>
        <div class="suggest-list">${sugg}</div>
      </div>`;
    $$("#results .suggest-list .chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const obj = state.objections.find((o) => o.id === id);
        if (obj) {
          $("#q").value = obj.customer_line;
          runSearch(obj.customer_line);
        }
      });
    });
  }

  function renderResults(list) {
    const html = list.map((o, i) => renderCard(o, i === 0)).join("");
    $("#results").innerHTML = html;
    // Bind unlock and copy buttons
    $$(".card").forEach((card) => {
      const id = card.dataset.id;
      const obj = state.objections.find((o) => o.id === id);
      if (!obj) return;
      // Free unlock: spend one of the free allowance on this card
      card.querySelectorAll(".free-unlock").forEach((b) =>
        b.addEventListener("click", () => {
          if (freeRemaining() > 0) {
            state.unlocked.add(obj.id);
            track("unlock", obj.id);
            renderResults(state.currentResult);
            const left = freeRemaining();
            showToast(left > 0
              ? `Card unlocked. ${left} free ${left === 1 ? "unlock" : "unlocks"} left.`
              : "That was your last free unlock. Get unlimited for $49.");
          } else {
            state.currentResult = [obj].concat(state.currentResult.filter((x) => x.id !== obj.id));
            track("paywall_view", obj.id);
            openModal("payOverlay");
          }
        })
      );
      // Paid wall: open the $49 checkout modal directly
      card.querySelectorAll(".unlock-trigger").forEach((b) =>
        b.addEventListener("click", () => {
          state.currentResult = [obj].concat(state.currentResult.filter((x) => x.id !== obj.id));
          track("paywall_view", obj.id);
          openModal("payOverlay");
        })
      );
    });
  }

  function teaser(text, words) {
    const w = (text || "").split(/\s+/);
    return w.slice(0, words).join(" ") + (w.length > words ? "..." : "");
  }

  function renderCard(o, isPrimary) {
    const sigClass = `sig-${(o.signal || "control").toLowerCase().replace(/[^a-z]/g, "")}`;
    const unlocked = isUnlocked(o);
    const tw = (state.config.paywall && state.config.paywall.teaser_words) || 14;
    const polished = o.polished ? `<span class="polished-badge" title="Hand-polished Still Point copy">polished</span>` : "";

    const moveText = (label, text, modClass) => {
      if (!text) return "";
      const display = unlocked ? esc(text) : esc(teaser(text, tw));
      return `
        <div class="move ${modClass || ""}">
          <span class="move-label">${label}</span>
          <p class="move-text">${display}</p>
        </div>`;
    };

    const followUps = (o.follow_ups || []).length
      ? `
        <div class="follow-ups${unlocked ? "" : " locked-blur"}">
          <p class="follow-ups-label">Follow-up rail</p>
          <ul class="follow-list">
            ${o.follow_ups.map((q) => `<li>${unlocked ? esc(q) : esc(teaser(q, 5))}</li>`).join("")}
          </ul>
        </div>`
      : "";

    const remaining = freeRemaining();
    const unlimitedLabel = `${esc(state.config.pricing.unlimited_label || "Get unlimited")} — ${esc(state.config.pricing.unlimited_display || "$49")}`;
    const lockIcon = `<svg class="lock-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;

    const unlimitedCta = `Unlock all ${state.objections.length} moves — ${esc(state.config.pricing.unlimited_display || "$49")} once`;
    const lockCta = unlocked
      ? ""
      : remaining > 0
      ? `
        <div class="lock-cta">
          <div class="lock-cta-head">
            ${lockIcon}
            <h4 class="lock-cta-title">You're one line away from the close</h4>
          </div>
          <p class="lock-cta-sub">You've got the opening. The pivot, the close, and the pushback answer — the part that actually saves the deal — is right here. Don't wing the moment that matters most. <strong>${remaining} free ${remaining === 1 ? "unlock" : "unlocks"} left.</strong></p>
          <div class="lock-buttons">
            <button type="button" class="btn btn-primary free-unlock">See the full move (free — ${remaining} left)</button>
            <button type="button" class="btn btn-secondary unlock-trigger">${unlimitedCta}</button>
          </div>
          <p class="lock-fineprint">Lifetime access. Less than you make on a single deal.</p>
        </div>`
      : `
        <div class="lock-cta">
          <div class="lock-cta-head">
            ${lockIcon}
            <h4 class="lock-cta-title">You've seen what it does. Now own all ${state.objections.length}.</h4>
          </div>
          <p class="lock-cta-sub">Every objection, every move — the soft open, pivot, close, and pushback for all ${state.objections.length} situations. Ready the second a customer opens their mouth.</p>
          <div class="lock-buttons">
            <button type="button" class="btn btn-primary unlock-trigger">${unlimitedCta}</button>
          </div>
          <p class="lock-fineprint">One payment. Lifetime access. Less than you make on a single deal.</p>
        </div>`;

    return `
      <article class="card ${unlocked ? "unlocked" : "locked"}" data-id="${esc(o.id)}" tabindex="0">
        <header class="card-head">
          <div class="card-head-left">
            <p class="card-category">${esc(o.category)}${polished}</p>
            <h2 class="card-title">${esc(o.customer_line)}</h2>
          </div>
          <span class="card-id">${esc(o.id)}</span>
        </header>

        <div class="signal-row">
          <span class="signal-label">Signal</span>
          <span class="sig-tag ${sigClass}"${o.signal_read ? ` title="${esc(o.signal_read)}"` : ""}>${esc(o.signal || "control")}</span>
        </div>
        ${o.signal_read && unlocked ? `<p class="signal-read">${esc(o.signal_read)}</p>` : ""}

        ${moveText("Soft open", o.soft_open)}
        ${moveText("Pivot", o.pivot)}
        ${moveText("Close", o.close, "move-close")}
        ${o.pushback ? moveText("If they push back", o.pushback, "move-pushback") : ""}

        ${followUps}
        ${lockCta}
      </article>`;
  }

  // ---------- Go ----------
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
