#!/usr/bin/env node
// Run a SQL statement against the project from the terminal (uses the same token lookup as setup.mjs).
//   SUPABASE_ACCESS_TOKEN=sbp_... node supabase/sql.mjs "select count(*) from profiles"
//   echo "select 1" | node supabase/sql.mjs
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim() || (existsSync(resolve(homedir(), ".supabase/access-token")) ? readFileSync(resolve(homedir(), ".supabase/access-token"), "utf8").trim() : null);
if (!token) { console.error("No SUPABASE_ACCESS_TOKEN."); process.exit(1); }
const cfg = readFileSync(resolve(here, "../config.js"), "utf8");
const ref = process.env.SUPABASE_PROJECT_REF || (cfg.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
const query = process.argv[2] || readFileSync(0, "utf8");
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }),
});
const text = await res.text();
if (!res.ok) { console.error(`HTTP ${res.status}: ${text}`); process.exit(1); }
console.log(text);
