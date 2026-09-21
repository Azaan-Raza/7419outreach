// Lead (admin) app: separate sign-in, review queue with both photos, live clock-ins, roster with progress, settings.

import { db, ready, suggestHours } from "./db.js";
import { $, $$, esc, fmtDay, fmtDate, fmtTime, fmtHours, fmtDuration, hoursBetween, roundQuarter, progressBar, statusTag, toast, liveTimer, setBusy, csvDownload, initials } from "./ui.js";
import { photoCell, hydratePhotos } from "./photos-ui.js";
import { icon } from "./icons.js";

const app = $("#app"), top = $("#topbar-right");
const state = { admin: null, settings: null, sessions: [], members: [], tab: "review", filter: "pending", search: "", sort: "name", editing: new Set(), timers: [], loading: false };

(async function boot() {
  try { await ready; } catch (e) { app.innerHTML = `<div class="blankslate">${icon("alert", 24)}<h3 class="blankslate-heading">Couldn't start</h3><p>${esc(e.message)}</p></div>`; return; }
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
  } catch (e) { toast(e.message, "error"); if (!state.admin) renderSignIn(); }
  finally { state.loading = false; }
}
async function loadData() {
  [state.sessions, state.members] = await Promise.all([db.listSessions(), db.listMembers()]);
}

