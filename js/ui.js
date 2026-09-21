// DOM + formatting helpers shared by the member app and the lead app. Markup follows Primer (github.com/primer).

import { icon } from "./icons.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36));

/* ---------- dates & numbers ---------- */
const d = (v) => (v instanceof Date ? v : new Date(v));
export const fmtDate = (v) => d(v).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
export const fmtDay = (v) => d(v).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
export const fmtTime = (v) => d(v).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
export const fmtTimeSec = (v) => d(v).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
export const fmtStamp = (v) => `${fmtDay(v)}, ${d(v).getFullYear()} · ${fmtTimeSec(v)}`;

export function hoursBetween(a, b) {
  if (!a || !b) return 0;
  return Math.max(0, (d(b) - d(a)) / 36e5);
}
export const roundQuarter = (h) => Math.round(h * 4) / 4;
export function fmtHours(h) {
  const n = Number(h) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");
}
export function fmtDuration(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(m / 60), r = m % 60;
  if (h === 0) return `${r}m`;
  return `${h}h ${String(r).padStart(2, "0")}m`;
}
export const inRange = (iso, start, end) => {
  const t = d(iso).getTime();
  const s = new Date(start + "T00:00:00").getTime();
  const e = new Date(end + "T23:59:59").getTime();
  return t >= s && t <= e;
};
export const initials = (name = "") => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";

/* ---------- status labels (Primer Label) ---------- */
export const STATUS_LABEL = { open: "Clocked in", pending: "Waiting for review", approved: "Approved", rejected: "Sent back" };
export function statusTag(status) {
  const cls = { open: "Label--live", pending: "Label--secondary", approved: "Label--approved", rejected: "Label--danger" }[status] || "Label--secondary";
  const ic = { open: icon("dot-fill", 12), approved: icon("check", 12), rejected: icon("x", 12), pending: icon("clock", 12) }[status] || "";
  return `<span class="Label ${cls}">${ic} ${esc(STATUS_LABEL[status] || status)}</span>`;
}

/* ---------- progress bar (Primer Progress) ---------- */
export function progressBar({ approved = 0, pending = 0, required = 9, large = true, legend = true, excused = false }) {
  pending = roundQuarter(pending);
  const req = Math.max(required, 0.0001);
  const a = Math.min(100, (approved / req) * 100);
  const p = Math.min(100 - a, (pending / req) * 100);
  const left = Math.max(0, required - approved - pending);
  const leg = legend
    ? `<ul class="legend">
        <li><span class="dot approved"></span><b>${fmtHours(approved)}</b> approved</li>
        ${pending > 0 ? `<li><span class="dot pending"></span><b>${fmtHours(pending)}</b> waiting for review</li>` : ""}
        <li><span class="dot left"></span>${excused ? "<b>Excused</b> this semester" : approved >= required ? "<b>Requirement met</b>" : `<b>${fmtHours(left)}</b> to go`}</li>
      </ul>`
    : "";
  return `<span class="Progress ${large ? "Progress--large" : ""}" role="progressbar" aria-valuemin="0" aria-valuemax="${esc(required)}" aria-valuenow="${esc(approved)}" aria-label="${esc(fmtHours(approved))} of ${esc(fmtHours(required))} hours approved">
      ${a > 0 ? `<span class="Progress-item approved" style="width:${a.toFixed(2)}%"></span>` : ""}
      ${p > 0 ? `<span class="Progress-item pending" style="width:${p.toFixed(2)}%"></span>` : ""}
    </span>${leg}`;
}

/* ---------- toast (Primer Toast) ---------- */
let toastTimer;
export function toast(msg, kind = "") {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  const variant = kind === "gold" ? "Toast--success" : kind === "error" ? "Toast--error" : "";
  const ic = kind === "gold" ? "check" : kind === "error" ? "alert" : "info";
  t.className = `Toast app-toast ${variant}`;
  t.innerHTML = `<span class="Toast-icon">${icon(ic)}</span><span class="Toast-content">${esc(msg)}</span>`;
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
}

/* ---------- dialog (Primer Overlay on a native <dialog>) ---------- */
let dlg, onDialogClose;
function ensureDialog() {
  if (dlg) return;
  dlg = document.createElement("dialog");
  dlg.className = "Overlay Overlay--size-medium Overlay--placement-bottom-whenNarrow";
  dlg.setAttribute("aria-modal", "true");
  document.body.appendChild(dlg);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) sheet.close(); });
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); sheet.close(); });
}
export const sheet = {
  open(html, { onClose } = {}) {
    ensureDialog();
    onDialogClose = onClose;
    dlg.innerHTML = html;
    document.body.classList.add("sheet-open");
    if (!dlg.open) dlg.showModal();
    $$(".Overlay-closeButton", dlg).forEach((b) => b.addEventListener("click", () => sheet.close()));
    return dlg;
  },
  close() {
    if (!dlg || !dlg.open) return;
    dlg.close();
    document.body.classList.remove("sheet-open");
    const cb = onDialogClose; onDialogClose = null;
    dlg.innerHTML = "";
    if (cb) cb();
  },
  el: () => dlg,
};

/* ---------- lightbox ---------- */
let lb;
export function lightbox(src, caption = "") {
  if (!lb) {
    lb = document.createElement("div"); lb.className = "lightbox";
    lb.innerHTML = `<div><img alt=""><div class="cap"></div></div>`;
    lb.addEventListener("click", () => lb.classList.remove("show"));
    document.body.appendChild(lb);
  }
  lb.querySelector("img").src = src;
  lb.querySelector(".cap").innerHTML = caption;
  lb.classList.add("show");
}

/* ---------- misc ---------- */
export const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function liveTimer(el, startIso, every = 15000) {
  const tick = () => { if (el.isConnected) el.textContent = fmtDuration(Date.now() - new Date(startIso).getTime()); };
  tick();
  const id = setInterval(tick, every);
  return () => clearInterval(id);
}

export function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>${esc(label || "Working")}`;
  } else {
    btn.disabled = false;
    if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
  }
}

export function csvDownload(filename, rows) {
  const cell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const body = rows.map((r) => r.map(cell).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
