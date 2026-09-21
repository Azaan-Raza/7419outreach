// Data layer. Two backends share one interface:
//   DemoDb  — localStorage + IndexedDB, everything stays on this device. Used when config.js has no Supabase keys.
//   SupaDb  — Supabase auth, Postgres (with RLS + server-side timestamps) and Storage for photos.
//
// Session shape used by the UI:
// { id, userId, userName, userEmail, userGrade, event, clockInAt, clockInPhoto, clockOutAt, clockOutPhoto,
//   note, status: 'open'|'pending'|'approved'|'rejected', approvedHours, adminNote, reviewedAt }

import { uid, hoursBetween, inRange, roundQuarter } from "./ui.js";
import { placeholderPhoto } from "./photo.js";

const CFG = window.OUTREACH_CONFIG || {};
// ?demo in the URL switches this browser to demo mode (sample data, nothing touches Supabase); ?live switches back.
const params = new URLSearchParams(location.search);
if (params.has("demo")) localStorage.setItem("outreach-demo", "1");
if (params.has("live")) localStorage.removeItem("outreach-demo");
export const FORCE_DEMO = localStorage.getItem("outreach-demo") === "1";
export const HAS_SUPABASE = !!(CFG.supabaseUrl && CFG.supabaseAnonKey) && !FORCE_DEMO;

export const suggestHours = (s) => roundQuarter(hoursBetween(s.clockInAt, s.clockOutAt));
const GENERIC_OBJECT = "the object specified by an admin";

/* =========================================================================================
   Demo backend
   ========================================================================================= */

