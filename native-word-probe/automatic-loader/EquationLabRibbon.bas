Attribute VB_Name = "EquationLabRibbon"
Option Explicit

' Compiled by the developer. Installed as a global Startup template by PKG.
Public Sub ELRibbonAction(ByVal control As IRibbonControl)
    On Error GoTo Failed
    Select Case control.Tag
        Case "open-pane": NativeTool "Open"
        Case "insert-inline": InsertEquation "Inline"
        Case "insert-display": InsertEquation "Display"
        Case "insert-right": InsertEquation "Right"
        Case "insert-left": InsertEquation "Left"
        Case "edit-selected": EditEquation
        Case "symbols": InsertSymbol
        Case "insert-number": InsertNumber
        Case "insert-reference": InsertReference
        Case "update-fields": UpdateNumbers
        Case "number-format": SetNumberFormat
        Case "chapter-section": SetChapter
        Case "previous-equation": NavigateEquation False
        Case "next-equation": NavigateEquation True
        Case "typography": EditEquation: NativeTool "Typography"
        Case "spacing": EditEquation: NativeTool "Spacing"
        Case "document-equations": BrowseEquations
        Case "conversion-export": EditEquation: NativeTool "Export"
        Case "help": NativeTool "Help"
        Case "capabilities": NativeTool "Capabilities"
        Case Else: Err.Raise vbObjectError + 7340, "Equation Lab", "Unknown command."
    End Select
    Exit Sub
Failed:
    MsgBox "Equation Lab: " & Err.Description, vbExclamation, "Equation Lab"
End Sub

Private Sub NativeTool(ByVal suffix As String)
    Dim result As Long
    result = EquationLabNativeCommand("MathTypeBridgeRibbon" & suffix)
    If result <> 0 Then Err.Raise vbObjectError + 7341, "Equation Lab", "The Equation Lab Word component is not ready (" & CStr(result) & ")."
End Sub

Private Sub RequireDocument()
    If Documents.Count = 0 Then Err.Raise vbObjectError + 7342, "Equation Lab", "Please open a Word document."
    If ActiveDocument.ReadOnly Then Err.Raise vbObjectError + 7343, "Equation Lab", "This document is read only."
    If Selection.Range.StoryType <> wdMainTextStory Then Err.Raise vbObjectError + 7344, "Equation Lab", "This command currently supports the document body."
End Sub

Private Function WorkDirectory() As String
    Dim path As String
    path = Options.DefaultFilePath(wdStartupPath)
    If Left$(path, 1) <> "/" Then Err.Raise vbObjectError + 7345, "Equation Lab", "The Word Startup path is unavailable."
    Do While Right$(path, 1) = "/": path = Left$(path, Len(path) - 1): Loop
    WorkDirectory = path & "/.EquationLab/"
End Function

Private Function Preference(ByVal key As String, ByVal fallback As String) As String
    On Error GoTo Missing
    Preference = ActiveDocument.Variables(key).Value
    Exit Function
Missing:
    Preference = fallback
End Function

Private Sub SavePreference(ByVal key As String, ByVal value As String)
    On Error Resume Next
    ActiveDocument.Variables(key).Value = value
    If Err.Number <> 0 Then
        Err.Clear
        ActiveDocument.Variables.Add Name:=key, value:=value
    End If
    On Error GoTo 0
End Sub

Private Function NextNumber() As Long
    Dim field As Field, count As Long, code As String
    For Each field In ActiveDocument.Fields
        code = Trim$(field.Code.Text)
        If Left$(code, 15) = "SEQ EquationLab" And Not field.Result.Font.Hidden Then count = count + 1
    Next
    NextNumber = count + 1
End Function

Public Sub ELWriteUtf8(ByVal path As String, ByVal value As String)
    Dim bytes() As Byte, i As Long, used As Long, code As Long, file As Integer
    If Len(value) = 0 Then Exit Sub
    EncodeTextUtf8 value, bytes
    file = FreeFile
    Open path For Output As #file
    Close #file
    Open path For Binary Access Write As #file
    Put #file, , bytes
    Close #file
End Sub

