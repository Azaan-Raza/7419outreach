// Camera capture + downscale + a visible timestamp strip burned into the photo.
// The server still records its own time; the strip is so a lead can read it at a glance.

import { fmtStamp } from "./ui.js";

const MAX_EDGE = 1280;

export function pickPhoto(input) {
  return new Promise((resolve) => {
    const onChange = () => {
      const f = input.files && input.files[0];
      input.removeEventListener("change", onChange);
      resolve(f || null);
    };
    input.addEventListener("change", onChange);
  });
}

async function loadBitmap(file) {
  if ("createImageBitmap" in window) {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (_) { /* fall through */ }
    try { return await createImageBitmap(file); } catch (_) { /* fall through */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file couldn't be read as a photo.")); };
    img.src = url;
  });
}

/**
 * @param {File} file
 * @param {{name:string, kind:'in'|'out', when?:Date}} meta
 * @returns {Promise<{blob:Blob, url:string, width:number, height:number}>}
 */
export async function preparePhoto(file, { name, kind, when = new Date() }) {
  const src = await loadBitmap(file);
  const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
  const scale = Math.min(1, MAX_EDGE / Math.max(sw, sh));
  const w = Math.round(sw * scale), h = Math.round(sh * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(src, 0, 0, w, h);
  if (src.close) src.close();

  // timestamp strip
  const strip = Math.max(56, Math.round(h * 0.12));
  ctx.fillStyle = "rgba(17,34,78,0.82)";
  ctx.fillRect(0, h - strip, w, strip);
  const f1 = Math.max(11, Math.round(w / 56)), f2 = Math.max(13, Math.round(w / 40));
  const pad = Math.round(w * 0.025);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffc14a";
  ctx.font = `600 ${f1}px Outfit, -apple-system, Helvetica, Arial, sans-serif`;
  ctx.fillText(`7419 OUTREACH  ·  CLOCK ${kind === "in" ? "IN" : "OUT"}`, pad, h - strip + f1 + Math.round(strip * 0.14));
  ctx.fillStyle = "#f5f5ee";
  ctx.font = `500 ${f2}px Outfit, -apple-system, Helvetica, Arial, sans-serif`;
  ctx.fillText(`${name}  ·  ${fmtStamp(when)}`, pad, h - Math.round(strip * 0.22));

  const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.82));
  if (!blob) throw new Error("Couldn't process that photo.");
  return { blob, url: URL.createObjectURL(blob), width: w, height: h };
}

/** Navy placeholder used for demo-mode sample sessions. */
export function placeholderPhoto(label = "Sample photo") {
  const c = document.createElement("canvas"); c.width = 640; c.height = 480;
  const x = c.getContext("2d");
  x.fillStyle = "#1a2f5e"; x.fillRect(0, 0, 640, 480);
  x.fillStyle = "#11224e"; for (let i = 0; i < 640; i += 40) x.fillRect(i, 0, 20, 480);
  x.fillStyle = "#ffc14a"; x.font = "600 26px Outfit, Helvetica, Arial, sans-serif"; x.textAlign = "center";
  x.fillText(label, 320, 250);
  return c.toDataURL("image/jpeg", 0.7);
}
