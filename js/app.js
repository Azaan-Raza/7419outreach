// Member app: sign in, progress toward the semester requirement, clock in / clock out with a photo, history.

import { db, ready, suggestHours } from "./db.js";
import { $, $$, esc, fmtDay, fmtTime, fmtHours, fmtDuration, progressBar, statusTag, toast, sheet, isIOS, isStandalone, liveTimer, setBusy } from "./ui.js";
import { pickPhoto, preparePhoto } from "./photo.js";
import { photoCell, hydratePhotos } from "./photos-ui.js";
import { icon } from "./icons.js";

const app = $("#app");
const top = $("#topbar-right");
// Admins set the required photo object in Settings (it can change per event). A generic value means "no specific object named yet".
const specificObject = (st) => (st?.verificationObject && !/specified by an? (lead|admin)/i.test(st.verificationObject) ? st.verificationObject : null);
const state = { user: null, settings: null, sessions: [], progress: null, open: null, authTab: "signin", loading: false };
let stopTimer = null;

/* ---------------- boot ---------------- */
(async function boot() {
  try { await ready; } catch (e) { app.innerHTML = `<div class="blankslate">${icon("alert", 24)}<h3 class="blankslate-heading">Couldn't start</h3><p>${esc(e.message)}</p></div>`; return; }
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
    if (state.user) {
      [state.sessions, state.progress] = await Promise.all([db.listMySessions(), db.myProgress()]);
      state.open = state.sessions.find((s) => s.status === "open") || null;
      renderHome();
    } else {
      renderLanding();
    }
  } catch (e) {
    toast(e.message, "error");
    if (!state.user) renderLanding();
  } finally {
    state.loading = false;
  }
}

/* ---------------- sign in / create account ---------------- */
function renderLanding() {
  if (stopTimer) { stopTimer(); stopTimer = null; }
  top.innerHTML = "";
  const st = state.settings || {};
  const signup = state.authTab === "signup";
  app.innerHTML = `
  <div class="auth-page">
    <div class="text-center"><img src="icons/logo.svg" width="48" height="48" alt="" style="border-radius:50%"></div>
    <h1>${signup ? "Create your account" : "Sign in to Outreach Tracker"}</h1>
    <p class="text-center color-fg-muted f5 mb-3">Team 7419</p>
    <div class="flash f6 mb-3">${icon("info")} ${esc(st.semesterName || "This semester")} requirement: <b>${esc(fmtHours(st.requiredHours || 9))} hours</b> per member.</div>
    <div class="auth-form">
      <form id="auth-form" novalidate>
        ${signup ? `
        <div class="form-group"><label for="name">Name</label><input class="form-control" id="name" name="name" type="text" autocomplete="name" placeholder="First and last" required></div>
        <div class="field-row">
          <div class="form-group"><label for="email">Email</label><input class="form-control" id="email" name="email" type="email" autocomplete="email" inputmode="email" required></div>
          <div class="form-group"><label for="grade">Grade</label>
            <select class="form-select width-full" id="grade" name="grade"><option value="">Select</option><option>9</option><option>10</option><option>11</option><option>12</option></select></div>
        </div>
        <div class="form-group"><label for="password">Password</label><input class="form-control" id="password" name="password" type="password" autocomplete="new-password" minlength="6" required><span class="note">At least 6 characters.</span></div>
        ` : `
        <div class="form-group"><label for="email">Email</label><input class="form-control" id="email" name="email" type="email" autocomplete="email" inputmode="email" required></div>
        <div class="form-group"><label for="password">Password</label><input class="form-control" id="password" name="password" type="password" autocomplete="current-password" required></div>
        `}
        <div class="form-error" id="auth-error"></div>
        <button class="btn btn-primary btn-block" type="submit">${signup ? "Create account" : "Sign in"}</button>
      </form>
    </div>
    <div class="callout">${signup ? `Already have an account? <a href="#" data-tab="signin">Sign in.</a>` : `New here? <a href="#" data-tab="signup">Create an account.</a>`}</div>
    ${db.mode === "demo" ? `<p class="f6 color-fg-muted text-center mt-3">Demo accounts: alex@example.com, jordan@example.com, sam@example.com. Password: demo.</p>` : ""}
  </div>`;

  $$("[data-tab]", app).forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); state.authTab = a.dataset.tab; renderLanding(); }));
  $("#auth-form").addEventListener("submit", onAuthSubmit);
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
      if (r.needsConfirm) {
        setBusy(btn, false);
        form.innerHTML = `<div class="flash flash-success f6 mb-0">${icon("mail")} Confirmation link sent to <b>${esc(f.email)}</b>. Open it, then sign in.</div>`;
        return;
      }
    } else {
      await db.signIn(f);
    }
    await refresh();
  } catch (ex) {
    err.textContent = ex.message;
    setBusy(btn, false);
  }
}

