// Admin app: review queue with both photos, who is clocked in now, the roster, and settings.

import { db, ready, suggestHours } from "./db.js";
import { $, $$, esc, fmtDay, fmtDate, fmtTime, fmtHours, fmtDuration, hoursBetween, roundQuarter, progressBar, statusText, chip, segmented, toast, sheet, sheetHead, liveTimer, setBusy, csvDownload, initials, plural, SEARCH } from "./ui.js";
import { photoCell, hydratePhotos } from "./photos-ui.js";

const app = $("#app"), navRight = $("#nav-right");
const state = { admin: null, settings: null, sessions: [], members: [], tab: "review", filter: "pending", cat: "all", search: "", sort: "name", editing: new Set(), timers: [], loading: false };

(async function boot() {
  try { await ready; } catch (e) { app.innerHTML = `<div class="card"><p class="empty">Couldn't start: ${esc(e.message)}</p></div>`; return; }
  if (db.mode === "demo") $("#demo-banner").classList.remove("hidden");
  db.onAuthChange(() => refresh());
  await refresh();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();

function stopTimers() { state.timers.forEach((s) => s()); state.timers = []; }
async function refresh() {
  if (state.loading) return;
  state.loading = true;
  try {
    state.admin = await db.getAdmin();
    state.settings = await db.getSettings();
    if (state.admin) { await loadData(); renderDash(); } else renderSignIn();
  } catch (e) { toast(e.message); if (!state.admin) renderSignIn(); }
  finally { state.loading = false; }
}
async function loadData() { [state.sessions, state.members] = await Promise.all([db.listSessions(), db.listMembers()]); }
const req = () => Number(state.settings?.requiredHours) || 10;

/* ---------------- sign in ---------------- */
function renderSignIn() {
  stopTimers();
  navRight.innerHTML = `<a class="nav__link" href="./">Member app</a>`;
  const demo = db.mode === "demo";
  app.innerHTML = `
  <div class="auth view">
    <img class="auth__logo" src="icons/logo.svg" alt="">
    <h1 class="large-title">Admin</h1>
    <p class="lead subhead">Team 7419</p>
    <form id="admin-form" novalidate>
      <div class="fieldset">
        ${demo ? `<input class="input" id="passcode" name="passcode" type="password" placeholder="Admin passcode" aria-label="Admin passcode" inputmode="numeric" autocomplete="off" required>`
               : `<input class="input" id="email" name="email" type="email" placeholder="Email" aria-label="Email" autocomplete="email" required><input class="input" id="password" name="password" type="password" placeholder="Password" aria-label="Password" autocomplete="current-password" required>`}
      </div>
      <p class="form-error" id="admin-error"></p>
      <button class="btn btn--primary btn--full" type="submit">Sign in</button>
    </form>
    <p class="req footnote">Member accounts can't sign in here.${demo ? " The demo passcode is in config.js." : ""}</p>
    <p class="footer-links"><a href="./">Member app</a></p>
  </div>`;
  $("#admin-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.currentTarget.querySelector("button"), err = $("#admin-error");
    const f = Object.fromEntries(new FormData(e.currentTarget).entries());
    err.textContent = "";
    setBusy(btn, true, "Signing in");
    try { await db.adminSignIn(f); await refresh(); }
    catch (ex) { err.textContent = ex.message; setBusy(btn, false); }
  });
}

/* ---------------- dashboard ---------------- */
function renderDash() {
  stopTimers();
  const { settings: st, sessions, members } = state;
  const pending = sessions.filter((s) => s.status === "pending"), open = sessions.filter((s) => s.status === "open");
  const active = members.filter((m) => !m.excused), done = active.filter((m) => m.approvedHours >= req()).length;
  const totalApproved = members.reduce((a, m) => a + m.approvedHours, 0), totalShop = members.reduce((a, m) => a + (m.shopHours || 0), 0);

  navRight.innerHTML = `<button type="button" class="nav__link" id="signout">Sign out</button>`;
  $("#signout").addEventListener("click", async () => { await db.adminSignOut(); await refresh(); });

  app.innerHTML = `
  <div class="view">
    <header class="page-head">
      <h1 class="large-title">Admin</h1>
      <p class="subtitle">${esc(st.semesterName)}, ${esc(fmtHours(req()))} hours required</p>
    </header>
    ${!db.shopReady ? `<div class="notice mb-3"><span><b>Shop hours need a database update.</b> In Supabase: SQL editor → paste <code>supabase/schema.sql</code> → Run. Shop options stay hidden until then.</span></div>` : ""}
    <section class="card">
      <p class="title2">${pending.length ? `${plural(pending.length, "session")} waiting for review` : "Nothing waiting for review"}</p>
      <div class="stats">
        <div><b>${open.length}</b><span>clocked in now</span></div>
        <div><b>${done}<span class="text-3"> / ${active.length}</span></b><span>members done</span></div>
        <div><b>${esc(fmtHours(totalApproved))}</b><span>outreach hours</span></div>
        ${db.shopReady ? `<div><b>${esc(fmtHours(totalShop))}</b><span>shop hours</span></div>` : ""}
      </div>
    </section>
    <div class="mt-3" id="tabs"></div>
    <div class="mt-3" id="panel"></div>
    <p class="footer-links"><a href="./">Member app</a></p>
  </div>`;
  segmented($("#tabs"), {
    items: [{ value: "review", label: pending.length ? `Review ${pending.length}` : "Review" }, { value: "live", label: open.length ? `Live ${open.length}` : "Live" }, { value: "members", label: "Members" }, { value: "settings", label: "Settings" }],
    value: state.tab, onChange: (v) => { state.tab = v; renderPanel(); },
  });
  renderPanel();
}
function renderPanel() {
  stopTimers();
  ({ review: renderReview, live: renderLive, members: renderMembers, settings: renderSettings })[state.tab]($("#panel"));
}

/* ---------------- review ---------------- */
function renderReview(panel) {
  const list = state.sessions.filter((s) => s.status !== "open" && (state.filter === "all" || s.status === state.filter) && (state.cat === "all" || (s.category || "outreach") === state.cat));
  panel.innerHTML = `
    <div class="toolbar"><div id="f-status"></div>${db.shopReady ? `<div id="f-cat"></div>` : ""}</div>
    <div id="review-list">${list.length ? list.map(reviewCard).join("") : `<div class="card"><p class="empty">${state.filter === "pending" ? "Nothing waiting for review" : "No sessions"}</p></div>`}</div>`;
  segmented($("#f-status", panel), { small: true, value: state.filter, onChange: (v) => { state.filter = v; renderPanel(); }, items: [{ value: "pending", label: "Waiting" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Sent back" }, { value: "all", label: "All" }] });
  if (db.shopReady) segmented($("#f-cat", panel), { small: true, value: state.cat, onChange: (v) => { state.cat = v; renderPanel(); }, items: [{ value: "all", label: "All" }, { value: "outreach", label: "Outreach" }, { value: "shop", label: "Shop" }] });
  bindReviewCards(panel);
  hydratePhotos(panel);
}

function reviewCard(s) {
  const editing = state.editing.has(s.id), deciding = s.status === "pending" || editing;
  const dur = hoursBetween(s.clockInAt, s.clockOutAt), first = (s.userName || "member").split(" ")[0];
  return `
  <article class="card review mb-3" data-id="${esc(s.id)}">
    <div class="review__who">
      <span class="avatar">${esc(initials(s.userName || s.userEmail))}</span>
      <div class="row__main"><div class="row__title">${esc(s.userName || s.userEmail)}</div><div class="row__sub">${s.userGrade ? `Grade ${esc(s.userGrade)}, ` : ""}${esc(s.userEmail)}</div></div>
      <div>${statusText(s.status)}</div>
    </div>
    <p class="mt-3"><b>${esc(s.event || (s.manual ? "Hours added by an admin" : s.category === "shop" ? "Shop" : "Outreach"))}</b> <span class="text-2">${esc(fmtDate(s.clockInAt))}</span> ${chip(s.category)}</p>
    ${s.manual ? `<p class="footnote text-2 mt-1">Added by an admin, no photos</p>` : `<div class="photos">${photoCell(s.clockInPhoto, "Clock in", s.clockInAt, s)}${photoCell(s.clockOutPhoto, "Clock out", s.clockOutAt, s)}</div>`}
    <div class="review__decision">
      ${s.manual ? `<div class="kv"><span class="caption">Added manually</span><b>${esc(fmtHours(s.approvedHours || 0))} h</b></div>`
                 : `<div class="kv"><span class="caption">Time on the clock</span><b>${esc(fmtDuration(dur * 36e5))} <span class="text-2" style="font-weight:500">${esc(fmtHours(dur))} h</span></b></div>`}
      ${deciding ? `
        <label class="field"><span class="field__label">Hours to approve</span><input class="input hours" type="number" inputmode="decimal" step="0.25" min="0" max="24" value="${esc(s.approvedHours ?? suggestHours(s))}"></label>
        <label class="field"><span class="field__label">Note to ${esc(first)} <span class="opt">(optional, required to send back)</span></span><input class="input note" type="text" maxlength="300" value="${esc(s.adminNote)}"></label>
        ${s.note ? `<p class="footnote text-2">Note from ${esc(first)}: “${esc(s.note)}”</p>` : ""}
        <div class="actions">
          <button type="button" class="btn btn--primary approve">Approve ${esc(fmtHours(s.approvedHours ?? suggestHours(s)))} hours</button>
          <button type="button" class="btn btn--destructive reject">Send back</button>
          ${editing ? `<button type="button" class="btn btn--plain cancel">Cancel</button>` : ""}
        </div>` : `
        <div class="kv"><span class="caption">Decision</span><b>${s.status === "approved" ? `${esc(fmtHours(s.approvedHours))} hours approved` : `<span style="color:var(--red)">Sent back</span>`}</b>${s.adminNote ? `<span class="footnote text-2">${esc(s.adminNote)}</span>` : ""}${s.reviewedAt ? `<span class="caption text-3">${esc(fmtDate(s.reviewedAt))}</span>` : ""}</div>
        <div class="actions"><button type="button" class="btn btn--small btn--tinted change">Edit</button></div>`}
    </div>
  </article>`;
}
function bindReviewCards(root) {
  $$(".review[data-id]", root).forEach((card) => {
    const id = card.dataset.id, hours = $(".hours", card), approve = $(".approve", card), reject = $(".reject", card);
    if (hours && approve) hours.addEventListener("input", () => { approve.textContent = `Approve ${fmtHours(Number(hours.value) || 0)} hours`; });
    approve?.addEventListener("click", () => decide(card, id, "approved", approve));
    reject?.addEventListener("click", () => decide(card, id, "rejected", reject));
    $(".cancel", card)?.addEventListener("click", () => { state.editing.delete(id); renderPanel(); });
    $(".change", card)?.addEventListener("click", () => { state.editing.add(id); renderPanel(); });
  });
}
async function decide(card, id, status, btn) {
  const hours = Number($(".hours", card).value), note = $(".note", card).value.trim();
  if (status === "approved" && !(hours >= 0)) { toast("Enter the hours to approve"); return; }
  if (status === "rejected" && !note) { toast("A note is required to send a session back"); $(".note", card).focus(); return; }
  setBusy(btn, true, status === "approved" ? "Approving" : "Sending back");
  try {
    await db.reviewSession(id, { status, approvedHours: hours, adminNote: note });
    state.editing.delete(id);
    toast(status === "approved" ? `Approved ${fmtHours(hours)} hours` : "Sent back");
    await loadData(); renderDash();
  } catch (e) { toast(e.message); setBusy(btn, false); }
}

/* ---------------- live ---------------- */
function renderLive(panel) {
  const open = state.sessions.filter((s) => s.status === "open");
  panel.innerHTML = open.length ? open.map((s) => `
    <article class="card mb-3" data-id="${esc(s.id)}">
      <div class="review__who">
        <span class="avatar">${esc(initials(s.userName || s.userEmail))}</span>
        <div class="row__main"><div class="row__title">${esc(s.userName || s.userEmail)}</div><div class="row__sub">${esc(s.event || "Outreach")}, since ${esc(fmtTime(s.clockInAt))} ${esc(fmtDay(s.clockInAt))}</div></div>
        <div>${statusText("open")}</div>
      </div>
      <div class="photos" style="align-items:flex-start">
        ${photoCell(s.clockInPhoto, "Clock in", s.clockInAt, s)}
        <div class="kv" style="justify-content:center;padding-left:.5rem"><span class="caption">On the clock</span><b class="number" style="font-size:1.75rem" data-since="${esc(s.clockInAt)}"></b>${chip(s.category)}</div>
      </div>
      <div class="actions mt-3" style="align-items:center">
        <button type="button" class="btn btn--small btn--destructive close">Close session</button>
        <span class="footnote text-2">For members who forgot to clock out. Ends the session now and sends it to review.</span>
      </div>
    </article>`).join("") : `<div class="card"><p class="empty">No one is clocked in</p></div>`;
  $$("[data-since]", panel).forEach((el) => state.timers.push(liveTimer(el, el.dataset.since, 5000)));
  $$(".close", panel).forEach((b) => b.addEventListener("click", async () => {
    const id = b.closest("[data-id]").dataset.id;
    if (!confirm("Close this session? The clock-out time will be now, and it will go to review.")) return;
    setBusy(b, true, "Closing");
    try { await db.closeSession(id); toast("Session closed, sent to review"); await loadData(); renderDash(); }
    catch (e) { toast(e.message); setBusy(b, false); }
  }));
  hydratePhotos(panel);
}

/* ---------------- members ---------------- */
function renderMembers(panel) {
  const r = req(), q = state.search.trim().toLowerCase();
  let list = state.members.filter((m) => !q || `${m.name} ${m.email} ${m.grade}`.toLowerCase().includes(q));
  if (state.sort === "progress") list = [...list].sort((a, b) => b.approvedHours - a.approvedHours || a.name.localeCompare(b.name));
  else if (state.sort === "left") list = [...list].sort((a, b) => a.approvedHours - b.approvedHours || a.name.localeCompare(b.name));
  const reqShop = Number(state.settings.requiredShopHours) || 0;
  panel.innerHTML = `
    <div class="toolbar">
      <div id="sort"></div>
      <label class="search">${SEARCH}<input class="input" type="search" id="member-search" placeholder="Search" aria-label="Search members" value="${esc(state.search)}"></label>
    </div>
    <div class="group">
      ${list.length ? list.map((m) => `
      <button type="button" class="row row--tappable" data-id="${esc(m.id)}">
        <span class="avatar">${esc(initials(m.name || m.email))}</span>
        <div class="row__main">
          <div class="row__title">${esc(m.name || m.email)}${m.role === "admin" ? ` <span class="chip chip--admin">Admin</span>` : ""}${m.excused ? ` <span class="chip">Excused</span>` : ""}</div>
          <div class="row__sub">${m.excused ? "Excused" : m.approvedHours >= r ? "Requirement met" : `${esc(fmtHours(r - m.approvedHours))} h to go`}${roundQuarter(m.pendingHours) ? `, ${esc(fmtHours(roundQuarter(m.pendingHours)))} h waiting` : ""}${m.openSessions ? ", clocked in" : ""}</div>
          <div class="member-progress">${progressBar({ approved: m.approvedHours, pending: m.pendingHours, required: r, legend: false })}</div>
        </div>
        <div class="row__trail"><b>${esc(fmtHours(m.approvedHours))}<span class="text-2" style="font-weight:500"> / ${esc(fmtHours(r))} h</span></b>${db.shopReady ? `shop ${esc(fmtHours(m.shopHours || 0))}${reqShop ? ` / ${esc(fmtHours(reqShop))}` : ""} h` : ""}</div>
        <span class="chevron" aria-hidden="true"></span>
      </button>`).join("") : `<p class="empty">No matching members</p>`}
    </div>
    <div class="actions mt-3">
      <button type="button" class="btn btn--small btn--tinted" id="export-members">Download roster (CSV)</button>
      <button type="button" class="btn btn--small btn--tinted" id="export-sessions">Download sessions (CSV)</button>
    </div>`;
  segmented($("#sort", panel), { small: true, value: state.sort, onChange: (v) => { state.sort = v; renderPanel(); }, items: [{ value: "name", label: "A–Z" }, { value: "progress", label: "Most hours" }, { value: "left", label: "Fewest hours" }] });
  const search = $("#member-search", panel);
  search.addEventListener("input", () => { state.search = search.value; const pos = search.selectionStart; renderPanel(); const s2 = $("#member-search"); s2.focus(); s2.setSelectionRange(pos, pos); });
  $$(".row[data-id]", panel).forEach((row) => row.addEventListener("click", () => openMemberSheet(state.members.find((m) => m.id === row.dataset.id))));
  $("#export-members", panel).addEventListener("click", () => {
    const rows = [["Name", "Email", "Grade", "Outreach hours approved", "Outreach waiting for review (hours)", "Required outreach hours", "Shop hours", "Status", "Excused note"]];
    state.members.forEach((m) => rows.push([m.name, m.email, m.grade, fmtHours(m.approvedHours), fmtHours(m.pendingHours), r, fmtHours(m.shopHours || 0), m.excused ? "Excused" : m.approvedHours >= r ? "Requirement met" : "In progress", m.excusedNote || ""]));
    csvDownload(`outreach-roster-${state.settings.semesterName.replace(/\s+/g, "-").toLowerCase()}.csv`, rows);
  });
  $("#export-sessions", panel).addEventListener("click", () => {
    const iso = (v) => { if (!v) return ""; const d = new Date(v), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
    const rows = [["Date", "Member email", "Category", "Event", "Clock in", "Clock out", "Hours on clock", "Status", "Approved hours", "Admin note", "Member name", "Type"]];
    state.sessions.forEach((s) => rows.push([iso(s.clockInAt).slice(0, 10), s.userEmail, s.category === "shop" ? "Shop" : "Outreach", s.event, s.manual ? "" : iso(s.clockInAt).slice(11), s.manual ? "" : iso(s.clockOutAt).slice(11), s.manual ? "" : s.clockOutAt ? fmtHours(hoursBetween(s.clockInAt, s.clockOutAt)) : "", ({ pending: "Waiting", approved: "Approved", rejected: "Sent back", open: "Open" })[s.status], s.approvedHours ?? "", s.adminNote, s.userName, s.manual ? "Added by admin" : "Clock in/out"]));
    csvDownload(`outreach-sessions-${state.settings.semesterName.replace(/\s+/g, "-").toLowerCase()}.csv`, rows);
  });
}

/* a member's details and actions, from the roster */
function openMemberSheet(m) {
  if (!m) return;
  const r = req(), self = m.id === state.admin.id, reqShop = Number(state.settings.requiredShopHours) || 0;
  const el = sheet.open(`
    ${sheetHead(esc(m.name || m.email), `${esc(m.email)}${m.grade ? `, Grade ${esc(m.grade)}` : ""}${m.role === "admin" ? ", admin" : ""}`)}
    <div class="sheet__body">
      <div class="kv"><span class="caption">Outreach</span><b>${esc(fmtHours(m.approvedHours))} / ${esc(fmtHours(r))} h</b></div>
      <div class="mt-1">${progressBar({ approved: m.approvedHours, pending: m.pendingHours, required: r, excused: m.excused })}</div>
      ${db.shopReady ? `<div class="kv mt-3"><span class="caption">Shop</span><b>${esc(fmtHours(m.shopHours || 0))}${reqShop ? ` / ${esc(fmtHours(reqShop))}` : ""} h</b></div>` : ""}
      ${m.excused ? `<div class="notice notice--muted mt-3 footnote">Excused from the requirement${m.excusedNote ? `: ${esc(m.excusedNote)}` : ""}.</div>` : ""}
    </div>
    <div class="sheet__actions">
      <button type="button" class="btn btn--tinted btn--full" data-act="hours">Add hours</button>
      <button type="button" class="btn btn--tinted btn--full" data-act="account">Account</button>
      ${self ? "" : `<button type="button" class="btn btn--tinted btn--full" data-act="excuse">${m.excused ? "Remove excuse" : "Excuse from hours"}</button>
      <button type="button" class="btn btn--destructive btn--full" data-act="remove">Remove from roster</button>`}
    </div>`);
  $$("[data-act]", el).forEach((b) => b.addEventListener("click", async () => {
    const act = b.dataset.act;
    if (act === "hours") { await sheet.close(); openAddHours(m); return; }
    if (act === "account") { await sheet.close(); openAccount(m); return; }
    if (act === "excuse") {
      const excusing = !m.excused; let note = "";
      if (excusing) { note = prompt("Reason (optional). The member sees this on their page."); if (note === null) return; }
      setBusy(b, true, "Saving");
      try { await db.setExcused(m.id, excusing, note.trim()); await sheet.close(); toast(excusing ? "Excused from the requirement" : "Excuse removed"); await loadData(); renderDash(); }
      catch (e) { toast(e.message); setBusy(b, false); }
    }
    if (act === "remove") {
      if (!confirm(`Remove ${m.name || m.email} from the roster? Their account, sessions and photos are deleted. This can't be undone.`)) return;
      setBusy(b, true, "Removing");
      try { await db.removeMember(m.id); await sheet.close(); toast("Removed from the roster"); await loadData(); renderDash(); }
      catch (e) { toast(e.message); setBusy(b, false); }
    }
  }));
}

/* ---------------- add hours by hand ---------------- */
function openAddHours(m) {
  if (!m) return;
  const first = (m.name || "them").split(" ")[0], d = new Date(), p = (n) => String(n).padStart(2, "0");
  const today = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const el = sheet.open(`
    ${sheetHead("Add hours", esc(m.name || m.email))}
    <div class="sheet__body">
      <div class="field-row">
        <label class="field"><span class="field__label">Hours</span><input class="input" id="ah-hours" type="number" inputmode="decimal" step="0.25" min="0.25" max="24" value="1"></label>
        <label class="field"><span class="field__label">Date</span><input class="input" id="ah-date" type="date" value="${today}"></label>
      </div>
      ${db.shopReady ? `<label class="field"><span class="field__label">Type</span><select class="input" id="ah-cat"><option value="outreach">Outreach</option><option value="shop">Shop</option></select></label>` : ""}
      <label class="field"><span class="field__label">Event</span><input class="input" id="ah-event" type="text" maxlength="80" placeholder="example: FTC Meet 9/20"></label>
      <label class="field"><span class="field__label">Note to ${esc(first)} <span class="opt">(optional)</span></span><input class="input" id="ah-note" type="text" maxlength="300"></label>
      <p class="form-error" id="ah-error"></p>
    </div>
    <div class="sheet__actions"><button class="btn btn--primary btn--full" id="ah-save" type="button">Add 1 hour</button></div>`);
  const hours = $("#ah-hours", el), save = $("#ah-save", el), err = $("#ah-error", el);
  hours.addEventListener("input", () => { const h = Number(hours.value) || 0; save.textContent = `Add ${fmtHours(h)} hour${h === 1 ? "" : "s"}`; });
  save.addEventListener("click", async () => {
    const h = Number(hours.value);
    if (!(h > 0) || h > 24) { err.textContent = "Hours must be between 0.25 and 24."; return; }
    setBusy(save, true, "Adding");
    try {
      await db.addHours({ userId: m.id, hours: h, event: $("#ah-event", el).value, note: $("#ah-note", el).value, date: $("#ah-date", el).value, category: $("#ah-cat", el)?.value || "outreach" });
      await sheet.close(); toast(`Added ${fmtHours(h)} hours for ${m.name || m.email}`); await loadData(); renderDash();
    } catch (e) { err.textContent = e.message; setBusy(save, false); }
  });
}

/* ---------------- account (name, grade, password) ---------------- */
function openAccount(m) {
  if (!m) return;
  const grades = ["", "9", "10", "11", "12"];
  const el = sheet.open(`
    ${sheetHead("Account", esc(m.email))}
    <div class="sheet__body">
      <form id="acct-form" novalidate>
        <div class="field-row">
          <label class="field"><span class="field__label">Name</span><input class="input" id="acct-name" type="text" value="${esc(m.name)}" maxlength="80" required></label>
          <label class="field"><span class="field__label">Grade</span><select class="input" id="acct-grade">${grades.map((g) => `<option value="${g}" ${String(m.grade || "") === g ? "selected" : ""}>${g || "Not set"}</option>`).join("")}</select></label>
        </div>
        <p class="form-error" id="acct-error"></p>
        <button class="btn btn--tinted" type="submit" id="acct-save">Save</button>
      </form>
      <div class="hr"></div>
      <label class="field"><span class="field__label">New password</span>
        <div style="display:flex;gap:.5rem"><input class="input" id="acct-pw" type="text" minlength="6" maxlength="72" autocomplete="off" placeholder="6 or more characters"><button type="button" class="btn btn--tinted" id="acct-setpw" style="flex:none">Set</button></div>
      </label>
      <p class="form-error" id="acct-pw-error"></p>
      ${db.mode === "supabase" ? `<button type="button" class="btn btn--plain" id="acct-reset">Send password reset email</button>` : ""}
    </div>`);
  $("#acct-form", el).addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#acct-save", el), err = $("#acct-error", el);
    err.textContent = ""; setBusy(btn, true, "Saving");
    try { await db.adminUpdateProfile(m.id, { name: $("#acct-name", el).value, grade: $("#acct-grade", el).value }); toast("Saved"); await loadData(); setBusy(btn, false); renderPanel(); }
    catch (ex) { err.textContent = ex.message; setBusy(btn, false); }
  });
  $("#acct-setpw", el).addEventListener("click", async () => {
    const btn = $("#acct-setpw", el), err = $("#acct-pw-error", el), pw = $("#acct-pw", el).value;
    err.textContent = "";
    if (pw.length < 6) { err.textContent = "Password must be at least 6 characters."; return; }
    setBusy(btn, true, "Saving");
    try { await db.adminSetPassword(m.id, pw); toast(`Password set for ${m.name || m.email}`); $("#acct-pw", el).value = ""; }
    catch (ex) { err.textContent = ex.message; }
    setBusy(btn, false);
  });
  $("#acct-reset", el)?.addEventListener("click", async () => {
    const btn = $("#acct-reset", el), err = $("#acct-pw-error", el);
    err.textContent = ""; setBusy(btn, true, "Sending");
    try { await db.sendPasswordReset(m.email); toast(`Reset email sent to ${m.email}`); } catch (ex) { err.textContent = ex.message; }
    setBusy(btn, false);
  });
}

/* ---------------- settings ---------------- */
function renderSettings(panel) {
  const st = state.settings;
  panel.innerHTML = `
    <section class="card">
      <h2 class="card__title mb-3">Semester</h2>
      <form id="settings-form">
        <label class="field"><span class="field__label">Name</span><input class="input" id="semesterName" name="semesterName" type="text" value="${esc(st.semesterName)}" required></label>
        <div class="field-row">
          <label class="field"><span class="field__label">Start</span><input class="input" id="semesterStart" name="semesterStart" type="date" value="${esc(st.semesterStart)}" required></label>
          <label class="field"><span class="field__label">End</span><input class="input" id="semesterEnd" name="semesterEnd" type="date" value="${esc(st.semesterEnd)}" required></label>
        </div>
        <div class="field-row">
          <label class="field"><span class="field__label">Required outreach hours</span><input class="input" id="requiredHours" name="requiredHours" type="number" step="0.5" min="0" value="${esc(st.requiredHours)}" required></label>
          ${db.shopReady ? `<label class="field"><span class="field__label">Required shop hours <span class="opt">(0 = tracked only)</span></span><input class="input" id="requiredShopHours" name="requiredShopHours" type="number" step="0.5" min="0" value="${esc(st.requiredShopHours ?? 0)}" required></label>` : ""}
        </div>
        ${db.shopReady ? `<label class="check"><input type="checkbox" id="shopRequiresReview" name="shopRequiresReview" ${st.shopRequiresReview ? "checked" : ""}><span>Shop sessions need admin review<span class="footnote">Off: shop hours count as soon as the member clocks out.</span></span></label>` : ""}
        <label class="field"><span class="field__label">Required object in every photo</span><input class="input" id="verificationObject" name="verificationObject" type="text" value="${esc(st.verificationObject)}" maxlength="80" required></label>
        <p class="form-error" id="settings-error"></p>
        <button class="btn btn--primary" type="submit">Save</button>
      </form>
    </section>
    <h2 class="section-title">Admins</h2>
    <div class="group">
      ${db.mode === "supabase" ? state.members.map((m) => `
        <div class="row">
          <span class="avatar">${esc(initials(m.name || m.email))}</span>
          <div class="row__main"><div class="row__title">${esc(m.name || m.email)}</div><div class="row__sub">${esc(m.email)}</div></div>
          ${m.id === state.admin.id ? `<span class="chip chip--admin">You</span>` : m.role === "admin" ? `<button type="button" class="btn btn--small btn--tinted role" data-id="${esc(m.id)}" data-role="member">Remove admin</button>` : `<button type="button" class="btn btn--small btn--tinted role" data-id="${esc(m.id)}" data-role="admin">Make admin</button>`}
        </div>`).join("") : `
        <div class="row"><div class="row__main"><div class="row__sub">Demo mode uses one shared passcode from config.js. With Supabase connected, admins are accounts managed here.</div></div></div>
        <div class="row"><button type="button" class="btn btn--small btn--destructive" id="reset-demo">Reset demo data</button></div>`}
    </div>`;
  $("#settings-form", panel).addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.currentTarget.querySelector("button[type=submit]"), err = $("#settings-error");
    const f = Object.fromEntries(new FormData(e.currentTarget).entries());
    if (f.semesterEnd < f.semesterStart) { err.textContent = "End date is before start date."; return; }
    setBusy(btn, true, "Saving");
    try {
      state.settings = await db.updateSettings({ ...f, requiredHours: Number(f.requiredHours), ...(db.shopReady ? { requiredShopHours: Number(f.requiredShopHours) || 0, shopRequiresReview: !!f.shopRequiresReview } : {}) });
      toast("Saved"); await loadData(); renderDash();
    } catch (ex) { err.textContent = ex.message; setBusy(btn, false); }
  });
  $$(".role", panel).forEach((b) => b.addEventListener("click", async () => {
    setBusy(b, true, "Saving");
    try { await db.setRole(b.dataset.id, b.dataset.role); toast(b.dataset.role === "admin" ? "Admin access added" : "Admin access removed"); await loadData(); renderPanel(); }
    catch (e) { toast(e.message); setBusy(b, false); }
  }));
  $("#reset-demo", panel)?.addEventListener("click", async () => {
    if (!confirm("Reset demo data? This removes anything you added.")) return;
    await db.resetDemo(); toast("Demo data reset"); await refresh();
  });
}
