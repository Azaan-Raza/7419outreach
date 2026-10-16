// Member app: sign in, what's happening right now, outreach and shop progress, clock in / out with a photo, history.

import { db, ready, suggestHours } from "./db.js";
import { $, $$, esc, fmtDay, fmtTime, fmtHours, fmtDuration, roundQuarter, progressBar, statusText, chip, segmented, toast, sheet, sheetHead, isIOS, isStandalone, liveTimer, setBusy, initials, CAMERA } from "./ui.js";
import { pickPhoto, preparePhoto } from "./photo.js";
import { photoCell, hydratePhotos } from "./photos-ui.js";

const app = $("#app"), navRight = $("#nav-right");
const state = { user: null, settings: null, sessions: [], progress: null, open: null, authTab: "signin", loading: false };
let stopTimer = null;

// Admins set the required photo object in Settings (it can change per event). A generic value means none named yet.
const specificObject = (st) => (st?.verificationObject && !/specified by an? (lead|admin)/i.test(st.verificationObject) ? st.verificationObject : null);
const objectLine = (st) => (specificObject(st) ? `Required in the photo: <b>${esc(specificObject(st))}</b>.` : "Photos must include the object specified by an admin for the event.");

/* ---------------- boot ---------------- */
(async function boot() {
  try { await ready; } catch (e) { app.innerHTML = `<div class="card"><p class="empty">Couldn't start: ${esc(e.message)}</p></div>`; return; }
  if (db.mode === "demo") $("#demo-banner").classList.remove("hidden");
  db.onAuthChange(() => refresh());
  await refresh();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();

async function refresh() {
  if (state.loading) return;
  state.loading = true;
  try {
    state.user = await db.getUser();
    state.settings = await db.getSettings();
    if (state.user && db.recoveryPending) { renderSetPassword(); return; }
    if (state.user) {
      [state.sessions, state.progress] = await Promise.all([db.listMySessions(), db.myProgress()]);
      state.open = state.sessions.find((s) => s.status === "open") || null;
      renderHome();
    } else renderLanding();
  } catch (e) {
    toast(e.message);
    if (!state.user) renderLanding();
  } finally { state.loading = false; }
}

/* ---------------- sign in / create account ---------------- */
function renderLanding() {
  if (stopTimer) { stopTimer(); stopTimer = null; }
  navRight.innerHTML = "";
  if (state.authTab === "forgot") return renderForgot();
  const st = state.settings || {}, req = Number(st.requiredHours) || 10;
  const signup = state.authTab === "signup";
  app.innerHTML = `
  <div class="auth view">
    <img class="auth__logo" src="icons/logo.svg" alt="">
    <h1 class="large-title">${signup ? "Create account" : "Outreach Tracker"}</h1>
    <p class="lead subhead">Team 7419</p>
    <form id="auth-form" novalidate>
      <div class="fieldset">
        ${signup ? `<label class="field"><span class="field__label">Name</span><input class="input" id="name" name="name" type="text" autocomplete="name" required></label>` : ""}
        <label class="field"><span class="field__label">Email</span><input class="input" id="email" name="email" type="email" autocomplete="email" inputmode="email" required></label>
        ${signup ? `<label class="field"><span class="field__label">Grade</span><select class="input" id="grade" name="grade"><option value="">Select</option><option>9</option><option>10</option><option>11</option><option>12</option></select></label>` : ""}
        <label class="field"><span class="field__label">Password${signup ? ` <span class="opt">(6 or more characters)</span>` : ""}</span><input class="input" id="password" name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" ${signup ? 'minlength="6"' : ""} required></label>
      </div>
      <p class="form-error" id="auth-error"></p>
      <button class="btn btn--primary btn--full" type="submit">${signup ? "Create account" : "Sign in"}</button>
    </form>
    <div class="aux">
      ${signup
        ? `<button type="button" class="link" data-tab="signin">Already have an account? Sign in</button>`
        : `<button type="button" class="link" data-tab="forgot">Forgot password?</button><button type="button" class="link" data-tab="signup">Create account</button>`}
    </div>
    <p class="req footnote">${esc(st.semesterName || "This semester")} requirement: ${esc(fmtHours(req))} hours per member.</p>
    ${db.mode === "demo" ? `<p class="footnote text-3 center mt-2">Demo accounts: alex@example.com, jordan@example.com, sam@example.com. Password: demo.</p>` : ""}
    <p class="footer-links"><a href="admin.html">Admin</a></p>
  </div>`;
  $$("[data-tab]", app).forEach((b) => b.addEventListener("click", () => { state.authTab = b.dataset.tab; renderLanding(); }));
  $("#auth-form").addEventListener("submit", onAuthSubmit);
}

function renderForgot() {
  app.innerHTML = `
  <div class="auth view">
    <img class="auth__logo" src="icons/logo.svg" alt="">
    <h1 class="large-title">Reset password</h1>
    <p class="lead subhead">We'll email you a link to set a new one.</p>
    <form id="forgot-form" novalidate>
      <div class="fieldset"><label class="field"><span class="field__label">Email</span><input class="input" id="email" name="email" type="email" autocomplete="email" inputmode="email" required></label></div>
      <p class="form-error" id="auth-error"></p>
      <button class="btn btn--primary btn--full" type="submit">Send reset email</button>
    </form>
    <div class="aux"><button type="button" class="link" data-tab="signin">Back to sign in</button></div>
  </div>`;
  $$("[data-tab]", app).forEach((b) => b.addEventListener("click", () => { state.authTab = b.dataset.tab; renderLanding(); }));
  $("#forgot-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget, btn = form.querySelector("button"), err = $("#auth-error"), email = $("#email").value.trim();
    err.textContent = "";
    if (!email) { err.textContent = "Email is required."; return; }
    setBusy(btn, true, "Sending");
    try {
      const r = await db.sendPasswordReset(email);
      form.innerHTML = r.demo
        ? `<div class="notice notice--muted">Demo mode: every demo account uses the password <b>&nbsp;demo</b>.</div>`
        : `<div class="notice">Check your email for a link to reset your password. If it doesn't appear within a few minutes, check your spam folder.</div>`;
    } catch (ex) { err.textContent = ex.message; setBusy(btn, false); }
  });
}

function renderSetPassword() {
  if (stopTimer) { stopTimer(); stopTimer = null; }
  navRight.innerHTML = "";
  app.innerHTML = `
  <div class="auth view">
    <img class="auth__logo" src="icons/logo.svg" alt="">
    <h1 class="large-title">New password</h1>
    <p class="lead subhead">${esc(state.user?.email || "")}</p>
    <form id="setpw-form" novalidate>
      <div class="fieldset">
        <label class="field"><span class="field__label">New password <span class="opt">(6 or more characters)</span></span><input class="input" id="pw1" type="password" autocomplete="new-password" minlength="6" required></label>
        <label class="field"><span class="field__label">Confirm new password</span><input class="input" id="pw2" type="password" autocomplete="new-password" minlength="6" required></label>
      </div>
      <p class="form-error" id="auth-error"></p>
      <button class="btn btn--primary btn--full" type="submit">Set password</button>
    </form>
  </div>`;
  $("#setpw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.currentTarget.querySelector("button"), err = $("#auth-error"), p1 = $("#pw1").value, p2 = $("#pw2").value;
    err.textContent = "";
    if (p1.length < 6) { err.textContent = "Password must be at least 6 characters."; return; }
    if (p1 !== p2) { err.textContent = "Passwords don't match."; return; }
    setBusy(btn, true, "Saving");
    try { await db.updatePassword(p1); db.recoveryPending = false; history.replaceState(null, "", location.pathname + location.search); toast("Password updated"); await refresh(); }
    catch (ex) { err.textContent = ex.message; setBusy(btn, false); }
  });
}