/* ---------------- home ---------------- */
function renderHome() {
  const { user, settings: st, progress: pr, sessions, open } = state;
  const req = Number(st.requiredHours) || 9;
  const approved = pr.approvedHours, pending = pr.pendingHours;
  const done = approved >= req;

  top.innerHTML = `<span class="f6 hide-sm-inline mr-3" style="color:var(--header-fgColor-default)">${esc(user.name || user.email)}</span><button class="btn btn-sm btn-header" id="signout">${icon("sign-out")}Sign out</button>`;
  $("#signout").addEventListener("click", async () => { await db.signOut(); state.authTab = "signin"; await refresh(); });

  const showInstall = isIOS() && !isStandalone() && !localStorage.getItem("install-tip-dismissed");

  app.innerHTML = `
  <div class="d-flex flex-items-center flex-justify-between mb-3" style="gap:12px">
    <div><h1 class="f3 text-semibold lh-condensed mb-0">Outreach Tracker</h1><div class="page-sub">${esc(st.semesterName)}, ${esc(fmtHours(req))} hours required</div></div>
    ${user.excused ? `<span class="State State--draft">Excused</span>` : done ? `<span class="State State--success">${icon("check")} Requirement met</span>` : ""}
  </div>

  <div class="Box">
    <div class="Box-header d-flex"><h2 class="Box-title flex-auto">Progress</h2></div>
    <div class="Box-body">
      <div class="big-number">${esc(fmtHours(approved))}<small>/ ${esc(fmtHours(req))} hours approved</small></div>
      <div class="mt-2">${progressBar({ approved, pending, required: req, excused: user.excused })}</div>
      ${user.excused && user.excusedNote ? `<p class="f6 color-fg-muted mt-2 mb-0">${esc(user.excusedNote)}</p>` : ""}
    </div>
  </div>

  <div class="Box" id="status-card">
    <div class="Box-header"><h2 class="Box-title">Status</h2></div>
    <div class="Box-body">
      ${open ? `
        <div class="d-flex flex-items-center flex-wrap" style="gap:12px 16px">
          <div class="flex-auto">
            <span class="State State--open"><span class="dot"></span>Clocked in</span>
            <div class="elapsed mt-2" id="elapsed">${esc(fmtDuration(Date.now() - new Date(open.clockInAt).getTime()))}</div>
            <div class="f6 color-fg-muted">Since ${esc(fmtTime(open.clockInAt))}${open.event ? ` · ${esc(open.event)}` : ""}</div>
          </div>
          <button class="btn btn-primary btn-large" id="clock-out">${icon("stopwatch")}Clock out</button>
        </div>
        <p class="f6 color-fg-muted mt-3 mb-0">If you forget to clock out, an admin can close the session. The time stops when they do.</p>
      ` : `
        <div class="d-flex flex-items-center flex-wrap" style="gap:12px 16px">
          <div class="flex-auto">
            <span class="State State--draft">Not clocked in</span>
            <p class="mono-note mt-2 mb-0">Photos must include the object specified by an admin for the event.${specificObject(st) ? ` Current: <b>${esc(specificObject(st))}</b>.` : ""}</p>
          </div>
          <button class="btn btn-primary btn-large" id="clock-in">${icon("device-camera")}Clock in</button>
        </div>
      `}
    </div>
  </div>

  ${showInstall ? `
  <div class="flash d-flex flex-items-center mt-3" id="install-tip" style="gap:8px">${icon("share-android")}<span class="flex-auto f6"><b>Add to home screen:</b> in Safari tap Share, then <b>Add to Home Screen</b>.</span><button type="button" class="close-button" aria-label="Dismiss">${icon("x")}</button></div>` : ""}

  <div class="Box">
    <div class="Box-header d-flex"><h2 class="Box-title flex-auto">Sessions</h2><span class="Counter">${sessions.length}</span></div>
    <div id="sessions">
      ${sessions.length ? sessions.map(sessionRow).join("") : `<div class="blankslate">${icon("clock", 24)}<h3 class="blankslate-heading">No sessions yet</h3></div>`}
    </div>
  </div>

  <div class="Box">
    <div class="Box-header"><h2 class="Box-title">Account</h2></div>
    <div class="Box-row d-flex flex-items-center">
      <span class="initials">${esc((user.name || user.email).split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase())}</span>
      <div class="flex-auto"><div class="text-semibold">${esc(user.name || "No name")}</div><div class="f6 color-fg-muted">${esc(user.email)}</div></div>
    </div>
  </div>`;

  if (open) {
    if (stopTimer) stopTimer();
    stopTimer = liveTimer($("#elapsed"), open.clockInAt);
    $("#clock-out").addEventListener("click", () => openClockSheet("out"));
  } else {
    if (stopTimer) { stopTimer(); stopTimer = null; }
    $("#clock-in").addEventListener("click", () => openClockSheet("in"));
  }
  const tip = $("#install-tip");
  if (tip) tip.querySelector(".close-button").addEventListener("click", () => { localStorage.setItem("install-tip-dismissed", "1"); tip.remove(); });

  hydratePhotos(app);
}

