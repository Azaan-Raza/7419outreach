Attribute VB_Name = "OutreachTracker"
Option Explicit
' 7419 Outreach Tracker — macros for desktop Excel (Windows and Mac).
' Import: Developer tab → Visual Basic → File → Import File… → OutreachTracker.bas. Save the workbook as .xlsm.
' Run with Alt+F8 (Windows) or Tools → Macro → Macros… (Mac), or attach RunForms to a button.
'
'   SignUp            asks for name / email / grade and adds the member
'   LogSession        asks for one shift and adds it to Sessions as "Waiting"
'   RunForms          reads the Sign up and Log hours sheets, same as the Office Script
'   ApproveSelected   on the Sessions sheet, approves the selected rows (asks for hours, defaults to hours on clock)
'   SendBackSelected  on the Sessions sheet, marks the selected rows "Sent back" with a note
'   ShowProgress      asks for an email and shows approved hours against the requirement

Private Const SH_MEMBERS As String = "Members"
Private Const SH_SESSIONS As String = "Sessions"
Private Const SH_SIGNUP As String = "Sign up"
Private Const SH_LOG As String = "Log hours"

Public Sub SignUp()
    Dim nm As String, em As String, gr As String
    nm = Trim(InputBox("Your name (first and last):", "Sign up"))
    If nm = "" Then Exit Sub
    em = LCase(Trim(InputBox("Your school email:", "Sign up")))
    If em = "" Then Exit Sub
    gr = Trim(InputBox("Grade (9-12):", "Sign up"))
    AddMember nm, em, gr
End Sub

Public Sub LogSession()
    Dim em As String, ev As String, d As Variant, tIn As Variant, tOut As Variant, p1 As String, p2 As String
    em = LCase(Trim(InputBox("Your email:", "Log hours")))
    If em = "" Then Exit Sub
    If FindMemberRow(em) = 0 Then
        MsgBox em & " isn't signed up yet. Run SignUp first.", vbExclamation, "Log hours"
        Exit Sub
    End If
    d = InputBox("Date (leave blank for today):", "Log hours", Format(Date, "mmm d, yyyy"))
    If StrPtr(d) = 0 Then Exit Sub
    If Trim(d) = "" Then d = Date Else d = CDate(d)
    ev = Trim(InputBox("What event was it?", "Log hours"))
    tIn = InputBox("Clock in (like 3:42 PM):", "Log hours")
    If StrPtr(tIn) = 0 Or Not IsDate(tIn) Then MsgBox "That time didn't parse. Try 3:42 PM.", vbExclamation: Exit Sub
    tOut = InputBox("Clock out (like 5:10 PM):", "Log hours")
    If StrPtr(tOut) = 0 Or Not IsDate(tOut) Then MsgBox "That time didn't parse. Try 5:10 PM.", vbExclamation: Exit Sub
    p1 = Trim(InputBox("Link to the clock-in photo (optional):", "Log hours"))
    p2 = Trim(InputBox("Link to the clock-out photo (optional):", "Log hours"))
    AddSession CDate(d), em, ev, TimeValue(CDate(tIn)), TimeValue(CDate(tOut)), p1, p2
End Sub

Public Sub RunForms()
    Dim su As Worksheet, lg As Worksheet, msg As String
    Set su = ThisWorkbook.Worksheets(SH_SIGNUP)
    Set lg = ThisWorkbook.Worksheets(SH_LOG)

    If Trim(su.Range("B4").Value & "") <> "" Or Trim(su.Range("B5").Value & "") <> "" Then
        If AddMember(Trim(su.Range("B4").Value), LCase(Trim(su.Range("B5").Value)), Trim(su.Range("B6").Value & "")) Then
            su.Range("B4:B6").ClearContents
            msg = msg & "Signed up " & Trim(su.Range("B4").Value) & ". "
        End If
    End If

    If Trim(lg.Range("B4").Value & "") <> "" Then
        If Not IsDate(lg.Range("B7").Value) Or Not IsDate(lg.Range("B8").Value) Then
            MsgBox "Clock in and clock out both need a time, like 3:42 PM.", vbExclamation, "Log hours"
            Exit Sub
        End If
        Dim d As Date
        If IsDate(lg.Range("B5").Value) Then d = CDate(lg.Range("B5").Value) Else d = Date
        If AddSession(d, LCase(Trim(lg.Range("B4").Value)), Trim(lg.Range("B6").Value & ""), TimeValue(CDate(lg.Range("B7").Value)), TimeValue(CDate(lg.Range("B8").Value)), Trim(lg.Range("B9").Value & ""), Trim(lg.Range("B10").Value & "")) Then
            lg.Range("B4:B10").ClearContents
            msg = msg & "Logged the shift. It's waiting on a lead."
        End If
    End If

    If msg = "" Then msg = "Nothing to add. Fill in the Sign up or Log hours sheet first."
    MsgBox msg, vbInformation, "Outreach tracker"
End Sub

Public Sub ApproveSelected()
    Dim ws As Worksheet, r As Range, hrs As Variant, note As String
    Set ws = ThisWorkbook.Worksheets(SH_SESSIONS)
    If ActiveSheet.Name <> SH_SESSIONS Then MsgBox "Select rows on the Sessions sheet first.", vbExclamation: Exit Sub
    For Each r In Selection.Rows
        If r.Row > 1 And Trim(ws.Cells(r.Row, 2).Value & "") <> "" Then
            hrs = InputBox("Hours to approve for " & ws.Cells(r.Row, 2).Value & " on " & Format(ws.Cells(r.Row, 1).Value, "mmm d") & ":", "Approve", Format(ws.Cells(r.Row, 6).Value, "0.00"))
            If StrPtr(hrs) = 0 Then Exit Sub
            note = InputBox("Note to the member (optional):", "Approve", ws.Cells(r.Row, 10).Value & "")
            ws.Cells(r.Row, 7).Value = "Approved"
            If IsNumeric(hrs) Then ws.Cells(r.Row, 8).Value = CDbl(hrs)
            ws.Cells(r.Row, 10).Value = note
        End If
    Next r