async function onAuthSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget, btn = form.querySelector("button[type=submit]"), err = $("#auth-error");
  const f = Object.fromEntries(new FormData(form).entries());
  err.textContent = "";
  if (!f.email || !f.password || (state.authTab === "signup" && !f.name)) { err.textContent = "All fields are required."; return; }
  setBusy(btn, true, state.authTab === "signup" ? "Creating account" : "Signing in");
  try {
    if (state.authTab === "signup") {
      const r = await db.signUp(f);
      if (r.needsConfirm) { setBusy(btn, false); form.innerHTML = `<div class="notice">Confirmation link sent to <b>&nbsp;${esc(f.email)}</b>. Open it, then sign in.</div>`; return; }
    } else await db.signIn(f);
    await refresh();
  } catch (ex) { err.textContent = ex.message; setBusy(btn, false); }
}

/* ---------------- home ---------------- */
function renderHome() {
  const { user, settings: st, progress: pr, sessions, open } = state;
  const req = Number(st.requiredHours) || 10, approved = pr.approvedHours, pending = pr.pendingHours, done = approved >= req;
  const shop = pr.shopHours || 0, shopPending = pr.shopPendingHours || 0, reqShop = Number(st.requiredShopHours) || 0;
  const showInstall = isIOS() && !isStandalone() && !localStorage.getItem("install-tip-dismissed");
  navRight.innerHTML = "";

  app.innerHTML = `
  <div class="view">
    <header class="page-head">
      <h1 class="large-title">Outreach Tracker</h1>
      <p class="subtitle">${esc(st.semesterName)}, ${esc(fmtHours(req))} hours required</p>
    </header>

    <section class="card" id="status-card">
      ${open ? `
        <div class="card__head"><span class="status status--open">Clocked in</span>${chip(open.category)}</div>
        <div class="number" id="elapsed">${esc(fmtDuration(Date.now() - new Date(open.clockInAt).getTime()))}</div>
        <p class="footnote text-2 mt-1">Since ${esc(fmtTime(open.clockInAt))}${open.event ? `, ${esc(open.event)}` : ""}</p>
        <button class="btn btn--primary btn--full mt-3" id="clock-out" type="button">Clock out</button>
        <p class="footnote text-3 mt-2">If you forget to clock out, an admin can close the session. The time stops when they do.</p>
      ` : `
        <h2 class="headline">Not clocked in</h2>
        <p class="mono-note mt-1">${objectLine(st)}</p>
        <button class="btn btn--primary btn--full mt-3" id="clock-in" type="button">Clock in</button>
      `}
    </section>

    ${showInstall ? `<div class="notice mt-3" id="install-tip"><span><b>Add to Home Screen</b>: in Safari tap Share, then Add to Home Screen.</span><button type="button" class="x" aria-label="Dismiss">&#x2715;</button></div>` : ""}

    <section class="card mt-3">
      <div class="card__head"><h2 class="card__title">Outreach</h2>${user.excused ? `<span class="status status--neutral">Excused</span>` : done ? `<span class="status status--approved">Requirement met</span>` : ""}</div>
      <div class="number">${esc(fmtHours(approved))}<span class="unit">/ ${esc(fmtHours(req))} h approved</span></div>
      <div class="mt-2">${progressBar({ approved, pending, required: req, excused: user.excused })}</div>
      ${user.excused && user.excusedNote ? `<p class="footnote text-2 mt-1">${esc(user.excusedNote)}</p>` : ""}
    </section>

    ${db.shopReady ? `
    <section class="card">
      <div class="card__head"><h2 class="card__title">Shop</h2></div>
      <div class="number">${esc(fmtHours(shop))}<span class="unit">${reqShop > 0 ? `/ ${esc(fmtHours(reqShop))} h` : "h this semester"}</span></div>
      ${reqShop > 0 ? `<div class="mt-2">${progressBar({ approved: shop, pending: shopPending, required: reqShop, excused: user.excused })}</div>` : roundQuarter(shopPending) ? `<p class="footnote text-2 mt-1">${esc(fmtHours(roundQuarter(shopPending)))} h waiting for review</p>` : ""}
    </section>` : ""}

    <h2 class="section-title">Sessions<small>${sessions.length} this semester</small></h2>
    <div class="group" id="sessions">${sessions.length ? sessions.map(sessionRow).join("") : `<p class="empty">No sessions yet</p>`}</div>

    <h2 class="section-title">Account</h2>
    <div class="group">
      <div class="row">
        <span class="avatar">${esc(initials(user.name || user.email))}</span>
        <div class="row__main"><div class="row__title">${esc(user.name || "No name")}</div><div class="row__sub">${esc(user.email)}</div></div>
        <button type="button" class="btn btn--small btn--tinted" id="signout">Sign out</button>
      </div>
    </div>
    <p class="footer-links"><a href="admin.html">Admin</a></p>
  </div>`;

  $("#signout").addEventListener("click", async () => { await db.signOut(); state.authTab = "signin"; await refresh(); });
  if (open) { if (stopTimer) stopTimer(); stopTimer = liveTimer($("#elapsed"), open.clockInAt); $("#clock-out").addEventListener("click", () => openClockSheet("out")); }
  else { if (stopTimer) { stopTimer(); stopTimer = null; } $("#clock-in").addEventListener("click", () => openClockSheet("in")); }
  const tip = $("#install-tip");
  if (tip) tip.querySelector(".x").addEventListener("click", () => { localStorage.setItem("install-tip-dismissed", "1"); tip.remove(); });
  hydratePhotos(app);
}

function sessionRow(s) {
  if (s.manual) {
    return `
    <div class="srow" data-id="${esc(s.id)}">
      <div class="srow__top">
        <div class="row__main"><div class="row__title">${esc(s.event || "Hours added by an admin")} ${chip(s.category)}</div><div class="row__sub">${esc(fmtDay(s.clockInAt))}, added by an admin</div></div>
        <div class="row__trail"><b>${esc(fmtHours(s.approvedHours))}</b>hours</div>
      </div>
      <div class="srow__meta">${statusText("approved")}</div>
      ${s.adminNote ? `<p class="footnote text-2 mt-1">${esc(s.adminNote)}</p>` : ""}
    </div>`;
  }
  let hours, hint = "hours";
  if (s.status === "approved") hours = fmtHours(s.approvedHours);
  else if (s.status === "pending") { hours = fmtHours(suggestHours(s)); hint = "on the clock"; }
  else if (s.status === "open") { hours = fmtDuration(Date.now() - new Date(s.clockInAt).getTime()); hint = "so far"; }
  else hours = "0";
  const range = s.clockOutAt ? `${fmtTime(s.clockInAt)} – ${fmtTime(s.clockOutAt)}` : `from ${fmtTime(s.clockInAt)}`;
  return `
  <div class="srow" data-id="${esc(s.id)}">
    <div class="srow__top">
      <div class="row__main"><div class="row__title">${esc(s.event || (s.category === "shop" ? "Shop" : "Outreach"))} ${chip(s.category)}</div><div class="row__sub">${esc(fmtDay(s.clockInAt))}, ${esc(range)}</div></div>
      <div class="row__trail"><b>${esc(hours)}</b>${esc(hint)}</div>
    </div>
    <div class="srow__meta">${statusText(s.status)}</div>
    <div class="photos">${photoCell(s.clockInPhoto, "Clock in", s.clockInAt, s)}${photoCell(s.clockOutPhoto, "Clock out", s.clockOutAt, s)}</div>
    ${s.adminNote ? `<div class="notice ${s.status === "rejected" ? "notice--error" : "notice--muted"} footnote mt-2">${esc(s.adminNote)}</div>` : ""}
  </div>`;
}

/* ---------------- clock in / out ---------------- */
const captureHtml = () => `<label class="capture" for="photo-input">${CAMERA}<strong>Take photo</strong><input id="photo-input" type="file" accept="image/*" capture="environment"></label>`;

function openClockSheet(kind) {
  const st = state.settings, open = state.open, user = state.user;
  const events = [...new Set(state.sessions.map((s) => s.event).filter(Boolean))].slice(0, 8);
  let photo = null, tick;
  let category = db.shopReady && localStorage.getItem("last-category") === "shop" ? "shop" : "outreach";
  const placeholderFor = (c) => (c === "shop" ? "example: build session" : "example: FTC Meet 9/20");

  const el = sheet.open(`
    ${sheetHead(kind === "in" ? "Clock in" : "Clock out", `Current time <b id="now-time">${esc(fmtTime(new Date()))}</b>${kind === "out" ? `. Clocked in at ${esc(fmtTime(open.clockInAt))}` : ""}`)}
    <div class="sheet__body">
      ${kind === "in" && db.shopReady ? `<div class="field"><span class="field__label">Type</span><div id="cat-seg"></div></div>` : ""}
      ${kind === "in" ? `<label class="field"><span class="field__label">Event</span><input class="input" id="event" type="text" list="event-list" placeholder="${placeholderFor(category)}" autocomplete="off" maxlength="80"><datalist id="event-list">${events.map((e) => `<option value="${esc(e)}">`).join("")}</datalist></label>` : ""}
      <p class="mono-note mb-2">${objectLine(st)}</p>
      <div id="capture-wrap">${captureHtml()}</div>
      ${kind === "out" ? `<label class="field mt-3"><span class="field__label">Note for the admin <span class="opt">(optional)</span></span><textarea class="input" id="note" rows="2" maxlength="300"></textarea></label>` : ""}
      <p class="form-error mt-2" id="clock-error"></p>
    </div>
    <div class="sheet__actions"><button class="btn btn--primary btn--full" id="confirm" type="button" disabled>${kind === "in" ? "Clock in" : "Clock out"}</button></div>
  `, { onClose: () => clearInterval(tick) });

  if (kind === "in" && db.shopReady) {
    segmented($("#cat-seg", el), { items: [{ value: "outreach", label: "Outreach" }, { value: "shop", label: "Shop" }], value: category, onChange: (v) => { category = v; const ev = $("#event", el); if (ev) ev.placeholder = placeholderFor(v); } });
  }
  tick = setInterval(() => { const n = $("#now-time", el); if (n) n.textContent = fmtTime(new Date()); }, 1000);

  const wrap = $("#capture-wrap", el), confirm = $("#confirm", el), err = $("#clock-error", el);
  const bindInput = () => {
    const input = $("#photo-input", wrap);
    if (!input) return;
    (async () => {
      const file = await pickPhoto(input);
      if (!file) { bindInput(); return; }
      err.textContent = "";
      try {
        photo = await preparePhoto(file, { name: user.name || user.email, kind });
        wrap.innerHTML = `<div class="capture capture--has"><img src="${photo.url}" alt="Your photo"><button type="button" class="btn btn--small retake">Retake</button></div>`;
        confirm.disabled = false;
        $(".retake", wrap).addEventListener("click", () => { photo = null; confirm.disabled = true; wrap.innerHTML = captureHtml(); bindInput(); });
      } catch (ex) { err.textContent = ex.message; wrap.innerHTML = captureHtml(); bindInput(); }
    })();
  };
  bindInput();

  confirm.addEventListener("click", async () => {
    if (!photo) { err.textContent = "A photo is required."; return; }
    setBusy(confirm, true, kind === "in" ? "Clocking in" : "Clocking out");
    try {
      if (kind === "in") { await db.clockIn({ event: $("#event", el).value, photoBlob: photo.blob, category }); localStorage.setItem("last-category", category); }
      else await db.clockOut({ sessionId: open.id, photoBlob: photo.blob, note: $("#note", el).value });
      sheet.close();
      const autoApproved = kind === "out" && open.category === "shop" && !state.settings.shopRequiresReview;
      toast(kind === "in" ? `Clocked in at ${fmtTime(new Date())}` : autoApproved ? `Clocked out at ${fmtTime(new Date())}, shop hours recorded` : `Clocked out at ${fmtTime(new Date())}, waiting for review`);
      await refresh();
    } catch (ex) { err.textContent = ex.message; setBusy(confirm, false); }
  });
}
