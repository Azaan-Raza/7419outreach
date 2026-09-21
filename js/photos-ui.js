// Photo thumbnails with captions, resolved lazily through the data layer (signed URLs in Supabase mode).
import { db } from "./db.js";
import { $$, esc, fmtDay, fmtTime, lightbox } from "./ui.js";

export function photoCell(path, label, when, s = {}) {
  if (!path) {
    return `<div class="photo"><button type="button" disabled>${esc(label === "Clock out" ? "Not clocked out" : "No photo")}</button><div class="cap"><b>${esc(label)}</b><span>—</span></div></div>`;
  }
  const cap = `${s.userName ? esc(s.userName) + " · " : ""}<b>${esc(label)}</b> · ${esc(fmtDay(when))} ${esc(fmtTime(when))}`;
  return `<div class="photo"><button type="button" data-photo="${esc(path)}" data-cap="${esc(cap)}" aria-label="${esc(label)} photo"><img alt="" loading="lazy"></button><div class="cap"><b>${esc(label)}</b><span>${esc(fmtTime(when))}</span></div></div>`;
}

export function hydratePhotos(root) {
  $$("[data-photo]", root).forEach(async (btn) => {
    if (btn.dataset.loaded) return;
    btn.dataset.loaded = "1";
    const img = btn.querySelector("img");
    btn.addEventListener("click", () => { if (img?.src) lightbox(img.src, btn.dataset.cap); });
    const url = await db.photoUrl(btn.dataset.photo);
    if (url && img) img.src = url;
  });
}
