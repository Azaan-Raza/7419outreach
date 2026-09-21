/**
 * Outreach Tracker — Excel script (Office Scripts, for Excel on the web and Microsoft 365 desktop).
 *
 * Install: open OutreachHours.xlsx → Automate tab → New Script → replace everything with this file → Save as "Outreach tracker".
 * Then on the Sign up and Log hours sheets: Automate → pick the script → "Add button" so members can tap it.
 *
 * One script, one button. It does whatever is filled in:
 *   • Sign up sheet has a name and email  → adds that member to Members and clears the form
 *   • Log hours sheet has an email        → adds the shift to Sessions as "Waiting" and clears the form
 *   • Always                              → writes a "Last updated" line on the Dashboard
 * Leads approve straight on the Sessions sheet by setting Status to Approved (and Approved hours if they want to override).
 */
function main(workbook: ExcelScript.Workbook) {
  const signup = workbook.getWorksheet("Sign up");
  const log = workbook.getWorksheet("Log hours");
  const members = workbook.getWorksheet("Members");
  const sessions = workbook.getWorksheet("Sessions");
  const dash = workbook.getWorksheet("Dashboard");
  if (!signup || !log || !members || !sessions) throw new Error("This script expects the OutreachHours.xlsx sheets: Sign up, Log hours, Members, Sessions.");

  const done: string[] = [];
  const knownEmails = columnText(members, "B").map((e) => e.toLowerCase());

  // ---- Sign up ------------------------------------------------------------
  const name = text(signup.getRange("B4").getValue());
  const email = text(signup.getRange("B5").getValue()).toLowerCase();
  const grade = text(signup.getRange("B6").getValue());
  if (name || email) {
    if (!name) throw new Error("Sign up: add your name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Sign up: that email doesn't look right.");
    if (knownEmails.includes(email)) throw new Error(`Sign up: ${email} is already on the Members sheet.`);
    const row = firstEmptyRow(members, "B");
    members.getRange(`A${row}:D${row}`).setValues([[name, email, grade, excelSerial(new Date())]]);
    members.getRange(`D${row}`).setNumberFormat("mmm d, yyyy");
    signup.getRange("B4:B6").clear(ExcelScript.ClearApplyTo.contents);
    knownEmails.push(email);
    done.push(`Signed up ${name}.`);
  }

  // ---- Log hours ----------------------------------------------------------
  const lEmail = text(log.getRange("B4").getValue()).toLowerCase();
  if (lEmail) {
    if (!knownEmails.includes(lEmail)) throw new Error(`Log hours: ${lEmail} isn't signed up yet. Do the Sign up sheet first.`);
    const dateVal = log.getRange("B5").getValue();
    const event = text(log.getRange("B6").getValue());
    const tIn = toDayFraction(log.getRange("B7").getValue());
    const tOut = toDayFraction(log.getRange("B8").getValue());
    const photoIn = text(log.getRange("B9").getValue());
    const photoOut = text(log.getRange("B10").getValue());
    if (tIn === null || tOut === null) throw new Error("Log hours: clock in and clock out both need a time, like 3:42 PM.");
    const dateSerial = typeof dateVal === "number" && dateVal > 0 ? Math.floor(dateVal) : excelSerial(new Date());

    const row = firstEmptyRow(sessions, "B");
    sessions.getRange(`A${row}:E${row}`).setValues([[dateSerial, lEmail, event, tIn, tOut]]);
    sessions.getRange(`G${row}`).setValue("Waiting");
    sessions.getRange(`K${row}:L${row}`).setValues([[photoIn, photoOut]]);
    sessions.getRange(`A${row}`).setNumberFormat("mmm d, yyyy");
    sessions.getRange(`D${row}:E${row}`).setNumberFormat("h:mm AM/PM");
    log.getRange("B4:B10").clear(ExcelScript.ClearApplyTo.contents);
    const hrs = Math.round((((tOut - tIn) % 1 + 1) % 1) * 24 * 100) / 100;
    done.push(`Logged ${hrs} h for ${lEmail} (${event || "outreach"}). It's waiting on a lead.`);
  }

  // ---- Stamp the dashboard ------------------------------------------------
  if (dash) {
    dash.getRange("A3").setValue(`Last updated ${new Date().toLocaleString()}${done.length ? " · " + done.join(" ") : ""}`);
  }
  console.log(done.length ? done.join("\n") : "Nothing to add. Fill in the Sign up or Log hours sheet first.");
}

/* ---------------- helpers ---------------- */
function text(v: string | number | boolean): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

function columnText(ws: ExcelScript.Worksheet, col: string): string[] {
  const used = ws.getUsedRange(true);
  if (!used) return [];
  const last = used.getLastRow().getRowIndex() + 1;
  if (last < 2) return [];
  return ws.getRange(`${col}2:${col}${last}`).getValues().map((r) => text(r[0])).filter((s) => s.length > 0);
}

function firstEmptyRow(ws: ExcelScript.Worksheet, col: string): number {
  const vals = ws.getRange(`${col}2:${col}3000`).getValues();
  for (let i = 0; i < vals.length; i++) if (text(vals[i][0]) === "") return i + 2;
  throw new Error(`${ws.getName()} is full.`);
}

/** Excel stores dates as days since 1899-12-30. */
function excelSerial(d: Date): number {
  return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000;
}

/** Accepts a real Excel time (fraction of a day) or typed text like "3:42 PM" / "15:42". */
function toDayFraction(v: string | number | boolean): number | null {
  if (typeof v === "number") return v % 1;
  const s = text(v).toUpperCase();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  if (m[3] === "PM" && h < 12) h += 12;
  if (m[3] === "AM" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return (h * 60 + min) / 1440;
}