const idb = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open("outreach-photos", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("photos");
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async put(key, blob) {
    const db = await this.open();
    return new Promise((res, rej) => { const tx = db.transaction("photos", "readwrite"); tx.objectStore("photos").put(blob, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  },
  async get(key) {
    const db = await this.open();
    return new Promise((res, rej) => { const q = db.transaction("photos").objectStore("photos").get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error); });
  },
};

function seedState() {
  const day = (offset, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() - offset); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const users = [
    { id: "u-alex", name: "Alex Kim", email: "alex@example.com", grade: "11", role: "member", password: "demo", createdAt: day(30, 9), excused: false, excusedNote: "" },
    { id: "u-jordan", name: "Jordan Patel", email: "jordan@example.com", grade: "10", role: "member", password: "demo", createdAt: day(28, 9), excused: false, excusedNote: "" },
    { id: "u-sam", name: "Sam Rivera", email: "sam@example.com", grade: "12", role: "admin", password: "demo", createdAt: day(25, 9), excused: false, excusedNote: "" },
  ];
  const sessions = [
    { id: "s1", userId: "u-alex", event: "FTC Meet", clockInAt: day(12, 17, 2), clockOutAt: day(12, 19, 35), status: "approved", approvedHours: 2.5, adminNote: "", reviewedAt: day(11, 8) },
    { id: "s2", userId: "u-alex", event: "Elementary school robot demo", clockInAt: day(5, 13, 58), clockOutAt: day(5, 16, 1), status: "approved", approvedHours: 2, adminNote: "", reviewedAt: day(4, 8) },
    { id: "s3", userId: "u-alex", event: "Farmers market booth", clockInAt: day(1, 9, 4), clockOutAt: day(1, 11, 40), status: "pending", approvedHours: null, adminNote: "" },
    { id: "s4", userId: "u-jordan", event: "FTC Meet", clockInAt: day(12, 17, 10), clockOutAt: day(12, 19, 30), status: "approved", approvedHours: 2.25, adminNote: "", reviewedAt: day(11, 8) },
    { id: "s5", userId: "u-jordan", event: "Farmers market booth", clockInAt: day(1, 8, 55), clockOutAt: day(1, 11, 45), status: "pending", approvedHours: null, adminNote: "" },
    { id: "s6", userId: "u-sam", event: "Farmers market booth", clockInAt: day(1, 9, 30), clockOutAt: day(1, 9, 41), status: "rejected", approvedHours: null, adminNote: "Photos are 11 minutes apart. Clock out when you leave, not before.", reviewedAt: day(0, 8) },
    { id: "s7", userId: "u-sam", event: "Middle school FLL mentoring", clockInAt: day(8, 15, 30), clockOutAt: day(8, 18, 3), status: "approved", approvedHours: 2.5, adminNote: "", reviewedAt: day(7, 8) },
  ].map((s) => ({ ...s, clockInPhoto: `sample/${s.id}-in`, clockOutPhoto: `sample/${s.id}-out`, note: "" }));
  const y = new Date().getFullYear();
  return {
    users, sessions, auth: null, adminAuth: false,
    settings: { semesterName: `Fall ${y}`, semesterStart: `${y}-08-17`, semesterEnd: `${y}-12-18`, requiredHours: 9, verificationObject: GENERIC_OBJECT },
  };
}

class DemoDb {
  constructor() {
    this.mode = "demo";
    this.key = "outreach-hours-demo-v1";
    this.listeners = [];
    this.urlCache = new Map();
    try { this.state = JSON.parse(localStorage.getItem(this.key)) || null; } catch (_) { this.state = null; }
    if (!this.state) { this.state = seedState(); this.save(); }
    // older demo data named a specific object; the wording is now "specified by a lead"
    if (/team banner|specified by a lead/i.test(this.state.settings?.verificationObject || "")) { this.state.settings.verificationObject = GENERIC_OBJECT; this.save(); }
    this.state.users.forEach((u) => { if (u.excused === undefined) { u.excused = false; u.excusedNote = ""; } });
    if (!this.state.users.some((u) => u.role === "admin")) { const sam = this.state.users.find((u) => u.id === "u-sam"); if (sam) { sam.role = "admin"; this.save(); } }
  }
  async init() { return this; }
  save() { localStorage.setItem(this.key, JSON.stringify(this.state)); }
  emit() { this.listeners.forEach((cb) => cb()); }
  onAuthChange(cb) { this.listeners.push(cb); }
  pub(u) { return u ? { id: u.id, name: u.name, email: u.email, grade: u.grade, role: u.role, excused: !!u.excused, excusedNote: u.excusedNote || "" } : null; }
  me() { return this.state.users.find((u) => u.id === this.state.auth) || null; }
  requireUser() { const u = this.me(); if (!u) throw new Error("Signed out. Sign in again."); return u; }
  requireAdmin() { if (!this.state.adminAuth) throw new Error("Admin sign-in required."); }

  /* auth */
  async signUp({ name, email, password, grade }) {
    email = String(email || "").trim().toLowerCase();
    if (!name || !email || !password) throw new Error("Name, email and password are required.");
    if (password.length < 6) throw new Error("Password must be at least 6 characters.");
    if (this.state.users.some((u) => u.email === email)) throw new Error("An account with that email already exists.");
    const u = { id: uid(), name: name.trim(), email, grade: grade || "", role: "member", password, createdAt: new Date().toISOString(), excused: false, excusedNote: "" };
    this.state.users.push(u); this.state.auth = u.id; this.save(); this.emit();
    return { user: this.pub(u), needsConfirm: false };
  }
  async signIn({ email, password }) {
    email = String(email || "").trim().toLowerCase();
    const u = this.state.users.find((x) => x.email === email);
    if (!u || u.password !== password) throw new Error("Wrong email or password.");
    this.state.auth = u.id; this.save(); this.emit();
    return this.pub(u);
  }
  async signOut() { this.state.auth = null; this.state.adminAuth = false; this.save(); this.emit(); }
  async getUser() { return this.pub(this.me()); }

  /* settings */
  async getSettings() { return { ...this.state.settings }; }
  async updateSettings(patch) { this.requireAdmin(); Object.assign(this.state.settings, patch); this.save(); return this.getSettings(); }

  /* member sessions */
  decorate(s) {
    const u = this.state.users.find((x) => x.id === s.userId);
    return { ...s, userName: u?.name || "Unknown", userEmail: u?.email || "", userGrade: u?.grade || "" };
  }
  async listMySessions() {
    const u = this.requireUser();
    return this.state.sessions.filter((s) => s.userId === u.id).sort((a, b) => b.clockInAt.localeCompare(a.clockInAt)).map((s) => this.decorate(s));
  }
  async getOpenSession() {
    const u = this.requireUser();
    const s = this.state.sessions.find((x) => x.userId === u.id && x.status === "open");
    return s ? this.decorate(s) : null;
  }
  async clockIn({ event, photoBlob }) {
    const u = this.requireUser();
    if (this.state.sessions.some((x) => x.userId === u.id && x.status === "open")) throw new Error("Already clocked in. Clock out first.");
    if (!photoBlob) throw new Error("A photo is required to clock in.");
    const id = uid(), path = `${u.id}/${id}-in.jpg`;
    await idb.put(path, photoBlob);
    const s = { id, userId: u.id, event: (event || "").trim(), clockInAt: new Date().toISOString(), clockInPhoto: path, clockOutAt: null, clockOutPhoto: null, note: "", status: "open", approvedHours: null, adminNote: "", reviewedAt: null };
    this.state.sessions.push(s); this.save();
    return this.decorate(s);
  }
  async clockOut({ sessionId, photoBlob, note }) {
    const u = this.requireUser();
    const s = this.state.sessions.find((x) => x.id === sessionId && x.userId === u.id && x.status === "open");
    if (!s) throw new Error("No open session found.");
    if (!photoBlob) throw new Error("A photo is required to clock out.");
    const path = `${u.id}/${s.id}-out.jpg`;
    await idb.put(path, photoBlob);
    Object.assign(s, { clockOutAt: new Date().toISOString(), clockOutPhoto: path, note: (note || "").trim(), status: "pending" });
    this.save();
    return this.decorate(s);
  }

  /* progress helpers */
  totalsFor(userId) {
    const st = this.state.settings;
    let approved = 0, pending = 0, open = 0;
    for (const s of this.state.sessions) {
      if (s.userId !== userId || !inRange(s.clockInAt, st.semesterStart, st.semesterEnd)) continue;
      if (s.status === "approved") approved += Number(s.approvedHours) || 0;
      else if (s.status === "pending") pending += hoursBetween(s.clockInAt, s.clockOutAt);
      else if (s.status === "open") open++;
    }
    return { approvedHours: approved, pendingHours: pending, openSessions: open };
  }
  async myProgress() { const u = this.requireUser(); return this.totalsFor(u.id); }

  /* admin */
  async adminSignIn({ passcode }) {
    if (String(passcode || "") !== String(CFG.demoAdminPasscode || "7419")) throw new Error("Wrong passcode.");
    this.state.adminAuth = true; this.save(); this.emit();
    return { id: "demo-admin", name: "Admin (demo)", email: "", role: "admin" };
  }
  async getAdmin() { return this.state.adminAuth ? { id: "demo-admin", name: "Admin (demo)", email: "", role: "admin" } : null; }
  async adminSignOut() { this.state.adminAuth = false; this.save(); this.emit(); }
  async listSessions({ status } = {}) {
    this.requireAdmin();
    return this.state.sessions.filter((s) => !status || s.status === status).sort((a, b) => b.clockInAt.localeCompare(a.clockInAt)).map((s) => this.decorate(s));
  }
  async reviewSession(id, { status, approvedHours, adminNote }) {
    this.requireAdmin();
    const s = this.state.sessions.find((x) => x.id === id);
    if (!s) throw new Error("Session not found.");
    if (!["approved", "rejected"].includes(status)) throw new Error("Bad status.");
    Object.assign(s, { status, approvedHours: status === "approved" ? Number(approvedHours) || 0 : null, adminNote: (adminNote || "").trim(), reviewedAt: new Date().toISOString() });
    this.save();
    return this.decorate(s);
  }
  async closeSession(id, note) {
    this.requireAdmin();
    const s = this.state.sessions.find((x) => x.id === id && x.status === "open");
    if (!s) throw new Error("That session is not open.");
    Object.assign(s, { clockOutAt: new Date().toISOString(), status: "pending", adminNote: note || "Closed by an admin. The clock-out time is when it was closed." });
    this.save();
    return this.decorate(s);
  }
  async listMembers() {
    this.requireAdmin();
    return this.state.users.map((u) => ({ ...this.pub(u), ...this.totalsFor(u.id) })).sort((a, b) => a.name.localeCompare(b.name));
  }
  async setRole() { throw new Error("Admin roles need Supabase. Not available in demo mode."); }
  async setExcused(userId, excused, note) {
    this.requireAdmin();
    const u = this.state.users.find((x) => x.id === userId);
    if (!u) throw new Error("Member not found.");
    u.excused = !!excused; u.excusedNote = excused ? (note || "") : ""; this.save();
  }
  async removeMember(userId) {
    this.requireAdmin();
    if (!this.state.users.some((x) => x.id === userId)) throw new Error("Member not found.");
    this.state.users = this.state.users.filter((x) => x.id !== userId);
    this.state.sessions = this.state.sessions.filter((s) => s.userId !== userId);
    if (this.state.auth === userId) this.state.auth = null;
    this.save();
  }

  /* photos */
  async photoUrl(path) {
    if (!path) return null;
    if (this.urlCache.has(path)) return this.urlCache.get(path);
    let url;
    if (path.startsWith("sample/")) url = placeholderPhoto(path.endsWith("-in") ? "Sample clock-in photo" : "Sample clock-out photo");
    else { const blob = await idb.get(path); url = blob ? URL.createObjectURL(blob) : placeholderPhoto("Photo missing"); }
    this.urlCache.set(path, url);
    return url;
  }
  async resetDemo() { localStorage.removeItem(this.key); this.state = seedState(); this.save(); this.emit(); }
}

/* =========================================================================================
   Supabase backend
   ========================================================================================= */

const BUCKET = "clock-photos";

class SupaDb {
  constructor() { this.mode = "supabase"; this.listeners = []; this.urlCache = new Map(); this.profileCache = null; }
  async init() {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    this.sb = createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    this.sb.auth.onAuthStateChange(() => { this.profileCache = null; setTimeout(() => this.listeners.forEach((cb) => cb()), 0); });
    return this;
  }
  onAuthChange(cb) { this.listeners.push(cb); }
  fail(error, fallback) { const msg = error?.message || fallback || "Something went wrong."; throw new Error(msg.replace(/^AuthApiError:\s*/, "")); }
  norm(r) {
    if (!r) return null;
    const m = r.member || {};
    return {
      id: r.id, userId: r.user_id, userName: m.name || r.user_name || "", userEmail: m.email || r.user_email || "", userGrade: m.grade || r.user_grade || "",
      event: r.event || "", clockInAt: r.clock_in_at, clockInPhoto: r.clock_in_photo, clockOutAt: r.clock_out_at, clockOutPhoto: r.clock_out_photo,
      note: r.note || "", status: r.status, approvedHours: r.approved_hours == null ? null : Number(r.approved_hours), adminNote: r.admin_note || "", reviewedAt: r.reviewed_at,
    };
  }

  /* auth */
  async signUp({ name, email, password, grade }) {
    const { data, error } = await this.sb.auth.signUp({ email: String(email).trim().toLowerCase(), password, options: { data: { name: (name || "").trim(), grade: grade || "" } } });
    if (error) this.fail(error);
    return { user: data.user ? { id: data.user.id, name, email, grade, role: "member" } : null, needsConfirm: !data.session };
  }
  async signIn({ email, password }) {
    const { error } = await this.sb.auth.signInWithPassword({ email: String(email).trim().toLowerCase(), password });
    if (error) this.fail(error, "Wrong email or password.");
    return this.getUser();
  }
  async signOut() { this.profileCache = null; await this.sb.auth.signOut(); }
  async getUser() {
    const { data: { session } } = await this.sb.auth.getSession();
    if (!session) return null;
    if (this.profileCache?.id === session.user.id) return this.profileCache;
    const { data, error } = await this.sb.from("profiles").select("id,name,email,grade,role,excused,excused_note").eq("id", session.user.id).limit(1);
    if (error) this.fail(error);
    if (!data || !data[0]) {
      // the account was removed (or never got a profile row): treat it as signed out
      await this.sb.auth.signOut().catch(() => {});
      return null;
    }
    const meta = session.user.user_metadata || {};
    const row = data[0];
    this.profileCache = { id: row.id, name: row.name, email: row.email, grade: row.grade, role: row.role, excused: !!row.excused, excusedNote: row.excused_note || "" } || { id: session.user.id, name: meta.name || "", email: session.user.email, grade: meta.grade || "", role: "member" };
    return this.profileCache;
  }

  /* settings */
  async getSettings() {
    const { data, error } = await this.sb.from("settings").select("*").eq("id", 1).limit(1);
    if (error) this.fail(error);
    const r = data && data[0];
    if (!r) { const y = new Date().getFullYear(); return { semesterName: "This semester", semesterStart: `${y}-01-01`, semesterEnd: `${y}-12-31`, requiredHours: 9, verificationObject: GENERIC_OBJECT }; }
    return { semesterName: r.semester_name, semesterStart: r.semester_start, semesterEnd: r.semester_end, requiredHours: Number(r.required_hours), verificationObject: r.verification_object };
  }
  async updateSettings(p) {
    const row = {};
    if (p.semesterName != null) row.semester_name = p.semesterName;
    if (p.semesterStart != null) row.semester_start = p.semesterStart;
    if (p.semesterEnd != null) row.semester_end = p.semesterEnd;
    if (p.requiredHours != null) row.required_hours = p.requiredHours;
    if (p.verificationObject != null) row.verification_object = p.verificationObject;
    row.updated_at = new Date().toISOString();
    const { error } = await this.sb.from("settings").update(row).eq("id", 1);
    if (error) this.fail(error);
    return this.getSettings();
  }

  /* member sessions */
  async listMySessions() {
    const u = await this.getUser(); if (!u) throw new Error("Signed out. Sign in again.");
    const { data, error } = await this.sb.from("sessions").select("*").eq("user_id", u.id).order("clock_in_at", { ascending: false });
    if (error) this.fail(error);
    return data.map((r) => this.norm({ ...r, member: u }));
  }
  async getOpenSession() {
    const u = await this.getUser(); if (!u) throw new Error("Signed out. Sign in again.");
    const { data, error } = await this.sb.from("sessions").select("*").eq("user_id", u.id).eq("status", "open").order("clock_in_at", { ascending: false }).limit(1);
    if (error) this.fail(error);
    return data && data[0] ? this.norm({ ...data[0], member: u }) : null;
  }
  async upload(path, blob) {
    const { error } = await this.sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: true });
    if (error) this.fail(error, "Photo upload failed. Check your connection and try again.");
  }
  async clockIn({ event, photoBlob }) {
    const u = await this.getUser(); if (!u) throw new Error("Signed out. Sign in again.");
    if (!photoBlob) throw new Error("A photo is required to clock in.");
    const path = `${u.id}/${Date.now()}-in.jpg`;
    await this.upload(path, photoBlob);
    const { data, error } = await this.sb.rpc("clock_in", { p_event: (event || "").trim(), p_photo: path });
    if (error) this.fail(error);
    return this.norm({ ...data, member: u });
  }
  async clockOut({ sessionId, photoBlob, note }) {
    const u = await this.getUser(); if (!u) throw new Error("Signed out. Sign in again.");
    if (!photoBlob) throw new Error("A photo is required to clock out.");
    const path = `${u.id}/${sessionId}-out.jpg`;
    await this.upload(path, photoBlob);
    const { data, error } = await this.sb.rpc("clock_out", { p_session: sessionId, p_photo: path, p_note: (note || "").trim() });
    if (error) this.fail(error);
    return this.norm({ ...data, member: u });
  }
  async myProgress() {
    const u = await this.getUser(); if (!u) throw new Error("Signed out. Sign in again.");
    const { data, error } = await this.sb.from("member_progress").select("approved_hours,pending_hours,open_sessions").eq("id", u.id).limit(1);
    if (error) this.fail(error);
    const r = (data && data[0]) || {};
    return { approvedHours: Number(r.approved_hours || 0), pendingHours: Number(r.pending_hours || 0), openSessions: Number(r.open_sessions || 0) };
  }

  /* admin */
  async adminSignIn({ email, password }) {
    await this.signIn({ email, password });
    const u = await this.getUser();
    if (u?.role !== "admin") { await this.signOut(); throw new Error("This account does not have admin access."); }
    return u;
  }
  async getAdmin() { const u = await this.getUser(); return u?.role === "admin" ? u : null; }
  async adminSignOut() { return this.signOut(); }
  async listSessions({ status } = {}) {
    let q = this.sb.from("sessions").select("*, member:profiles!sessions_user_id_fkey(name,email,grade)").order("clock_in_at", { ascending: false });
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) this.fail(error);
    return data.map((r) => this.norm(r));
  }
  async reviewSession(id, { status, approvedHours, adminNote }) {
    const { data, error } = await this.sb.rpc("review_session", { p_session: id, p_status: status, p_hours: status === "approved" ? Number(approvedHours) || 0 : null, p_note: (adminNote || "").trim() });
    if (error) this.fail(error);
    return this.norm(data);
  }
  async closeSession(id, note) {
    const { data, error } = await this.sb.rpc("close_session", { p_session: id, p_note: note || "Closed by an admin. The clock-out time is when it was closed." });
    if (error) this.fail(error);
    return this.norm(data);
  }
  async listMembers() {
    const { data, error } = await this.sb.from("member_progress").select("*").order("name");
    if (error) this.fail(error);
    return data.map((r) => ({ id: r.id, name: r.name, email: r.email, grade: r.grade || "", role: r.role, excused: !!r.excused, excusedNote: r.excused_note || "", approvedHours: Number(r.approved_hours || 0), pendingHours: Number(r.pending_hours || 0), openSessions: Number(r.open_sessions || 0) }));
  }
  async setRole(userId, role) {
    const { error } = await this.sb.from("profiles").update({ role }).eq("id", userId);
    if (error) this.fail(error);
  }
  async setExcused(userId, excused, note) {
    const { error } = await this.sb.from("profiles").update({ excused: !!excused, excused_note: excused ? (note || null) : null }).eq("id", userId);
    if (error) this.fail(error);
  }
  async removeMember(userId) {
    const { error } = await this.sb.rpc("remove_member", { p_user: userId });
    if (error) this.fail(error);
    // account is gone; now clear their photos through the Storage API (best effort)
    try {
      const { data: files } = await this.sb.storage.from(BUCKET).list(userId, { limit: 1000 });
      const paths = (files || []).map((f) => `${userId}/${f.name}`);
      if (paths.length) await this.sb.storage.from(BUCKET).remove(paths);
    } catch (_) { /* photos left behind are harmless; the account and sessions are already removed */ }
  }

  /* photos: private bucket, signed URLs cached for the page's life */
  async photoUrl(path) {
    if (!path) return null;
    const hit = this.urlCache.get(path);
    if (hit && hit.exp > Date.now()) return hit.url;
    const { data, error } = await this.sb.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
    if (error) return null;
    this.urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 55 * 60 * 1000 });
    return data.signedUrl;
  }
}

export const db = HAS_SUPABASE ? new SupaDb() : new DemoDb();
export const ready = db.init();
