// Shared helpers: formatting, status text, progress, segmented control, toast, sheet (with drag-to-dismiss), lightbox.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36));

/* ---------- dates & numbers ---------- */
const d = (v) => (v instanceof Date ? v : new Date(v));
export const fmtDate = (v) => d(v).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
export const fmtDay = (v) => d(v).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
export const fmtTime = (v) => d(v).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
export const fmtTimeSec = (v) => d(v).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
export const fmtStamp = (v) => `${fmtDay(v)}, ${d(v).getFullYear()} · ${fmtTimeSec(v)}`;
export function hoursBetween(a, b) { if (!a || !b) return 0; return Math.max(0, (d(b) - d(a)) / 36e5); }
export const roundQuarter = (h) => Math.round(h * 4) / 4;
export function fmtHours(h) { const n = Number(h) || 0; return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""); }
export function fmtDuration(ms) {
  const m = Math.max(0, Math.round(ms / 60000)), h = Math.floor(m / 60), r = m % 60;
  return h === 0 ? `${r}m` : `${h}h ${String(r).padStart(2, "0")}m`;
}
export const inRange = (iso, start, end) => { const t = d(iso).getTime(); return t >= new Date(start + "T00:00:00").getTime() && t <= new Date(end + "T23:59:59").getTime(); };
export const initials = (name = "") => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";
export const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/* ---------- status & category ---------- */
export const STATUS_LABEL = { open: "Clocked in", pending: "Waiting for review", approved: "Approved", rejected: "Sent back" };
export const statusText = (status) => `<span class="status status--${esc(status)}">${esc(STATUS_LABEL[status] || status)}</span>`;
export const CATEGORY_LABEL = { outreach: "Outreach", shop: "Shop" };
export const chip = (cat) => { const c = cat === "shop" ? "shop" : "outreach"; return `<span class="chip chip--${c}">${CATEGORY_LABEL[c]}</span>`; };

/* ---------- progress ---------- */
export function progressBar({ approved = 0, pending = 0, required = 10, excused = false, legend = true }) {
  pending = roundQuarter(pending);
  const req = Math.max(required, 0.0001);
  const a = Math.min(100, (approved / req) * 100), p = Math.min(100 - a, (pending / req) * 100);
  const left = Math.max(0, required - approved - pending);
  const parts = [`<b>${fmtHours(approved)}</b> approved`];
  if (pending > 0) parts.push(`<b>${fmtHours(pending)}</b> waiting for review`);
  parts.push(excused ? `<b>excused</b> this semester` : approved >= required ? `<b>requirement met</b>` : `<b>${fmtHours(left)}</b> to go`);
  return `<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${esc(required)}" aria-valuenow="${esc(approved)}"><div class="bar__fill" style="width:${a.toFixed(2)}%"></div><div class="bar__pending" style="width:${p.toFixed(2)}%"></div></div>${legend ? `<p class="legend">${parts.join(", ")}</p>` : ""}`;
}

/* ---------- segmented control: responds on press, indicator slides ---------- */
export function segmented(el, { items, value, onChange, small = false }) {
  el.classList.add("seg"); if (small) el.classList.add("seg--small");
  el.setAttribute("role", "group");
  el.style.setProperty("--n", items.length);
  el.innerHTML = `<span class="seg__indicator" aria-hidden="true"></span>` + items.map((it) => `<button type="button" class="seg__item" data-value="${esc(it.value)}" aria-pressed="${it.value === value}">${esc(it.label)}</button>`).join("");
  const set = (v, fire = true) => {
    const i = Math.max(0, items.findIndex((it) => it.value === v));
    el.style.setProperty("--i", i);
    $$(".seg__item", el).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === v)));
    if (fire && onChange) onChange(v);
  };
  set(value, false);
  $$(".seg__item", el).forEach((b) => {
    b.addEventListener("pointerdown", (e) => { if (e.button === 0 && e.pointerType !== "touch") set(b.dataset.value); });
    b.addEventListener("click", () => { if (b.getAttribute("aria-pressed") !== "true") set(b.dataset.value); });
  });
  return { set };
}