Private Sub InsertEquation(ByVal kind As String)
    RequireDocument
    If Selection.Start <> Selection.End Then Err.Raise vbObjectError + 7346, "Equation Lab", "Please place an empty cursor where the equation should be inserted."
    Dim start As Long, original As String, target As Range, equation As InlineShape, beforeLength As Long, insertedEnd As Long
    start = Selection.Start
    Set target = Selection.Range.Duplicate
    original = target.Text
    ELWriteUtf8 WorkDirectory() & "ribbon-settings.txt", Preference("EquationLabNumberFormat", "(#E1)") & vbLf & Preference("EquationLabChapter", "1") & vbLf & Preference("EquationLabSection", "1") & vbLf & CStr(NextNumber()) & vbLf
    NativeTool kind
    If Selection.Start <> start Or Selection.End <> start Or target.Text <> original Then Err.Raise vbObjectError + 7347, "Equation Lab", "The document cursor changed; no equation was inserted."
    beforeLength = ActiveDocument.Content.End
    target.InsertFile FileName:=WorkDirectory() & "ribbon-insert.docx", ConfirmConversions:=False, Link:=False, Attachment:=False
    insertedEnd = start + ActiveDocument.Content.End - beforeLength
    For Each equation In ActiveDocument.InlineShapes
        If equation.Range.Start >= start And equation.Range.Start < insertedEnd Then
            If IsEquation(equation) Then
                equation.Range.Select
                ELCaptureEquation equation
                equation.OLEFormat.Activate
                Exit Sub
            End If
        End If
    Next
    Err.Raise vbObjectError + 7348, "Equation Lab", "The inserted equation could not be selected. Use Browse Equations to select it."
End Sub

Private Function IsEquation(ByVal equation As InlineShape) As Boolean
    On Error GoTo NotEquation
    Dim id As String
    id = equation.OLEFormat.ProgID
    IsEquation = (id = "Equation.DSMT4" Or id = "Equation.3" Or id = "DSEquations")
NotEquation:
End Function

Private Sub EditEquation()
    RequireDocument
    Dim equations As InlineShapes
    Set equations = Selection.InlineShapes
    If equations.count = 0 Then Set equations = Selection.Paragraphs(1).Range.InlineShapes
    If equations.count <> 1 Then Err.Raise vbObjectError + 7349, "Equation Lab", "Select one MathType equation, or place the cursor in its own paragraph."
    If Not IsEquation(equations(1)) Then Err.Raise vbObjectError + 7350, "Equation Lab", "The selected object is not a MathType equation."
    ELCaptureEquation equations(1)
    equations(1).OLEFormat.Activate
End Sub

Private Sub NavigateEquation(ByVal forward As Boolean)
    RequireDocument
    Dim equation As InlineShape, chosen As InlineShape, position As Long
    position = Selection.Start
    For Each equation In ActiveDocument.InlineShapes
        If IsEquation(equation) Then
            If forward Then
                If equation.Range.Start > position Then
                    If chosen Is Nothing Then Set chosen = equation
                    If equation.Range.Start < chosen.Range.Start Then Set chosen = equation
                End If
            Else
                If equation.Range.Start < position Then
                    If chosen Is Nothing Then Set chosen = equation
                    If equation.Range.Start > chosen.Range.Start Then Set chosen = equation
                End If
            End If
        End If
    Next
    If Not chosen Is Nothing Then chosen.Range.Select
End Sub

Private Sub BrowseEquations()
    RequireDocument
    Dim equation As InlineShape, list As String, count As Long, answer As String, index As Long
    For Each equation In ActiveDocument.InlineShapes
        If IsEquation(equation) Then count = count + 1: list = list & CStr(count) & ".  Position " & CStr(equation.Range.Start) & vbCrLf
    Next
    If count = 0 Then MsgBox "No MathType equations were found in the document body.", vbInformation, "Equation Lab": Exit Sub
    answer = InputBox(list & vbCrLf & "Enter the equation number to select.", "Equation Lab", "1")
    If answer = "" Then Exit Sub
    If Not IsNumeric(answer) Then Exit Sub
    If CDbl(answer) <> Fix(CDbl(answer)) Or CDbl(answer) < 1 Or CDbl(answer) > count Then Exit Sub
    For Each equation In ActiveDocument.InlineShapes
        If IsEquation(equation) Then
            index = index + 1
            If index = CLng(answer) Then equation.Range.Select: Exit Sub
        End If
    Next
