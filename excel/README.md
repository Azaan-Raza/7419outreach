# Excel tracker

The spreadsheet version of the outreach tracker, for people who'd rather work in Excel or who need a copy of the numbers outside the app.

| File | What it is |
| --- | --- |
| `OutreachHours.xlsx` | The workbook. Members, Sessions, Dashboard with progress bars, Settings, and two form sheets (Sign up, Log hours). Ships with three sample members you can delete. |
| `OutreachTracker.ts` | Office Script for Excel on the web / Microsoft 365. One button that signs people up and logs hours from the form sheets. |
| `OutreachTracker.bas` | VBA macros for desktop Excel. Same jobs, plus ApproveSelected / SendBackSelected / ShowProgress. |
| `build_workbook.py` | Rebuilds the .xlsx from scratch (`python3 excel/build_workbook.py`, needs `openpyxl`). |

## How the sheets work

- **Settings** holds the semester name, start and end dates, the hours each member needs (9), and what has to be in every photo. Only sessions between the two dates count.
- **Members** is the roster. Approved hours, hours waiting on review, a progress bar (data bar), Done / In progress, and hours to go are all formulas.
- **Sessions** is one row per shift: date, member email, event, clock in, clock out, hours on clock (formula), status, approved hours (leave blank to use hours on clock), lead note, and links to the two photos. Status is a dropdown: Waiting, Approved, Sent back.
- **Dashboard** has the totals and a text progress bar per member.
- **Sign up** and **Log hours** are the forms the scripts read.

## Office Script (Excel on the web, Microsoft 365)

1. Open `OutreachHours.xlsx` in Excel on the web or a Microsoft 365 desktop build with the Automate tab.
2. Automate → New Script → replace the contents with `OutreachTracker.ts` → Save as "Outreach tracker".
3. On the Sign up sheet: Automate → open the script → **Add button**. Do the same on Log hours.
4. Members fill in the boxes and tap the button. Sign-ups land on Members, shifts land on Sessions as Waiting, and the form clears.

## VBA (desktop Excel)

1. Developer tab → Visual Basic → File → Import File… → `OutreachTracker.bas`.
2. Save the workbook as `.xlsm`.
3. Alt+F8 (Windows) or Tools → Macro → Macros (Mac) and pick one: `SignUp`, `LogSession`, `RunForms`, `ApproveSelected`, `SendBackSelected`, `ShowProgress`. You can attach `RunForms` to a shape on the form sheets.

## Bringing in data from the app

On admin.html, the Members tab has **Download all sessions (.csv)**. Its columns match the Sessions sheet (date, email, event, clock in, clock out, hours on clock, status, approved hours, lead note), so you can paste the rows in under the header.