/* ---------- toast ---------- */
let toastTimer;
export function toast(msg) {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.remove("show");
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add("show")));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

/* ---------- sheet ----------
   Bottom sheet on phones (drag the header to dismiss: 1:1 tracking, rubber-band upward, velocity-projected release),
   centered panel on wide screens. Animations start from the current on-screen value so a grab mid-flight just takes over. */
const narrow = () => window.matchMedia("(max-width: 719px)").matches;
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let scrimEl, sheetEl, onSheetClose, sheetOpen = false;

function currentY(el) {
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return 0;
  const m = t.match(/matrix\((.+)\)/);
  return m ? parseFloat(m[1].split(",")[5]) || 0 : 0;
}
function project(v, rate = 0.998) { return (v / 1000) * rate / (1 - rate); }
function rubberband(over, dimension, c = 0.55) { return (over * dimension * c) / (dimension + c * Math.abs(over)); }

function ensureSheet() {
  if (sheetEl) return;
  scrimEl = document.createElement("div"); scrimEl.className = "scrim";
  sheetEl = document.createElement("div"); sheetEl.className = "sheet"; sheetEl.setAttribute("role", "dialog"); sheetEl.setAttribute("aria-modal", "true");
  document.body.append(scrimEl, sheetEl);
  scrimEl.addEventListener("click", () => sheet.close());
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sheetOpen) sheet.close(); });

  // drag to dismiss (phones only), on the header/grabber so the body can still scroll
  let dragging = false, startY = 0, baseY = 0, pid = null, hist = [];
  sheetEl.addEventListener("pointerdown", (e) => {
    if (!narrow() || !sheetOpen) return;
    if (!e.target.closest(".sheet__head, .sheet__grab")) return;
    if (e.target.closest("button, a, input, select, textarea")) return;
    dragging = true; pid = e.pointerId; sheetEl.setPointerCapture(pid);
    sheetEl.getAnimations().forEach((a) => { try { a.commitStyles(); } catch (_) {} a.cancel(); });
    baseY = currentY(sheetEl); startY = e.clientY; hist = [{ t: performance.now(), y: baseY }];
    scrimEl.style.transition = "none"; sheetEl.style.transition = "none";
  });
  sheetEl.addEventListener("pointermove", (e) => {
    if (!dragging || e.pointerId !== pid) return;
    const h = sheetEl.offsetHeight || 1;
    let y = baseY + (e.clientY - startY);
    if (y < 0) y = rubberband(y, h);
    sheetEl.style.transform = `translateY(${y}px)`;
    scrimEl.style.opacity = String(Math.max(0, Math.min(1, 1 - y / h)));
    hist.push({ t: performance.now(), y }); if (hist.length > 6) hist.shift();
  });
  const release = (e) => {
    if (!dragging || e.pointerId !== pid) return;
    dragging = false; try { sheetEl.releasePointerCapture(pid); } catch (_) {}
    const h = sheetEl.offsetHeight || 1, y = currentY(sheetEl);
    const a = hist[0], b = hist[hist.length - 1];
    const v = a && b && b.t > a.t ? ((b.y - a.y) / (b.t - a.t)) * 1000 : 0; // px/s
    const landing = y + project(v);
    scrimEl.style.transition = ""; sheetEl.style.transition = "";
    if (v > 700 || landing > h * 0.45) sheet.close({ velocity: Math.max(v, 0) });
    else { animateTo(sheetEl, `translateY(${y}px)`, "translateY(0)", 380); scrimEl.style.opacity = ""; }
  };
  sheetEl.addEventListener("pointerup", release);
  sheetEl.addEventListener("pointercancel", release);
}
function animateTo(el, from, to, duration, extra = {}) {
  el.style.transform = "";
  const settle = () => { if (to === "translateY(0)" || /scale\(1\)/.test(to)) el.style.transform = ""; else el.style.transform = to; };
  if (reducedMotion()) { settle(); return Promise.resolve(); }
  const anim = el.animate([{ transform: from, ...(extra.from || {}) }, { transform: to, ...(extra.to || {}) }], { duration, easing: "cubic-bezier(0.32, 0.72, 0, 1)", fill: "both" });
  // If the tab is throttled and frames never come, don't wait forever: settle at the target.
  const timeout = new Promise((r) => setTimeout(r, duration + 150));
  return Promise.race([anim.finished.catch(() => {}), timeout]).then(() => { try { anim.commitStyles(); } catch (_) {} anim.cancel(); settle(); });
}