End Sub

Public Sub SendBackSelected()
    Dim ws As Worksheet, r As Range, note As String
    Set ws = ThisWorkbook.Worksheets(SH_SESSIONS)
    If ActiveSheet.Name <> SH_SESSIONS Then MsgBox "Select rows on the Sessions sheet first.", vbExclamation: Exit Sub
    note = Trim(InputBox("Why is it going back? The member sees this.", "Send back"))
    If note = "" Then MsgBox "Add a short note so they know what to fix.", vbExclamation: Exit Sub
    For Each r In Selection.Rows
        If r.Row > 1 And Trim(ws.Cells(r.Row, 2).Value & "") <> "" Then
            ws.Cells(r.Row, 7).Value = "Sent back"
            ws.Cells(r.Row, 8).ClearContents
            ws.Cells(r.Row, 10).Value = note
        End If
    Next r
End Sub

Public Sub ShowProgress()
    Dim em As String, rw As Long, ws As Worksheet, approved As Double, waiting As Double, req As Double, bar As String, n As Long
    em = LCase(Trim(InputBox("Whose progress? Enter an email:", "Progress")))
    If em = "" Then Exit Sub
    rw = FindMemberRow(em)
    If rw = 0 Then MsgBox em & " isn't on the Members sheet.", vbExclamation: Exit Sub
    Set ws = ThisWorkbook.Worksheets(SH_MEMBERS)
    approved = Val(ws.Cells(rw, 5).Value)
    waiting = Val(ws.Cells(rw, 6).Value)
    req = Val(ThisWorkbook.Names("RequiredHours").RefersToRange.Value)
    n = Round(Application.Min(1, approved / IIf(req = 0, 1, req)) * 20, 0)
    bar = String(n, ChrW(9608)) & String(20 - n, ChrW(9617))
    MsgBox ws.Cells(rw, 1).Value & vbCrLf & vbCrLf & bar & vbCrLf & _
           Format(approved, "0.00") & " of " & Format(req, "0.##") & " hours approved" & vbCrLf & _
           IIf(waiting > 0, Format(waiting, "0.00") & " waiting on review" & vbCrLf, "") & _
           IIf(approved >= req, "Done for the semester.", Format(req - approved, "0.00") & " to go."), vbInformation, "Progress"
End Sub

' ---------------------------------------------------------------- helpers
Private Function AddMember(nm As String, em As String, gr As String) As Boolean
    Dim ws As Worksheet, rw As Long
    Set ws = ThisWorkbook.Worksheets(SH_MEMBERS)
    If nm = "" Or InStr(em, "@") = 0 Then MsgBox "Sign up needs a name and a real email.", vbExclamation, "Sign up": Exit Function
    If FindMemberRow(em) > 0 Then MsgBox em & " is already signed up.", vbExclamation, "Sign up": Exit Function
    rw = FirstEmptyRow(ws, 2)
    ws.Cells(rw, 1).Value = nm
    ws.Cells(rw, 2).Value = em
    ws.Cells(rw, 3).Value = gr
    ws.Cells(rw, 4).Value = Date
    ws.Cells(rw, 4).NumberFormat = "mmm d, yyyy"
    AddMember = True
End Function

Private Function AddSession(d As Date, em As String, ev As String, tIn As Date, tOut As Date, p1 As String, p2 As String) As Boolean
    Dim ws As Worksheet, rw As Long
    Set ws = ThisWorkbook.Worksheets(SH_SESSIONS)
    If FindMemberRow(em) = 0 Then MsgBox em & " isn't signed up yet.", vbExclamation, "Log hours": Exit Function
    rw = FirstEmptyRow(ws, 2)
    ws.Cells(rw, 1).Value = d
    ws.Cells(rw, 1).NumberFormat = "mmm d, yyyy"
    ws.Cells(rw, 2).Value = em
    ws.Cells(rw, 3).Value = ev
    ws.Cells(rw, 4).Value = tIn
    ws.Cells(rw, 5).Value = tOut
    ws.Cells(rw, 4).NumberFormat = "h:mm AM/PM"
    ws.Cells(rw, 5).NumberFormat = "h:mm AM/PM"
    ws.Cells(rw, 7).Value = "Waiting"
    ws.Cells(rw, 11).Value = p1
    ws.Cells(rw, 12).Value = p2
    AddSession = True
End Function

Private Function FindMemberRow(em As String) As Long
    Dim ws As Worksheet, r As Long, last As Long
    Set ws = ThisWorkbook.Worksheets(SH_MEMBERS)
    last = ws.Cells(ws.Rows.Count, 2).End(xlUp).Row
    For r = 2 To last
        If LCase(Trim(ws.Cells(r, 2).Value & "")) = em Then FindMemberRow = r: Exit Function
    Next r
End Function

Private Function FirstEmptyRow(ws As Worksheet, col As Long) As Long
    Dim r As Long
    For r = 2 To 5000
        If Trim(ws.Cells(r, col).Value & "") = "" Then FirstEmptyRow = r: Exit Function
    Next r
    Err.Raise vbObjectError + 1, , ws.Name & " is full."
End Function