function sessionRow(s) {
  let hours, hint = "hrs";
  if (s.status === "approved") hours = fmtHours(s.approvedHours);
  else if (s.status === "pending") { hours = fmtHours(suggestHours(s)); hint = "hrs on the clock"; }
  else if (s.status === "open") { hours = fmtDuration(Date.now() - new Date(s.clockInAt).getTime()); hint = "so far"; }
  else hours = "0";
  const range = s.clockOutAt ? `${fmtTime(s.clockInAt)} – ${fmtTime(s.clockOutAt)}` : `from ${fmtTime(s.clockInAt)}`;
  return `
  <div class="Box-row session-row" data-id="${esc(s.id)}">
    <div class="main">
      <div class="d-flex flex-items-center flex-wrap" style="gap:4px 8px"><span class="text-semibold">${esc(s.event || "Outreach")}</span>${statusTag(s.status)}</div>
      <div class="f6 color-fg-muted mt-1">${esc(fmtDay(s.clockInAt))} · ${esc(range)}</div>
      <div class="photos">
        ${photoCell(s.clockInPhoto, "Clock in", s.clockInAt, s)}
        ${photoCell(s.clockOutPhoto, "Clock out", s.clockOutAt, s)}
      </div>
      ${s.adminNote ? `<div class="flash ${s.status === "rejected" ? "flash-error" : ""} f6 mt-2 py-2">${icon("info")} ${esc(s.adminNote)}</div>` : ""}
    </div>
    <div class="hours"><b>${esc(hours)}</b><small>${esc(hint)}</small></div>
  </div>`;
}