export const sheet = {
  open(html, { onClose } = {}) {
    ensureSheet();
    onSheetClose = onClose; sheetOpen = true;
    sheetEl.innerHTML = `<div class="sheet__grab" aria-hidden="true"></div>${html}`;
    sheetEl.style.display = "flex"; scrimEl.style.display = "block"; scrimEl.style.opacity = "";
    document.body.classList.add("sheet-open");
    requestAnimationFrame(() => scrimEl.classList.add("show"));
    if (narrow()) animateTo(sheetEl, "translateY(100%)", "translateY(0)", 440);
    else animateTo(sheetEl, "translate(-50%, -50%) scale(0.96)", "translate(-50%, -50%) scale(1)", 260, { from: { opacity: 0 }, to: { opacity: 1 } });
    $$(".sheet__close", sheetEl).forEach((b) => b.addEventListener("click", () => sheet.close()));
    const focusable = sheetEl.querySelector("input:not([type=file]), select, textarea, .sheet__close");
    if (focusable && !narrow()) setTimeout(() => focusable.focus({ preventScroll: true }), 120);
    return sheetEl;
  },
  async close({ velocity = 0 } = {}) {
    if (!sheetEl || !sheetOpen) return;
    sheetOpen = false;
    scrimEl.classList.remove("show"); scrimEl.style.opacity = "";
    document.body.classList.remove("sheet-open");
    const cb = onSheetClose; onSheetClose = null;
    if (narrow()) {
      const y = currentY(sheetEl), h = sheetEl.offsetHeight || 1, remaining = Math.max(0, h - y);
      const duration = Math.max(160, Math.min(420, velocity > 0 ? (remaining / velocity) * 1000 : 360));
      await animateTo(sheetEl, `translateY(${y}px)`, "translateY(100%)", duration);
    } else {
      await animateTo(sheetEl, "translate(-50%, -50%) scale(1)", "translate(-50%, -50%) scale(0.97)", 180, { from: { opacity: 1 }, to: { opacity: 0 } });
    }
    if (!sheetOpen) { sheetEl.style.display = "none"; scrimEl.style.display = "none"; sheetEl.innerHTML = ""; sheetEl.style.transform = ""; }
    if (cb) cb();
  },
  el: () => sheetEl,
  isOpen: () => sheetOpen,
};
export const sheetHead = (title, sub = "") => `<div class="sheet__head"><div><h2 class="sheet__title">${title}</h2>${sub ? `<p class="sheet__sub">${sub}</p>` : ""}</div><button type="button" class="sheet__close" aria-label="Close">&#x2715;</button></div>`;

/* ---------- lightbox ---------- */
let lb;
export function lightbox(src, caption = "") {
  if (!lb) {
    lb = document.createElement("div"); lb.className = "lightbox";
    lb.innerHTML = `<div><img alt=""><div class="cap"></div></div>`;
    lb.addEventListener("click", () => lb.classList.remove("show"));
    document.body.appendChild(lb);
  }
  lb.querySelector("img").src = src; lb.querySelector(".cap").innerHTML = caption; lb.classList.add("show");
}

/* ---------- misc ---------- */
export const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export function liveTimer(el, startIso, every = 15000) {
  const tick = () => { if (el.isConnected) el.textContent = fmtDuration(Date.now() - new Date(startIso).getTime()); };
  tick(); const id = setInterval(tick, every); return () => clearInterval(id);
}
export function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>${esc(label || "Working")}`; }
  else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}
export function csvDownload(filename, rows) {
  const cell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob(["﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export const CAMERA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>`;
export const SEARCH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>`;