/* ---------------- sign in ---------------- */
function renderSignIn() {
  stopTimers();
  top.innerHTML = `<a class="btn btn-sm btn-header" href="./">Member app</a>`;
  const demo = db.mode === "demo";
  app.innerHTML = `
  <div class="auth-page">
    <div class="text-center"><img src="icons/logo.svg" width="48" height="48" alt="" style="border-radius:50%"></div>
    <h1>Admin sign-in</h1>
    <p class="text-center color-fg-muted f5 mb-3">Approve hours, see who is clocked in, and manage the roster.</p>
    <div class="auth-form">
      <form id="admin-form" novalidate>
        ${demo ? `
        <div class="form-group"><label for="passcode">Admin passcode</label><input class="form-control" id="passcode" name="passcode" type="password" inputmode="numeric" autocomplete="off" required></div>
        ` : `
        <div class="form-group"><label for="email">Email</label><input class="form-control" id="email" name="email" type="email" autocomplete="email" required></div>
        <div class="form-group"><label for="password">Password</label><input class="form-control" id="password" name="password" type="password" autocomplete="current-password" required></div>
        `}
        <div class="form-error" id="admin-error"></div>
        <button class="btn btn-primary btn-block" type="submit">Sign in</button>
      </form>
    </div>
    <div class="callout">Member accounts can't sign in here. ${demo ? "The demo passcode is in config.js." : "Need admin access? Ask a current admin."}<br><a href="./">Go to the member app.</a></div>
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
  const { settings: st, sessions, members, admin } = state;
  const req = Number(st.requiredHours) || 9;
  const pending = sessions.filter((s) => s.status === "pending");
  const open = sessions.filter((s) => s.status === "open");
  const active = members.filter((m) => !m.excused);
  const done = active.filter((m) => m.approvedHours >= req).length;
  const totalApproved = members.reduce((a, m) => a + m.approvedHours, 0);

  top.innerHTML = `<span class="f6 hide-sm-inline mr-3" style="color:var(--header-fgColor-default)">${esc(admin.name || admin.email)}</span><button class="btn btn-sm btn-header" id="signout">${icon("sign-out")}Sign out</button>`;
  $("#signout").addEventListener("click", async () => { await db.adminSignOut(); await refresh(); });

  const tabs = [["review", "Review", "checklist", pending.length], ["live", "Live", "pulse", open.length], ["members", "Members", "people", 0], ["settings", "Settings", "gear", 0]];
  app.innerHTML = `
  <div class="mb-3">
    <h1 class="f3 text-semibold lh-condensed mb-0">${pending.length ? `${pending.length} session${pending.length === 1 ? "" : "s"} waiting for review` : "No sessions waiting for review"}</h1>
    <div class="page-sub">${esc(st.semesterName)}, ${esc(fmtHours(req))} hours required</div>
  </div>
  <div class="stats mb-3">
    <div class="Box p-3 stat"><div class="l">Waiting for review</div><div class="n">${pending.length}</div></div>
    <div class="Box p-3 stat"><div class="l">Clocked in now</div><div class="n">${open.length}</div></div>
    <div class="Box p-3 stat"><div class="l">Members done</div><div class="n">${done}<span class="color-fg-muted f4"> / ${active.length}</span></div></div>
    <div class="Box p-3 stat"><div class="l">Hours approved</div><div class="n">${esc(fmtHours(totalApproved))}</div></div>
  </div>
  <nav class="UnderlineNav mb-3" aria-label="Sections">
    <div class="UnderlineNav-body" role="tablist">
      ${tabs.map(([k, l, ic, n]) => `<button type="button" class="UnderlineNav-item" role="tab" aria-selected="${state.tab === k}" data-tab="${k}"><span class="UnderlineNav-octicon">${icon(ic)}</span> ${l}${n ? `<span class="Counter">${n}</span>` : ""}</button>`).join("")}
    </div>
  </nav>
  <div id="panel"></div>`;
  $$(".UnderlineNav-item").forEach((b) => b.addEventListener("click", () => { state.tab = b.dataset.tab; renderDash(); }));
  renderPanel();
}

function renderPanel() {
  stopTimers();
  const panel = $("#panel");
  ({ review: renderReview, live: renderLive, members: renderMembers, settings: renderSettings })[state.tab](panel);
}

/* ---------------- review ---------------- */
function renderReview(panel) {
  const filters = [["pending", "Waiting"], ["approved", "Approved"], ["rejected", "Sent back"], ["all", "All"]];
  const list = state.sessions.filter((s) => s.status !== "open" && (state.filter === "all" || s.status === state.filter));
  panel.innerHTML = `
    <div class="toolbar mb-3">
      <div class="BtnGroup">${filters.map(([k, l]) => `<button type="button" class="btn btn-sm BtnGroup-item ${state.filter === k ? "selected" : ""}" aria-pressed="${state.filter === k}" data-f="${k}">${l}</button>`).join("")}</div>
      <span class="f6 color-fg-muted">${list.length} session${list.length === 1 ? "" : "s"}</span>
    </div>
    <div id="review-list">
      ${list.length ? list.map((s) => reviewCard(s)).join("") : `<div class="Box"><div class="blankslate">${icon("checklist", 24)}<h3 class="blankslate-heading">${state.filter === "pending" ? "No sessions waiting for review" : "No sessions"}</h3></div></div>`}
    </div>`;
  $$(".BtnGroup-item", panel).forEach((b) => b.addEventListener("click", () => { state.filter = b.dataset.f; renderPanel(); }));
  bindReviewCards(panel);
  hydratePhotos(panel);
}

function reviewCard(s) {
  const editing = state.editing.has(s.id);
  const dur = hoursBetween(s.clockInAt, s.clockOutAt);
  const deciding = s.status === "pending" || editing;
  const first = (s.userName || "member").split(" ")[0];
  return `
  <div class="Box review mb-3" data-id="${esc(s.id)}">
    <div class="Box-header d-flex">
      <span class="initials">${esc(initials(s.userName || s.userEmail))}</span>
      <div class="flex-auto"><div class="text-semibold">${esc(s.userName || s.userEmail)}</div><div class="f6 color-fg-muted">${s.userGrade ? `Grade ${esc(s.userGrade)} · ` : ""}${esc(s.userEmail)}</div></div>
      ${statusTag(s.status)}
    </div>
    <div class="Box-body">
      <div><b>${esc(s.event || "Outreach")}</b> <span class="color-fg-muted">· ${esc(fmtDate(s.clockInAt))}</span></div>
      <div class="photos">
        ${photoCell(s.clockInPhoto, "Clock in", s.clockInAt, s)}
        ${photoCell(s.clockOutPhoto, "Clock out", s.clockOutAt, s)}
      </div>
    </div>
    <div class="Box-row decision color-bg-subtle">
      <div><div class="f6 color-fg-muted">Time on the clock</div><div class="text-semibold f4">${esc(fmtDuration(dur * 36e5))} <span class="color-fg-muted f6 text-normal">${esc(fmtHours(dur))} h</span></div></div>
      ${deciding ? `
        <div class="form-group"><label>Hours to approve</label><input class="form-control width-full hours" type="number" inputmode="decimal" step="0.25" min="0" max="24" value="${esc(s.approvedHours ?? suggestHours(s))}"></div>
        <div class="form-group span"><label>Note to ${esc(first)} <span class="text-normal color-fg-muted">(optional; required to send back)</span></label><input class="form-control width-full note" type="text" maxlength="300" value="${esc(s.adminNote)}"></div>
        ${s.note ? `<div class="span f6 color-fg-muted">Note from ${esc(first)}: “${esc(s.note)}”</div>` : ""}
        <div class="actions">
          <button type="button" class="btn btn-primary approve">${icon("check")}Approve ${esc(fmtHours(s.approvedHours ?? suggestHours(s)))} hours</button>
          <button type="button" class="btn btn-danger reject">Send back</button>
          ${editing ? `<button type="button" class="btn btn-invisible cancel">Cancel</button>` : ""}
        </div>` : `
        <div><div class="f6 color-fg-muted">Decision</div>
          <div>${s.status === "approved" ? `<b>${esc(fmtHours(s.approvedHours))} hours approved</b>` : `<b class="color-fg-danger">Sent back</b>`}${s.adminNote ? ` <span class="color-fg-muted">· ${esc(s.adminNote)}</span>` : ""}</div>
          ${s.reviewedAt ? `<div class="f6 color-fg-muted">${esc(fmtDate(s.reviewedAt))}</div>` : ""}
        </div>
        <div class="actions"><button type="button" class="btn btn-sm change">Edit</button></div>`}
    </div>
  </div>`;
}

function bindReviewCards(root) {
  $$(".review[data-id]", root).forEach((card) => {
    const id = card.dataset.id;
    const hours = $(".hours", card), approve = $(".approve", card), reject = $(".reject", card);
    if (hours && approve) hours.addEventListener("input", () => { approve.innerHTML = `${icon("check")}Approve ${esc(fmtHours(Number(hours.value) || 0))} hours`; });
    approve?.addEventListener("click", () => decide(card, id, "approved", approve));
    reject?.addEventListener("click", () => decide(card, id, "rejected", reject));
    $(".cancel", card)?.addEventListener("click", () => { state.editing.delete(id); renderPanel(); });
    $(".change", card)?.addEventListener("click", () => { state.editing.add(id); renderPanel(); });
  });
}

async function decide(card, id, status, btn) {
  const hours = Number($(".hours", card).value), note = $(".note", card).value.trim();
  if (status === "approved" && !(hours >= 0)) { toast("Enter the hours to approve.", "error"); return; }
  if (status === "rejected" && !note) { toast("A note is required to send a session back.", "error"); $(".note", card).focus(); return; }
  setBusy(btn, true, status === "approved" ? "Approving" : "Sending back");
  try {
    await db.reviewSession(id, { status, approvedHours: hours, adminNote: note });
    state.editing.delete(id);
    toast(status === "approved" ? `Approved ${fmtHours(hours)} hours.` : "Sent back.", status === "approved" ? "gold" : "");
    await loadData();
    renderDash();
  } catch (e) { toast(e.message, "error"); setBusy(btn, false); }
}

/* ---------------- live ---------------- */
function renderLive(panel) {
  const open = state.sessions.filter((s) => s.status === "open");
  panel.innerHTML = open.length ? open.map((s) => `
    <div class="Box mb-3" data-id="${esc(s.id)}">
      <div class="Box-header d-flex">
        <span class="initials">${esc(initials(s.userName || s.userEmail))}</span>
        <div class="flex-auto"><div class="text-semibold">${esc(s.userName || s.userEmail)}</div><div class="f6 color-fg-muted">${esc(s.event || "Outreach")} · since ${esc(fmtTime(s.clockInAt))}, ${esc(fmtDay(s.clockInAt))}</div></div>
        <span class="State State--open"><span class="dot"></span>Clocked in</span>
      </div>
      <div class="Box-body d-flex flex-wrap" style="gap:16px">
        <div class="photos mt-0" style="grid-template-columns:1fr;max-width:200px">${photoCell(s.clockInPhoto, "Clock in", s.clockInAt, s)}</div>
        <div><div class="f6 color-fg-muted">Time on the clock</div><div class="elapsed" data-since="${esc(s.clockInAt)}"></div></div>
      </div>
      <div class="Box-row color-bg-subtle d-flex flex-items-center flex-wrap" style="gap:8px 16px">
        <button type="button" class="btn btn-sm close">${icon("x-circle")}Close session</button>
        <span class="f6 color-fg-muted">For members who forgot to clock out. Ends the session now and sends it to review.</span>
      </div>
    </div>`).join("") : `<div class="Box"><div class="blankslate">${icon("pulse", 24)}<h3 class="blankslate-heading">No one is clocked in</h3></div></div>`;
  $$(".elapsed[data-since]", panel).forEach((el) => state.timers.push(liveTimer(el, el.dataset.since, 5000)));
  $$(".close", panel).forEach((b) => b.addEventListener("click", async () => {
    const card = b.closest("[data-id]"), id = card.dataset.id;
    if (!confirm("Close this session? The clock-out time will be now, and it will go to review.")) return;
    setBusy(b, true, "Closing");
    try { await db.closeSession(id); toast("Session closed. Sent to review.", "gold"); await loadData(); renderDash(); }
    catch (e) { toast(e.message, "error"); setBusy(b, false); }
  }));
  hydratePhotos(panel);
}

/* ---------------- members ---------------- */
function renderMembers(panel) {
  const req = Number(state.settings.requiredHours) || 9;
  const q = state.search.trim().toLowerCase();
  let list = state.members.filter((m) => !q || `${m.name} ${m.email} ${m.grade}`.toLowerCase().includes(q));
  if (state.sort === "progress") list = [...list].sort((a, b) => b.approvedHours - a.approvedHours || a.name.localeCompare(b.name));
  else if (state.sort === "left") list = [...list].sort((a, b) => a.approvedHours - b.approvedHours || a.name.localeCompare(b.name));
  const sorts = [["name", "A–Z"], ["progress", "Most hours"], ["left", "Fewest hours"]];
  panel.innerHTML = `
    <div class="toolbar mb-3">
      <div class="BtnGroup">${sorts.map(([k, l]) => `<button type="button" class="btn btn-sm BtnGroup-item ${state.sort === k ? "selected" : ""}" aria-pressed="${state.sort === k}" data-s="${k}">${l}</button>`).join("")}</div>
      <span class="spacer"></span>
      <input type="search" class="form-control input-sm" id="member-search" placeholder="Search" value="${esc(state.search)}" style="width:200px">
    </div>
    <div class="Box">
      <div class="Box-header d-flex"><h2 class="Box-title flex-auto">Members</h2><span class="Counter">${list.length}</span></div>
      ${list.length ? list.map((m) => `
      <div class="Box-row member-row">
        <div class="d-flex flex-items-center" style="gap:12px">
          <span class="initials small">${esc(initials(m.name || m.email))}</span>
          <div class="flex-auto" style="min-width:0"><span class="text-semibold">${esc(m.name || m.email)}</span>${m.role === "admin" ? ` <span class="Label Label--admin ml-1">Admin</span>` : ""}${m.excused ? ` <span class="Label Label--secondary ml-1">Excused</span>` : ""}</div>
          <div class="nums"><b>${esc(fmtHours(m.approvedHours))}</b><small> / ${esc(fmtHours(req))} h</small></div>
        </div>
        ${progressBar({ approved: m.approvedHours, pending: m.pendingHours, required: req, large: false, legend: false })}
        <div class="d-flex flex-justify-between f6 color-fg-muted mt-1">
          <span>${roundQuarter(m.pendingHours) ? `${esc(fmtHours(roundQuarter(m.pendingHours)))} h waiting for review` : ""}${m.openSessions ? `${roundQuarter(m.pendingHours) ? " · " : ""}clocked in` : ""}${m.excused && m.excusedNote ? `${roundQuarter(m.pendingHours) || m.openSessions ? " · " : ""}${esc(m.excusedNote)}` : ""}</span>
          <span>${m.excused ? "Excused" : m.approvedHours >= req ? `<span class="Label Label--approved">${icon("check", 12)} Requirement met</span>` : `${esc(fmtHours(req - m.approvedHours))} h to go`}</span>
        </div>
        ${m.id !== state.admin.id ? `<div class="member-actions">
          <button type="button" class="btn btn-sm excuse" data-id="${esc(m.id)}" data-excused="${m.excused ? "1" : ""}">${m.excused ? "Remove excuse" : "Excuse from hours"}</button>
          <button type="button" class="btn btn-sm btn-danger remove" data-id="${esc(m.id)}" data-name="${esc(m.name || m.email)}">Remove from roster</button>
        </div>` : ""}
      </div>`).join("") : `<div class="blankslate">${icon("people", 24)}<h3 class="blankslate-heading">No matching members</h3></div>`}
      <div class="Box-footer d-flex flex-wrap flex-items-center" style="gap:8px">
        <button type="button" class="btn btn-sm" id="export-members">${icon("download")}Download roster (CSV)</button>
        <button type="button" class="btn btn-sm" id="export-sessions">${icon("download")}Download sessions (CSV)</button>
      </div>
    </div>`;
  $$(".BtnGroup-item", panel).forEach((b) => b.addEventListener("click", () => { state.sort = b.dataset.s; renderPanel(); }));
  $$(".excuse", panel).forEach((b) => b.addEventListener("click", async () => {
    const excusing = !b.dataset.excused;
    let note = "";
    if (excusing) { note = prompt("Reason (optional). Members see this on their page."); if (note === null) return; }
    setBusy(b, true, "Saving");
    try { await db.setExcused(b.dataset.id, excusing, note.trim()); toast(excusing ? "Excused from the requirement." : "Excuse removed.", "gold"); await loadData(); renderDash(); }
    catch (e) { toast(e.message, "error"); setBusy(b, false); }
  }));
  $$(".remove", panel).forEach((b) => b.addEventListener("click", async () => {
    if (!confirm(`Remove ${b.dataset.name} from the roster? Their account, sessions and photos are deleted. This can't be undone.`)) return;
    setBusy(b, true, "Removing");
    try { await db.removeMember(b.dataset.id); toast("Removed from the roster.", "gold"); await loadData(); renderDash(); }
    catch (e) { toast(e.message, "error"); setBusy(b, false); }
  }));
  const search = $("#member-search", panel);
  search.addEventListener("input", () => { state.search = search.value; const pos = search.selectionStart; renderPanel(); const s2 = $("#member-search"); s2.focus(); s2.setSelectionRange(pos, pos); });
  $("#export-members", panel).addEventListener("click", () => {
    const rows = [["Name", "Email", "Grade", "Approved hours", "Waiting for review (hours)", "Required hours", "Status", "Excused note"]];
    state.members.forEach((m) => rows.push([m.name, m.email, m.grade, fmtHours(m.approvedHours), fmtHours(m.pendingHours), req, m.excused ? "Excused" : m.approvedHours >= req ? "Requirement met" : "In progress", m.excusedNote || ""]));
    csvDownload(`outreach-roster-${state.settings.semesterName.replace(/\s+/g, "-").toLowerCase()}.csv`, rows);
  });
  $("#export-sessions", panel).addEventListener("click", () => {
    const iso = (v) => { if (!v) return ""; const d = new Date(v); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
    const rows = [["Date", "Member email", "Event", "Clock in", "Clock out", "Hours on clock", "Status", "Approved hours", "Admin note", "Member name"]];
    state.sessions.forEach((s) => rows.push([iso(s.clockInAt).slice(0, 10), s.userEmail, s.event, iso(s.clockInAt).slice(11), iso(s.clockOutAt).slice(11), s.clockOutAt ? fmtHours(hoursBetween(s.clockInAt, s.clockOutAt)) : "", ({ pending: "Waiting", approved: "Approved", rejected: "Sent back", open: "Open" })[s.status], s.approvedHours ?? "", s.adminNote, s.userName]));
    csvDownload(`outreach-sessions-${state.settings.semesterName.replace(/\s+/g, "-").toLowerCase()}.csv`, rows);
  });
}