/* ---------------- clock in / out dialog ---------------- */
function openClockSheet(kind) {
  const st = state.settings, open = state.open, user = state.user;
  const events = [...new Set(state.sessions.map((s) => s.event).filter(Boolean))].slice(0, 8);
  let photo = null, tick;

  const el = sheet.open(`
    <div class="Overlay-header Overlay-header--divided">
      <div class="Overlay-headerContentWrap">
        <div class="Overlay-titleWrap">
          <h1 class="Overlay-title">${kind === "in" ? "Clock in" : "Clock out"}</h1>
          <p class="Overlay-description">Current time <b id="now-time">${esc(fmtTime(new Date()))}</b>.${kind === "out" ? ` Clocked in at ${esc(fmtTime(open.clockInAt))}.` : ""}</p>
        </div>
        <div class="Overlay-actionWrap"><button type="button" class="close-button Overlay-closeButton" aria-label="Close">${icon("x")}</button></div>
      </div>
    </div>
    <div class="Overlay-body">
      ${kind === "in" ? `
      <div class="form-group">
        <label for="event">Event</label>
        <input class="form-control width-full" id="event" type="text" list="event-list" placeholder="example: FTC Meet 9/20" autocomplete="off" maxlength="80">
        <datalist id="event-list">${events.map((e) => `<option value="${esc(e)}">`).join("")}</datalist>
      </div>` : ""}
      <div class="flash flash-warn f6 mb-3">${icon("alert")} Required in the photo: ${specificObject(st) ? `<b>${esc(specificObject(st))}</b> (specified by an admin for this event)` : "the object specified by an admin for this event"}.</div>
      <div id="capture-wrap">
        <label class="capture d-block" for="photo-input">${icon("device-camera", 24)}<div class="text-semibold">Take photo</div><input id="photo-input" type="file" accept="image/*" capture="environment"></label>
      </div>
      ${kind === "out" ? `<div class="form-group mt-3"><label for="note">Note for the admin <span class="text-normal color-fg-muted">(optional)</span></label><textarea class="form-control width-full" id="note" rows="2" maxlength="300"></textarea></div>` : ""}
      <div class="form-error mt-2" id="clock-error"></div>
    </div>
    <div class="Overlay-footer Overlay-footer--alignEnd">
      <button class="btn" id="cancel" type="button">Cancel</button>
      <button class="btn btn-primary" id="confirm" type="button" disabled>${kind === "in" ? "Clock in" : "Clock out"}</button>
    </div>
  `, { onClose: () => clearInterval(tick) });

  tick = setInterval(() => { const n = $("#now-time", el); if (n) n.textContent = fmtTime(new Date()); }, 1000);
  $("#cancel", el).addEventListener("click", () => sheet.close());

  const wrap = $("#capture-wrap", el), confirm = $("#confirm", el), err = $("#clock-error", el);
  const emptyCapture = `<label class="capture d-block" for="photo-input">${icon("device-camera", 24)}<div class="text-semibold">Take photo</div><input id="photo-input" type="file" accept="image/*" capture="environment"></label>`;
  const bindInput = () => {
    const input = $("#photo-input", wrap);
    if (!input) return;
    (async () => {
      const file = await pickPhoto(input);
      if (!file) { bindInput(); return; }
      err.textContent = "";
      try {
        photo = await preparePhoto(file, { name: user.name || user.email, kind });
        wrap.innerHTML = `<div class="capture has-photo"><img src="${photo.url}" alt="Your photo"><button type="button" class="btn btn-sm retake">${icon("sync")}Retake</button></div>`;
        confirm.disabled = false;
        $(".retake", wrap).addEventListener("click", () => { photo = null; confirm.disabled = true; wrap.innerHTML = emptyCapture; bindInput(); });
      } catch (ex) {
        err.textContent = ex.message;
        wrap.innerHTML = emptyCapture;
        bindInput();
      }
    })();
  };
  bindInput();

  confirm.addEventListener("click", async () => {
    if (!photo) { err.textContent = "A photo is required."; return; }
    setBusy(confirm, true, kind === "in" ? "Clocking in" : "Clocking out");
    try {
      if (kind === "in") await db.clockIn({ event: $("#event", el).value, photoBlob: photo.blob });
      else await db.clockOut({ sessionId: open.id, photoBlob: photo.blob, note: $("#note", el).value });
      sheet.close();
      toast(kind === "in" ? `Clocked in at ${fmtTime(new Date())}.` : `Clocked out at ${fmtTime(new Date())}. Waiting for review.`, "gold");
      await refresh();
    } catch (ex) {
      err.textContent = ex.message;
      setBusy(confirm, false);
    }
  });
}