End Sub

Private Sub InsertSymbol()
    RequireDocument
    If Selection.Start <> Selection.End Then Err.Raise vbObjectError + 7351, "Equation Lab", "Place an empty cursor before inserting a symbol."
    Dim text As String
    text = InputBox("Enter a mathematical symbol or Unicode text.", "Equation Lab", ChrW(&H3B1))
    If text <> "" Then Selection.TypeText text
End Sub

Private Sub InsertNumber()
    RequireDocument
    If Selection.Start <> Selection.End Then Err.Raise vbObjectError + 7352, "Equation Lab", "Place an empty cursor before inserting a number."
    ELWriteUtf8 WorkDirectory() & "ribbon-settings.txt", Preference("EquationLabNumberFormat", "(#E1)") & vbLf & Preference("EquationLabChapter", "1") & vbLf & Preference("EquationLabSection", "1") & vbLf & CStr(NextNumber()) & vbLf
    InsertPreparedFragment "Number"
End Sub

Private Sub InsertPreparedFragment(ByVal tool As String)
    Dim start As Long, beforeLength As Long, target As Range
    start = Selection.Start
    Set target = Selection.Range.Duplicate
    beforeLength = ActiveDocument.Content.End
    NativeTool tool
    If Selection.Start <> start Or Selection.End <> start Then Err.Raise vbObjectError + 7357, "Equation Lab", "The cursor changed; nothing was inserted."
    target.InsertFile FileName:=WorkDirectory() & "ribbon-insert.docx", ConfirmConversions:=False, Link:=False, Attachment:=False
    Selection.SetRange start + ActiveDocument.Content.End - beforeLength, start + ActiveDocument.Content.End - beforeLength
    UpdateNumbers
End Sub

Private Sub InsertReference()
    RequireDocument
    If Selection.Start <> Selection.End Then Err.Raise vbObjectError + 7353, "Equation Lab", "Place an empty cursor before inserting a reference."
    Dim bookmark As Bookmark, list As String, answer As String, field As Field, names As Collection, index As Long
    Set names = New Collection
    For Each bookmark In ActiveDocument.Bookmarks
        If Left$(bookmark.Name, 3) = "EL_" Then
            names.Add bookmark.Name
            list = list & CStr(names.Count) & ".  " & bookmark.Range.Text & vbCrLf
        End If
    Next
    If list = "" Then MsgBox "No Equation Lab numbers are available for reference.", vbInformation, "Equation Lab": Exit Sub
    answer = InputBox(list & vbCrLf & "Enter the number of the reference target.", "Equation Lab", "1")
    If answer = "" Then Exit Sub
    If Not IsNumeric(answer) Then Exit Sub
    If CDbl(answer) <> Fix(CDbl(answer)) Or CDbl(answer) < 1 Or CDbl(answer) > names.Count Then Exit Sub
    answer = names(CLng(answer))
    If Not ActiveDocument.Bookmarks.Exists(answer) Then Err.Raise vbObjectError + 7354, "Equation Lab", "The Equation Lab reference target is unavailable."
    Set field = ActiveDocument.Fields.Add(Range:=Selection.Range, Type:=wdFieldRef, Text:=answer & " \h", PreserveFormatting:=True)
    field.Update
End Sub

Private Sub UpdateNumbers()
    RequireDocument
    Dim field As Field, code As String
    For Each field In ActiveDocument.Fields
        code = Trim$(field.Code.Text)
        If Left$(code, 15) = "SEQ EquationLab" Or Left$(code, 13) = "SEQ ELChapter" Or Left$(code, 13) = "SEQ ELSection" Then field.Update
    Next
    For Each field In ActiveDocument.Fields
        If Left$(Trim$(field.Code.Text), 7) = "REF EL_" Then field.Update
    Next
End Sub