/* ---------------- settings ---------------- */
function renderSettings(panel) {
  const st = state.settings;
  panel.innerHTML = `
    <div class="Box" style="max-width:640px">
      <div class="Box-header"><h2 class="Box-title">Semester</h2></div>
      <div class="Box-body">
        <form id="settings-form">
          <div class="form-group"><label for="semesterName">Name</label><input class="form-control width-full" id="semesterName" name="semesterName" type="text" value="${esc(st.semesterName)}" required></div>
          <div class="field-row">
            <div class="form-group"><label for="semesterStart">Start</label><input class="form-control width-full" id="semesterStart" name="semesterStart" type="date" value="${esc(st.semesterStart)}" required></div>
            <div class="form-group"><label for="semesterEnd">End</label><input class="form-control width-full" id="semesterEnd" name="semesterEnd" type="date" value="${esc(st.semesterEnd)}" required></div>
          </div>
          <div class="form-group"><label for="requiredHours">Required hours per member</label><input class="form-control" id="requiredHours" name="requiredHours" type="number" step="0.5" min="0" value="${esc(st.requiredHours)}" required style="max-width:160px"></div>
          <div class="form-group"><label for="verificationObject">Required object in every photo</label><input class="form-control width-full" id="verificationObject" name="verificationObject" type="text" value="${esc(st.verificationObject)}" maxlength="80" required></div>
          <div class="form-error" id="settings-error"></div>
          <button class="btn btn-primary" type="submit">Save</button>
        </form>
      </div>
    </div>
    <div class="Box" style="max-width:640px">
      <div class="Box-header"><h2 class="Box-title">Admins</h2></div>
      ${db.mode === "supabase" ? `
                ${state.members.map((m) => `
          <div class="Box-row d-flex flex-items-center" style="gap:12px">
            <span class="initials small">${esc(initials(m.name || m.email))}</span>
            <div class="flex-auto" style="min-width:0"><div class="text-semibold">${esc(m.name || m.email)}</div><div class="f6 color-fg-muted">${esc(m.email)}</div></div>
            ${m.id === state.admin.id ? `<span class="Label Label--admin">Admin · you</span>` : m.role === "admin" ? `<button type="button" class="btn btn-sm role" data-id="${esc(m.id)}" data-role="member">Remove admin</button>` : `<button type="button" class="btn btn-sm role" data-id="${esc(m.id)}" data-role="admin">Make admin</button>`}
          </div>`).join("")}
      ` : `
        <div class="Box-row f6 color-fg-muted">Demo mode uses one shared passcode from config.js. With Supabase connected, admins are accounts managed here.</div>
        <div class="Box-row"><button type="button" class="btn btn-sm btn-danger" id="reset-demo">${icon("trash")}Reset demo data</button></div>
      `}
    </div>`;
  $("#settings-form", panel).addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.currentTarget.querySelector("button[type=submit]"), err = $("#settings-error");
    const f = Object.fromEntries(new FormData(e.currentTarget).entries());
    if (f.semesterEnd < f.semesterStart) { err.textContent = "End date is before start date."; return; }
    setBusy(btn, true, "Saving");
    try { state.settings = await db.updateSettings({ ...f, requiredHours: Number(f.requiredHours) }); toast("Saved.", "gold"); await loadData(); renderDash(); }
    catch (ex) { err.textContent = ex.message; setBusy(btn, false); }
  });
  $$(".role", panel).forEach((b) => b.addEventListener("click", async () => {
    setBusy(b, true, "Saving");
    try { await db.setRole(b.dataset.id, b.dataset.role); toast(b.dataset.role === "admin" ? "Admin access added." : "Admin access removed.", "gold"); await loadData(); renderPanel(); }
    catch (e) { toast(e.message, "error"); setBusy(b, false); }
  }));
  $("#reset-demo", panel)?.addEventListener("click", async () => {
    if (!confirm("Reset demo data? This removes anything you added.")) return;
    await db.resetDemo(); toast("Demo data reset.", "gold"); await refresh();
  });
}
