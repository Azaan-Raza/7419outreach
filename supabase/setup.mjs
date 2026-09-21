#!/usr/bin/env node
// One-shot Supabase setup for Outreach Tracker.
//
//   node supabase/setup.mjs                 runs schema.sql on the project, fetches the anon key, writes config.js
//   node supabase/setup.mjs --auto-confirm  also turns off "Confirm email" so members can sign in right after signing up
//   node supabase/setup.mjs --schema-only   only runs schema.sql
//
// Needs a personal access token from https://supabase.com/dashboard/account/tokens, given as either
//   SUPABASE_ACCESS_TOKEN=sbp_... node supabase/setup.mjs
// or saved in ~/.supabase/access-token (that's where `supabase login` puts it).
// The project ref comes from supabaseUrl in config.js (or SUPABASE_PROJECT_REF).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const args = new Set(process.argv.slice(2));
const API = "https://api.supabase.com";

function readToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  const f = resolve(homedir(), ".supabase/access-token");
  if (existsSync(f)) return readFileSync(f, "utf8").trim();
  return null;
}

function readConfig() {
  const src = readFileSync(resolve(root, "config.js"), "utf8");
  const url = (src.match(/supabaseUrl:\s*"([^"]*)"/) || [])[1] || "";
  return { src, url };
}

async function api(token, method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

const token = readToken();
if (!token) {
  console.error("No access token found.\nMake one at https://supabase.com/dashboard/account/tokens and run:\n  SUPABASE_ACCESS_TOKEN=sbp_xxx node supabase/setup.mjs");
  process.exit(1);
}

const cfg = readConfig();
const ref = process.env.SUPABASE_PROJECT_REF || (cfg.url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
if (!ref) { console.error("Couldn't work out the project ref. Set supabaseUrl in config.js or SUPABASE_PROJECT_REF."); process.exit(1); }

console.log(`Project ${ref}`);

// 1. schema
const sql = readFileSync(resolve(here, "schema.sql"), "utf8");
process.stdout.write("Running schema.sql… ");
await api(token, "POST", `/v1/projects/${ref}/database/query`, { query: sql });
console.log("done.");

if (args.has("--schema-only")) process.exit(0);

// 2. anon key → config.js
process.stdout.write("Fetching the anon key… ");
const keys = await api(token, "GET", `/v1/projects/${ref}/api-keys?reveal=true`);
const pick = keys.find((k) => k.name === "anon") || keys.find((k) => k.type === "publishable") || keys.find((k) => /publishable/.test(k.api_key || ""));
if (!pick) throw new Error("No anon/publishable key came back: " + JSON.stringify(keys.map((k) => k.name)));
const url = `https://${ref}.supabase.co`;
let out = cfg.src.replace(/supabaseUrl:\s*"[^"]*"/, `supabaseUrl: "${url}"`).replace(/supabaseAnonKey:\s*"[^"]*"/, `supabaseAnonKey: "${pick.api_key}"`);
writeFileSync(resolve(root, "config.js"), out);
console.log(`written to config.js (${pick.name}).`);

// 3. optional: auto-confirm emails
if (args.has("--auto-confirm")) {
  process.stdout.write("Turning off email confirmation… ");
  await api(token, "PATCH", `/v1/projects/${ref}/config/auth`, { mailer_autoconfirm: true });
  console.log("done.");
}

const auth = await api(token, "GET", `/v1/projects/${ref}/config/auth`).catch(() => null);
if (auth) console.log(`Email confirmation is ${auth.mailer_autoconfirm ? "off (members sign in right away)" : "on (members must click the link in their email first)"}.`);
console.log("\nAll set. Open the app, sign up: the first account becomes a lead.");