Private Sub SetNumberFormat()
    RequireDocument
    Dim value As String
    value = InputBox("Format for new numbered equations. Example: (#C1.#E1)", "Equation Lab", Preference("EquationLabNumberFormat", "(#E1)"))
    If value = "" Then Exit Sub
    If Len(value) > 128 Or InStr(value, vbLf) > 0 Or InStr(value, vbCr) > 0 Then Err.Raise vbObjectError + 7355, "Equation Lab", "Invalid number format."
    SavePreference "EquationLabNumberFormat", value
End Sub

Private Sub SetChapter()
    RequireDocument
    Dim chapter As String, section As String
    If Selection.Start <> Selection.End Then Err.Raise vbObjectError + 7356, "Equation Lab", "Place an empty cursor before setting chapter and section."
    chapter = InputBox("Chapter number (1-32767)", "Equation Lab", Preference("EquationLabChapter", "1"))
    If chapter = "" Then Exit Sub
    section = InputBox("Section number (1-32767)", "Equation Lab", Preference("EquationLabSection", "1"))
    If section = "" Then Exit Sub
    If Not IsNumeric(chapter) Or Not IsNumeric(section) Then Exit Sub
    If CDbl(chapter) < 1 Or CDbl(chapter) > 32767 Or CDbl(chapter) <> Fix(CDbl(chapter)) Or CDbl(section) < 1 Or CDbl(section) > 32767 Or CDbl(section) <> Fix(CDbl(section)) Then Exit Sub
    SavePreference "EquationLabChapter", CStr(CLng(chapter))
    SavePreference "EquationLabSection", CStr(CLng(section))
    ELWriteUtf8 WorkDirectory() & "ribbon-settings.txt", Preference("EquationLabNumberFormat", "(#E1)") & vbLf & CStr(CLng(chapter)) & vbLf & CStr(CLng(section)) & vbLf & CStr(NextNumber()) & vbLf
    InsertPreparedFragment "Chapter"
End Sub

Private Sub EncodeTextUtf8(ByVal value As String, ByRef bytes() As Byte)
    Dim i As Long
    Dim used As Long
    Dim code As Long
    Dim following As Long
    ReDim bytes(0 To Len(value) * 3)
    i = 1
    Do While i <= Len(value)
        code = AscW(Mid$(value, i, 1)) And &HFFFF&
        If code = 0 Then Err.Raise vbObjectError + 7308, "Equation Lab", "Native string contains NUL."
        If code >= &HD800& And code <= &HDBFF& Then
            If i = Len(value) Then Err.Raise vbObjectError + 7308, "Equation Lab", "Invalid UTF-16 path."
            following = AscW(Mid$(value, i + 1, 1)) And &HFFFF&
            If following < &HDC00& Or following > &HDFFF& Then Err.Raise vbObjectError + 7308, "Equation Lab", "Invalid UTF-16 path."
            code = &H10000 + (code - &HD800&) * 1024 + following - &HDC00&
            i = i + 1
        ElseIf code >= &HDC00& And code <= &HDFFF& Then
            Err.Raise vbObjectError + 7308, "Equation Lab", "Invalid UTF-16 path."
        End If
        If code < &H80& Then
            bytes(used) = CByte(code): used = used + 1
        ElseIf code < &H800& Then
            bytes(used) = CByte(&HC0& Or (code \ 64)): bytes(used + 1) = CByte(&H80& Or (code And 63)): used = used + 2
        ElseIf code < &H10000 Then
            bytes(used) = CByte(&HE0& Or (code \ 4096)): bytes(used + 1) = CByte(&H80& Or ((code \ 64) And 63)): bytes(used + 2) = CByte(&H80& Or (code And 63)): used = used + 3
        Else
            bytes(used) = CByte(&HF0& Or (code \ 262144)): bytes(used + 1) = CByte(&H80& Or ((code \ 4096) And 63)): bytes(used + 2) = CByte(&H80& Or ((code \ 64) And 63)): bytes(used + 3) = CByte(&H80& Or (code And 63)): used = used + 4
        End If
        i = i + 1
    Loop
    ReDim Preserve bytes(0 To used - 1)
End Sub
