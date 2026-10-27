Attribute VB_Name = "EquationLabRibbon"
Option Explicit

' Compiled by the developer. Installed as a global Startup template by PKG.
Public Sub ELRibbonAction(ByVal control As IRibbonControl)
    On Error GoTo Failed
    Select Case control.Tag
        Case "open-pane": OpenDocumentEditor
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
    SavePreferenceForDocument ActiveDocument, key, value
End Sub

Private Sub SavePreferenceForDocument(ByVal Doc As Document, ByVal key As String, ByVal value As String)
    Dim variable As Variable
    For Each variable In Doc.Variables
        If variable.Name = key Then variable.Value = value: Exit Sub
    Next
    Doc.Variables.Add Name:=key, value:=value
End Sub

' Compute preview counters from fields before the insertion point. A chapter
' reset is a hidden SEQ field, not a visible equation to count.
Private Function SequenceBeforeSelection(ByVal sequenceName As String, ByRef found As Boolean) As Long
    Dim field As Field, code As String, parts() As String, i As Long, value As Long
    Dim repeatCurrent As Boolean, resetFound As Boolean, resetValue As Long
    found = False
    For Each field In ActiveDocument.Fields
        If field.Code.Start < Selection.Start Then
            code = UCase$(Trim$(Replace(field.Code.Text, vbTab, " ")))
            Do While InStr(code, "  ") > 0: code = Replace(code, "  ", " "): Loop
            parts = Split(code, " ")
            If UBound(parts) >= 1 Then
                If parts(0) = "SEQ" And parts(1) = UCase$(sequenceName) Then
                    found = True: repeatCurrent = False: resetFound = False
                    For i = 2 To UBound(parts)
                        If parts(i) = "\C" Then repeatCurrent = True
                        If parts(i) = "\S" Then Err.Raise vbObjectError + 7347, "Equation Lab", "This sequence uses a heading-level reset that cannot be previewed safely."
                        If parts(i) = "\R" Then
                            If i = UBound(parts) Then Err.Raise vbObjectError + 7347, "Equation Lab", "Invalid sequence reset."
                            If Not IsNumeric(parts(i + 1)) Then Err.Raise vbObjectError + 7347, "Equation Lab", "Invalid sequence reset."
                            If CDbl(parts(i + 1)) < 0 Or CDbl(parts(i + 1)) > 32767 Or CDbl(parts(i + 1)) <> Fix(CDbl(parts(i + 1))) Then Err.Raise vbObjectError + 7347, "Equation Lab", "Invalid sequence reset."
                            resetValue = CLng(parts(i + 1)): resetFound = True
                        End If
                    Next
                    If resetFound Then
                        value = resetValue
                    ElseIf Not repeatCurrent Then
                        value = value + 1
                    End If
                End If
            End If
        End If
    Next
    SequenceBeforeSelection = value
End Function

Private Function NextNumber() As Long
    Dim found As Boolean, value As Long
    value = SequenceBeforeSelection("EquationLab", found)
    If value >= 32767 Then Err.Raise vbObjectError + 7347, "Equation Lab", "The equation sequence exceeds the supported range."
    NextNumber = value + 1
End Function

Private Function CurrentCounter(ByVal sequenceName As String, ByVal fallback As String) As String
    Dim found As Boolean, value As Long
    value = SequenceBeforeSelection(sequenceName, found)
    If found And value > 0 Then CurrentCounter = CStr(value) Else CurrentCounter = fallback
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

Public Sub ELWriteDocumentCapture(ByVal path As String, ByVal value As String)
    If Len(value) <= 4096 Then
        ELWriteUtf8 path, value
        Exit Sub
    End If
    ' Copy formula-sized VBA UTF-16 buffers in bulk instead of interpreting
    ' every character in EncodeTextUtf8. Only the native capture reader accepts
    ' this BOM-marked sidecar; HTTP still uses bounded compressed UTF-8.
    Dim bytes() As Byte, file As Integer
    bytes = ChrW$(&HFEFF) & value
    file = FreeFile
    Open path For Output As #file
    Close #file
    Open path For Binary Access Write As #file
    Put #file, , bytes
    Close #file
End Sub

Private Sub InsertEquation(ByVal kind As String)
    RequireDocument
    Dim Doc As Document, selectedRange As Range, chosen As InlineShape
    Dim chapter As String, section As String, equationNumber As Long
    Set Doc = ActiveDocument
    Set selectedRange = Selection.Range.Duplicate
    Set chosen = ELSelectedEquation(Selection)
    If Not chosen Is Nothing Then
        If kind = "Right" Or kind = "Left" Then
            NumberSelectedEquation Doc, chosen, (kind = "Right")
            Exit Sub
        End If
        Err.Raise vbObjectError + 7346, "Equation Lab", "Select an equation only for Right or Left numbering."
    End If
    If selectedRange.Start <> selectedRange.End Then Err.Raise vbObjectError + 7346, "Equation Lab", "Please place an empty cursor where the equation should be inserted."
    If EquationLabNativeCommand("MathTypeBridgeTransportActive") <> 0 Then Err.Raise vbObjectError + 7346, "Equation Lab", "Finish the active Equation Lab edit before changing equation numbering."
    chapter = Preference("EquationLabChapter", "1"): section = Preference("EquationLabSection", "1"): equationNumber = 1
    If kind = "Right" Or kind = "Left" Then
        chapter = CurrentCounter("ELChapter", chapter)
        section = CurrentCounter("ELSection", section)
        equationNumber = NextNumber()
    End If
    ELWriteUtf8 WorkDirectory() & "ribbon-settings.txt", ELDocumentNumberFormat(Doc, selectedRange.Start) & vbLf & chapter & vbLf & section & vbLf & CStr(equationNumber) & vbLf
    EquationLabDocumentContext.ELBeginEquationInsertion kind
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
    Dim chosen As InlineShape
    Set chosen = ELSelectedEquation(Selection)
    If chosen Is Nothing Then Err.Raise vbObjectError + 7349, "Equation Lab", "Select one MathType equation to edit."
    ELOpenEquation chosen
End Sub

Private Sub OpenDocumentEditor()
    RequireDocument
    Dim chosen As InlineShape, equation As InlineShape
    Set chosen = ELSelectedEquation(Selection)
    If chosen Is Nothing Then
        For Each equation In ActiveDocument.InlineShapes
            If IsEquation(equation) Then Set chosen = equation: Exit For
        Next
    End If
    If chosen Is Nothing Then
        NativeTool "Open"
        Exit Sub
    End If
    ELInvalidateDocumentSnapshot
    ELOpenEquation chosen
End Sub

Private Sub NavigateEquation(ByVal forward As Boolean)
    RequireDocument
    Dim equation As InlineShape, chosen As InlineShape, current As InlineShape, position As Long
    ' Selection.Start can precede an embedded field's InlineShape range. Resolve
    ' an exact supported selection first, then step from the object boundary.
    Set current = ELSelectedEquation(Selection)
    position = Selection.Start
    If Not current Is Nothing Then position = current.Range.Start
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
    OpenDocumentEditor
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
    Dim Doc As Document, selectedRange As Range, chosen As InlineShape
    Set Doc = ActiveDocument
    Set selectedRange = Selection.Range.Duplicate
    Set chosen = ELSelectedEquation(Selection)
    If Not chosen Is Nothing Then
        NumberSelectedEquation Doc, chosen, True
        Exit Sub
    End If
    If selectedRange.Start <> selectedRange.End Then Err.Raise vbObjectError + 7352, "Equation Lab", "Select one MathType equation, or place an empty cursor before inserting a number."
    If EquationLabNativeCommand("MathTypeBridgeTransportActive") <> 0 Then Err.Raise vbObjectError + 7352, "Equation Lab", "Finish the active Equation Lab edit before changing equation numbering."
    ELWriteUtf8 WorkDirectory() & "ribbon-settings.txt", ELDocumentNumberFormat(ActiveDocument, Selection.Start) & vbLf & CurrentCounter("ELChapter", Preference("EquationLabChapter", "1")) & vbLf & CurrentCounter("ELSection", Preference("EquationLabSection", "1")) & vbLf & CStr(NextNumber()) & vbLf
    InsertPreparedFragment "Number"
End Sub

' Numbering a selected equation is deliberately restricted to a plain, single
' equation paragraph. It never inserts/replaces the OLE or imports a DOCX.
Public Sub NumberSelectedEquation(ByVal Doc As Document, ByVal equation As InlineShape, ByVal rightSide As Boolean, Optional ByVal patternOverride As String = "", Optional ByVal verifiedBackgroundTarget As Boolean = False)
    Dim paragraph As Range, objectRange As Range, oleRange As Range, numberBookmark As Bookmark
    Dim oldNumberRange As Range, insertion As Range, copiedRange As Range, bookmarkRange As Range
    Dim bookmarkName As String, field As Field, code As String, numberCount As Long
    Dim undoRecord As UndoRecord, customUndo As Boolean, changed As Boolean
    Dim oldSmartCutPaste As Boolean, smartCutPasteChanged As Boolean
    Dim oldShowHidden As Boolean, bookmarkVisibilityChanged As Boolean
    Dim oleStart As Long, oleEnd As Long, targetPosition As Long, fieldStart As Long
    On Error GoTo Failed
    If Doc Is Nothing Then Err.Raise vbObjectError + 7360, "Equation Lab", "The selected equation is unavailable."
    If equation Is Nothing Then Err.Raise vbObjectError + 7360, "Equation Lab", "The selected equation is unavailable."
    If Doc.ReadOnly Then Err.Raise vbObjectError + 7360, "Equation Lab", "This document is read only."
    If Doc.TrackRevisions Then Err.Raise vbObjectError + 7360, "Equation Lab", "Turn off Track Changes before numbering an equation."
    If Not (equation.Range.Document Is Doc) Then Err.Raise vbObjectError + 7360, "Equation Lab", "The selected equation belongs to a different document."
    If Doc.ProtectionType <> wdNoProtection Then Err.Raise vbObjectError + 7360, "Equation Lab", "This document is protected."
    If equation.Range.StoryType <> wdMainTextStory Then Err.Raise vbObjectError + 7360, "Equation Lab", "Equation numbering supports the document body only."
    If Not verifiedBackgroundTarget Then
        If EquationLabNativeCommand("MathTypeBridgeTransportActive") <> 0 Then Err.Raise vbObjectError + 7360, "Equation Lab", "Finish the active Equation Lab edit before changing equation numbering."
    End If
    Set objectRange = equation.Range.Duplicate
    Set paragraph = objectRange.Paragraphs(1).Range.Duplicate
    If paragraph.Revisions.Count <> 0 Then Err.Raise vbObjectError + 7360, "Equation Lab", "Equation numbering is unavailable in a paragraph with tracked revisions."
    If paragraph.InlineShapes.Count <> 1 Then Err.Raise vbObjectError + 7360, "Equation Lab", "Select a standalone paragraph containing one equation."
    If Not (paragraph.InlineShapes(1).Range.Start = objectRange.Start And paragraph.InlineShapes(1).Range.End = objectRange.End) Then Err.Raise vbObjectError + 7360, "Equation Lab", "Select one exact equation in a standalone paragraph."
    If paragraph.Editors.Count > 0 Then Err.Raise vbObjectError + 7360, "Equation Lab", "The selected paragraph is not editable."
    If paragraph.ContentControls.Count > 0 Then Err.Raise vbObjectError + 7360, "Equation Lab", "Equation numbering is unavailable inside a content control."
    If paragraph.Tables.Count > 0 Or paragraph.ListFormat.ListType <> wdListNoNumbering Then Err.Raise vbObjectError + 7360, "Equation Lab", "Equation numbering supports plain body paragraphs outside tables and lists."

    ' The selected InlineShape can sit inside Word's wdFieldEmbed wrapper.
    ' Protect the complete field range and never insert at an interior boundary.
    For Each field In paragraph.Fields
        If field.Type = wdFieldEmbed Then
            If Not oleRange Is Nothing Then Err.Raise vbObjectError + 7360, "Equation Lab", "The selected paragraph contains multiple embedded fields."
            If field.Result.InlineShapes.Count <> 1 Then Err.Raise vbObjectError + 7360, "Equation Lab", "The embedded field contains unsupported content."
            If Not (field.Result.Start <= objectRange.Start And field.Result.End >= objectRange.End) Then Err.Raise vbObjectError + 7360, "Equation Lab", "The selected equation is not the complete embedded field result."
            fieldStart = RibbonEmbeddedEquationFieldStart(field, Doc)
            If fieldStart < 0 Then Err.Raise vbObjectError + 7360, "Equation Lab", "The OLE field boundary could not be resolved safely."
            Set oleRange = Doc.Range(fieldStart, field.Result.End + 1)
            If oleRange.Start < paragraph.Start Or oleRange.End > paragraph.End Then Err.Raise vbObjectError + 7360, "Equation Lab", "The embedded field crosses a paragraph boundary."
            oleStart = oleRange.Start: oleEnd = oleRange.End
        Else
            code = Trim$(field.Code.Text)
            If Left$(code, 15) = "SEQ EquationLab" Then
                numberCount = numberCount + 1
            ElseIf Left$(code, 13) <> "SEQ ELChapter" And Left$(code, 13) <> "SEQ ELSection" Then
                Err.Raise vbObjectError + 7360, "Equation Lab", "The selected paragraph contains an unsupported field."
            End If
        End If
    Next
    If oleRange Is Nothing Then Err.Raise vbObjectError + 7360, "Equation Lab", "The selected equation has no supported Word EMBED field."
    oldShowHidden = Doc.Bookmarks.ShowHidden
    Doc.Bookmarks.ShowHidden = True
    bookmarkVisibilityChanged = True
    For Each numberBookmark In Doc.Bookmarks
        If numberBookmark.Range.Start < paragraph.End And numberBookmark.Range.End > paragraph.Start Then
            ' _GoBack is Word's temporary navigation position, not a reference.
            If Left$(numberBookmark.Name, 3) <> "EL_" And numberBookmark.Name <> "_GoBack" Then Err.Raise vbObjectError + 7360, "Equation Lab", "The equation paragraph contains another bookmark; its layout was not changed."
        End If
        If Left$(numberBookmark.Name, 3) = "EL_" Then
            If numberBookmark.Range.Start >= paragraph.Start And numberBookmark.Range.End <= paragraph.End Then
                If Not numberBookmark Is Nothing Then
                    If bookmarkName <> "" Then Err.Raise vbObjectError + 7360, "Equation Lab", "The selected paragraph contains multiple Equation Lab number bookmarks."
                    bookmarkName = numberBookmark.Name
                End If
            End If
        End If
    Next
    Doc.Bookmarks.ShowHidden = oldShowHidden
    bookmarkVisibilityChanged = False
    If numberCount > 0 And bookmarkName = "" Then Err.Raise vbObjectError + 7360, "Equation Lab", "The existing number has no Equation Lab reference bookmark."
    If numberCount = 0 And bookmarkName <> "" Then Err.Raise vbObjectError + 7360, "Equation Lab", "The selected paragraph has an Equation Lab bookmark without a number."
    If numberCount > 1 Then Err.Raise vbObjectError + 7360, "Equation Lab", "The selected paragraph contains multiple equation counters."
    If numberCount > 0 Then ValidateExistingRibbonNumber Doc, paragraph, bookmarkName

    Set bookmarkRange = Nothing
    If bookmarkName <> "" Then Set bookmarkRange = Doc.Bookmarks(bookmarkName).Range.Duplicate
    ValidateEquationParagraphRemainder Doc, paragraph, oleRange, bookmarkRange
    If Not bookmarkRange Is Nothing Then
        If patternOverride = "" And ((rightSide And bookmarkRange.Start >= oleEnd) Or ((Not rightSide) And bookmarkRange.End <= oleStart)) Then
            UpdateNumbersForDocument Doc
            ELInvalidateDocumentSnapshot
            Exit Sub
        End If
    End If

    Dim pattern As String
    If numberCount = 0 Or patternOverride <> "" Then
        If patternOverride <> "" Then pattern = patternOverride Else pattern = ELDocumentNumberFormat(Doc, oleStart)
        ValidateRibbonNumberFormat pattern
        RequireCounterContext Doc, pattern, oleStart
    End If
    ' Word must expose an isolated undo record before the first change.
    Set undoRecord = Application.UndoRecord
    If undoRecord.CustomRecordLevel <> 0 Then Err.Raise vbObjectError + 7360, "Equation Lab", "Another Word edit is in progress. Try numbering again when it finishes."
    ValidateNumberParagraphLayout paragraph
    undoRecord.StartCustomRecord "Equation Lab equation numbering"
    customUndo = True
    ' Smart cut/paste can insert a space when the tab next to an OLE is
    ' removed. Disable it only for this synchronous range operation.
    oldSmartCutPaste = Options.SmartCutPaste
    Options.SmartCutPaste = False
    smartCutPasteChanged = True
    If numberCount > 0 And patternOverride <> "" Then
        ' Insert the replacement before the old range, then remove the old
        ' fields only after Word confirms that its retained range still has
        ' the original text and field count. Keep the EL_ name for REF fields.
        Dim originalNumber As String, originalFields As Long, originalLength As Long, temporaryName As String, originalName As String
        Set oldNumberRange = Doc.Bookmarks(bookmarkName).Range.Duplicate
        originalNumber = oldNumberRange.Text: originalFields = oldNumberRange.Fields.Count
        originalLength = oldNumberRange.End - oldNumberRange.Start
        originalName = bookmarkName
        Doc.Bookmarks(originalName).Delete: changed = True
        Set insertion = Doc.Range(oldNumberRange.Start, oldNumberRange.Start)
        AddRibbonNumber Doc, insertion, pattern, changed, temporaryName
        Set copiedRange = Doc.Bookmarks(temporaryName).Range.Duplicate
        ' Inserting at a retained range's start can expand it to include the
        ' new fields. Reacquire the old number from the end of the newly
        ' created bookmark and verify it before deleting anything.
        Set oldNumberRange = Doc.Range(copiedRange.End, copiedRange.End + originalLength)
        If oldNumberRange.Text <> originalNumber Or oldNumberRange.Fields.Count <> originalFields Then
            Debug.Print "Equation Lab numbering boundary mismatch: "; originalLength; Len(originalNumber); oldNumberRange.End - oldNumberRange.Start; Len(oldNumberRange.Text); originalFields; oldNumberRange.Fields.Count
            Err.Raise vbObjectError + 7360, "Equation Lab", "Word changed the existing number boundary; this operation was rolled back."
        End If
        oldNumberRange.Delete
        Set copiedRange = Doc.Bookmarks(temporaryName).Range.Duplicate
        Doc.Bookmarks(temporaryName).Delete
        Doc.Bookmarks.Add Name:=originalName, Range:=copiedRange
        bookmarkName = originalName
        Set copiedRange = Doc.Bookmarks(bookmarkName).Range.Duplicate
    ElseIf numberCount > 0 Then
        Set oldNumberRange = Doc.Bookmarks(bookmarkName).Range.Duplicate
        If (rightSide And oldNumberRange.Start >= oleEnd) Or ((Not rightSide) And oldNumberRange.End <= oleStart) Then
            Set copiedRange = oldNumberRange.Duplicate
        Else
            ' Remove only the name, then copy real fields before deleting them.
            ' Retained ranges track position shifts; no clipboard or OLE rewrite.
            Doc.Bookmarks(bookmarkName).Delete
            changed = True
            targetPosition = oleStart
            If rightSide Then targetPosition = oleEnd
            Set insertion = Doc.Range(targetPosition, targetPosition)
            insertion.FormattedText = oldNumberRange.FormattedText
            Set copiedRange = insertion.Duplicate
            oldNumberRange.Delete
        End If
    Else
        Set insertion = Doc.Range(IIf(rightSide, oleEnd, oleStart), IIf(rightSide, oleEnd, oleStart))
        AddRibbonNumber Doc, insertion, pattern, changed, bookmarkName
        Set copiedRange = Doc.Bookmarks(bookmarkName).Range.Duplicate
    End If
    NormalizeNumberParagraph Doc, equation, copiedRange, bookmarkName, rightSide, changed
    UpdateNumbersForDocument Doc
    If patternOverride <> "" Then SavePreferenceForDocument Doc, "EquationLabNumberFormat", patternOverride
    ELInvalidateDocumentSnapshot
    undoRecord.EndCustomRecord
    customUndo = False
    Options.SmartCutPaste = oldSmartCutPaste
    smartCutPasteChanged = False
    Exit Sub
Failed:
    Dim failureNumber As Long, failureDescription As String
    failureNumber = Err.Number: failureDescription = Err.Description
    On Error Resume Next
    If bookmarkVisibilityChanged Then Doc.Bookmarks.ShowHidden = oldShowHidden
    If customUndo Then
        undoRecord.EndCustomRecord
        If changed Then Doc.Undo
    End If
    If smartCutPasteChanged Then Options.SmartCutPaste = oldSmartCutPaste
    On Error GoTo 0
    Err.Raise failureNumber, "Equation Lab", failureDescription
End Sub

Private Function RibbonEmbeddedEquationFieldStart(ByVal embedded As Field, ByVal Doc As Document) As Long
    On Error GoTo Missing
    RibbonEmbeddedEquationFieldStart = -1
    Dim position As Long, value As String
    For position = embedded.Code.Start - 1 To embedded.Code.Start - 2 Step -1
        If position < 0 Then Exit For
        value = Doc.Range(position, position + 1).Text
        If Len(value) > 0 And value <> Chr$(19) Then Exit For
        RibbonEmbeddedEquationFieldStart = position
        If value = Chr$(19) Then Exit Function
    Next
Missing:
End Function

Private Sub ValidateEquationParagraphRemainder(ByVal Doc As Document, ByVal paragraph As Range, ByVal oleRange As Range, ByVal numberRange As Range)
    Dim oleStart As Long, oleEnd As Long, numberStart As Long, numberEnd As Long, paragraphEnd As Long
    oleStart = oleRange.Start: oleEnd = oleRange.End: paragraphEnd = paragraph.End - 1
    If numberRange Is Nothing Then
        RequireLayoutWhitespace Doc.Range(paragraph.Start, oleStart)
        RequireLayoutWhitespace Doc.Range(oleEnd, paragraphEnd)
        Exit Sub
    End If
    numberStart = numberRange.Start: numberEnd = numberRange.End
    If numberEnd <= oleStart Then
        RequireLayoutWhitespace Doc.Range(paragraph.Start, numberStart)
        RequireLayoutWhitespace Doc.Range(numberEnd, oleStart)
        RequireLayoutWhitespace Doc.Range(oleEnd, paragraphEnd)
    ElseIf numberStart >= oleEnd Then
        RequireLayoutWhitespace Doc.Range(paragraph.Start, oleStart)
        RequireLayoutWhitespace Doc.Range(oleEnd, numberStart)
        RequireLayoutWhitespace Doc.Range(numberEnd, paragraphEnd)
    Else
        Err.Raise vbObjectError + 7360, "Equation Lab", "The number bookmark overlaps the embedded equation."
    End If
End Sub

Private Sub RequireLayoutWhitespace(ByVal checkedRange As Range)
    Dim value As String, i As Long, ch As String
    value = checkedRange.Text
    For i = 1 To Len(value)
        ch = Mid$(value, i, 1)
        If ch <> " " And ch <> vbTab And ch <> Chr$(13) And ch <> Chr$(7) Then Err.Raise vbObjectError + 7360, "Equation Lab", "The selected equation paragraph also contains prose or unsupported content."
    Next
End Sub

Private Sub RequireCounterContext(ByVal Doc As Document, ByVal pattern As String, ByVal beforePosition As Long)
    Dim field As Field, code As String, hasChapter As Boolean, hasSection As Boolean
    If InStr(1, pattern, "#C", vbBinaryCompare) = 0 And InStr(1, pattern, "#S", vbBinaryCompare) = 0 Then Exit Sub
    For Each field In Doc.Fields
        If field.Result.Start < beforePosition Then
            code = Trim$(field.Code.Text)
            If Left$(code, 13) = "SEQ ELChapter" Then hasChapter = True
            If Left$(code, 13) = "SEQ ELSection" Then hasSection = True
        End If
    Next
    If InStr(1, pattern, "#C", vbBinaryCompare) > 0 And Not hasChapter Then Err.Raise vbObjectError + 7363, "Equation Lab", "Set Chapter/Section numbering before using a #C token."
    If InStr(1, pattern, "#S", vbBinaryCompare) > 0 And Not hasSection Then Err.Raise vbObjectError + 7363, "Equation Lab", "Set Chapter/Section numbering before using a #S token."
End Sub

Private Sub ValidateNumberParagraphLayout(ByVal paragraph As Range)
    With paragraph.Sections(1).PageSetup
        If .TextColumns.Count <> 1 Or .PageWidth - .LeftMargin - .RightMargin - .Gutter <= 0 Then Err.Raise vbObjectError + 7360, "Equation Lab", "Use a single-column body paragraph for equation numbering."
    End With
End Sub

Private Sub NormalizeNumberParagraph(ByVal Doc As Document, ByVal equation As InlineShape, ByVal numberRange As Range, ByVal bookmarkName As String, ByVal rightSide As Boolean, ByRef changed As Boolean)
    Dim paragraph As Range, embedded As Field, oleRange As Range, trimRange As Range
    Dim firstStart As Long, lastEnd As Long, gapStart As Long, gapEnd As Long
    Dim numberLength As Long, paragraphStart As Long, finalNumberStart As Long, usableWidth As Single
    Dim originalNumberText As String, originalNumberFields As Long
    originalNumberText = numberRange.Text
    originalNumberFields = numberRange.Fields.Count
    Set paragraph = equation.Range.Paragraphs(1).Range.Duplicate
    For Each embedded In paragraph.Fields
        If embedded.Type = wdFieldEmbed Then
            Set oleRange = Doc.Range(RibbonEmbeddedEquationFieldStart(embedded, Doc), embedded.Result.End + 1)
            Exit For
        End If
    Next
    If oleRange Is Nothing Then Err.Raise vbObjectError + 7360, "Equation Lab", "The original embedded equation is unavailable."
    ValidateEquationParagraphRemainder Doc, paragraph, oleRange, numberRange
    If Doc.Bookmarks.Exists(bookmarkName) Then
        Doc.Bookmarks(bookmarkName).Delete
        changed = True
    End If
    numberLength = numberRange.End - numberRange.Start
    If rightSide Then
        firstStart = oleRange.Start: lastEnd = numberRange.End
        gapStart = oleRange.End: gapEnd = numberRange.Start
    Else
        firstStart = numberRange.Start: lastEnd = oleRange.End
        gapStart = numberRange.End: gapEnd = oleRange.Start
    End If
    ' Delete only prevalidated whitespace, from right to left. Preserve the
    ' complete EMBED and number field ranges and the paragraph terminator.
    If lastEnd < paragraph.End - 1 Then
        Set trimRange = Doc.Range(lastEnd, paragraph.End - 1): trimRange.Delete: changed = True
    End If
    If gapEnd > gapStart Then
        Set trimRange = Doc.Range(gapStart, gapEnd): trimRange.Delete: changed = True
    End If
    If firstStart > paragraph.Start Then
        Set trimRange = Doc.Range(paragraph.Start, firstStart): trimRange.Delete: changed = True
    End If
    paragraphStart = paragraph.Start
    If rightSide Then
        finalNumberStart = oleRange.End + 2
        Set trimRange = Doc.Range(oleRange.End, oleRange.End): trimRange.InsertAfter vbTab: changed = True
        Set trimRange = Doc.Range(paragraphStart, paragraphStart): trimRange.InsertBefore vbTab
    Else
        finalNumberStart = paragraphStart
        Set trimRange = Doc.Range(paragraphStart + numberLength, paragraphStart + numberLength): trimRange.InsertAfter vbTab: changed = True
    End If
    Doc.Bookmarks.Add Name:=bookmarkName, Range:=Doc.Range(finalNumberStart, finalNumberStart + numberLength)
    With Doc.Bookmarks(bookmarkName).Range
        If .Text <> originalNumberText Or .Fields.Count <> originalNumberFields Then Err.Raise vbObjectError + 7360, "Equation Lab", "Word changed the number boundary; this numbering operation was rolled back."
    End With
    With paragraph.Sections(1).PageSetup
        usableWidth = .PageWidth - .LeftMargin - .RightMargin - .Gutter
    End With
    With paragraph.ParagraphFormat
        .Alignment = wdAlignParagraphLeft
        .LeftIndent = 0: .RightIndent = 0: .FirstLineIndent = 0
        .TabStops.ClearAll
        .TabStops.Add Position:=usableWidth / 2, Alignment:=wdAlignTabCenter, Leader:=wdTabLeaderSpaces
        .TabStops.Add Position:=usableWidth, Alignment:=wdAlignTabRight, Leader:=wdTabLeaderSpaces
    End With
End Sub

Private Sub ValidateExistingRibbonNumber(ByVal Doc As Document, ByVal paragraph As Range, ByVal bookmarkName As String)
    Dim field As Field, bookmarkRange As Range, code As String, sequence As String, switchFormat As String
    Dim parts As Variant
    Dim counter As Long, prior As Long, equations As Long, chapters As Long, sections As Long, switchAt As Long
    Set bookmarkRange = Doc.Bookmarks(bookmarkName).Range
    For Each field In paragraph.Fields
        If field.Type = wdFieldEmbed Then GoTo NextValidatedField
        code = Trim$(field.Code.Text)
        If Left$(code, 4) <> "SEQ " Then Err.Raise vbObjectError + 7362, "Equation Lab", "The existing number contains an unsupported field."
        If field.Result.Start < bookmarkRange.Start Or field.Result.End > bookmarkRange.End Then Err.Raise vbObjectError + 7362, "Equation Lab", "The existing number bookmark does not cover all of its sequence fields."
        parts = Split(Mid$(code, 5), " ")
        sequence = parts(0)
        Select Case sequence
            Case "ELChapter": counter = 1: chapters = chapters + 1
            Case "ELSection": counter = 2: sections = sections + 1
            Case "EquationLab": counter = 3: equations = equations + 1
            Case Else: Err.Raise vbObjectError + 7362, "Equation Lab", "The existing number uses an unsupported sequence."
        End Select
        If counter < prior Then Err.Raise vbObjectError + 7362, "Equation Lab", "The existing number counters are out of order."
        prior = counter
        If counter = 3 Then
            If InStr(1, code, "\n", vbBinaryCompare) = 0 Or InStr(1, code, "\c", vbBinaryCompare) > 0 Or InStr(1, code, "\r", vbBinaryCompare) > 0 Then Err.Raise vbObjectError + 7362, "Equation Lab", "The existing equation counter is not a supported SEQ field."
        Else
            If InStr(1, code, "\c", vbBinaryCompare) = 0 Or InStr(1, code, "\n", vbBinaryCompare) > 0 Or InStr(1, code, "\r", vbBinaryCompare) > 0 Then Err.Raise vbObjectError + 7362, "Equation Lab", "The existing chapter or section counter is not a supported SEQ field."
        End If
        switchAt = InStr(1, code, "\*", vbBinaryCompare)
        If switchAt = 0 Then Err.Raise vbObjectError + 7362, "Equation Lab", "The existing number has no supported format switch."
        switchFormat = UCase$(Trim$(Mid$(code, switchAt + 2)))
        ' Word appends this harmless switch when PreserveFormatting is true.
        If Right$(switchFormat, Len("\* MERGEFORMAT")) = "\* MERGEFORMAT" Then switchFormat = Trim$(Left$(switchFormat, Len(switchFormat) - Len("\* MERGEFORMAT")))
        If switchFormat <> "ARABIC" And switchFormat <> "ALPHABETIC" And switchFormat <> "ROMAN" Then Err.Raise vbObjectError + 7362, "Equation Lab", "The existing number uses an unsupported format."
NextValidatedField:
    Next
    If equations <> 1 Or chapters > 1 Or sections > 1 Then Err.Raise vbObjectError + 7362, "Equation Lab", "The existing number does not match the supported format grammar."
End Sub

Private Function PreferenceForDocument(ByVal Doc As Document, ByVal key As String, ByVal fallback As String) As String
    On Error GoTo Missing
    PreferenceForDocument = Doc.Variables(key).Value
    Exit Function
Missing:
    PreferenceForDocument = fallback
End Function

' Read the actual bookmarked fields, not their cached number or the editor's
' sample preview. Old exported documents may have no document preference.
Private Function RibbonNumberFormat(ByVal Doc As Document, ByVal numberBookmark As Bookmark) As String
    On Error GoTo Unsupported
    Dim field As Field, span As Range, cursor As Long, start As Long, pattern As String
    Dim code As String, sequence As String, switchAt As Long, format As String, token As String
    If Left$(numberBookmark.Name, 3) <> "EL_" Then Exit Function
    Set span = numberBookmark.Range.Duplicate
    If span.StoryType <> wdMainTextStory Or span.Paragraphs.Count <> 1 Then Exit Function
    ValidateExistingRibbonNumber Doc, span.Paragraphs(1).Range, numberBookmark.Name
    cursor = span.Start
    For Each field In span.Fields
        start = field.Code.Start - 1
        If start < cursor Or start >= span.End Then Exit Function
        If Len(Doc.Range(start, start + 1).Text) > 0 And Doc.Range(start, start + 1).Text <> Chr$(19) Then Exit Function
        pattern = pattern & Doc.Range(cursor, start).Text
        code = Trim$(field.Code.Text)
        sequence = FieldWord(code, 1)
        Select Case sequence
            Case "ELChapter": token = "#C"
            Case "ELSection": token = "#S"
            Case "EquationLab": token = "#E"
            Case Else: Exit Function
        End Select
        switchAt = InStr(1, code, "\*", vbBinaryCompare)
        If switchAt = 0 Then Exit Function
        format = Trim$(Mid$(code, switchAt + 2))
        If InStr(format, " ") > 0 Then format = Left$(format, InStr(format, " ") - 1)
        Select Case format
            Case "ARABIC", "Arabic", "arabic": token = token & "1"
            Case "ALPHABETIC": token = token & "A"
            Case "alphabetic": token = token & "a"
            Case "ROMAN": token = token & "I"
            Case "roman": token = token & "i"
            Case Else: Exit Function
        End Select
        pattern = pattern & token
        cursor = field.Result.End + 1
        If cursor > span.End Then Exit Function
    Next
    pattern = pattern & Doc.Range(cursor, span.End).Text
    ValidateRibbonNumberFormat pattern
    RibbonNumberFormat = pattern
Unsupported:
End Function

Public Function ELDocumentNumberFormat(ByVal Doc As Document, ByVal beforePosition As Long) As String
    Dim pattern As String, bookmark As Bookmark, formats As Collection, counts As Collection
    Dim i As Long, found As Boolean, total As Long, bestCount As Long, closestStart As Long, closest As String
    pattern = PreferenceForDocument(Doc, "EquationLabNumberFormat", "")
    If pattern <> "" Then
        ValidateRibbonNumberFormat pattern
        ELDocumentNumberFormat = pattern
        Exit Function
    End If
    Set formats = New Collection: Set counts = New Collection
    closestStart = -1
    For Each bookmark In Doc.Bookmarks
        pattern = RibbonNumberFormat(Doc, bookmark)
        If pattern <> "" Then
            total = total + 1
            If bookmark.Range.Start <= beforePosition And bookmark.Range.Start > closestStart Then closest = pattern: closestStart = bookmark.Range.Start
            found = False
            For i = 1 To formats.Count
                If CStr(formats(i)) = pattern Then
                    Dim count As Long
                    count = CLng(counts(i)) + 1
                    counts.Remove i
                    If i <= counts.Count Then counts.Add count, Before:=i Else counts.Add count
                    found = True
                    Exit For
                End If
            Next
            If Not found Then formats.Add pattern: counts.Add 1
        End If
    Next
    pattern = ""
    For i = 1 To formats.Count
        If CLng(counts(i)) > bestCount Then bestCount = CLng(counts(i)): pattern = CStr(formats(i))
    Next
    ' A strict majority recovers uniform legacy/demo documents. Mixed formats
    ' keep the closest preceding equation instead of choosing an arbitrary one.
    If bestCount * 2 > total Then
        ELDocumentNumberFormat = pattern
    ElseIf closest <> "" Then
        ELDocumentNumberFormat = closest
    Else
        ELDocumentNumberFormat = "(#E1)"
    End If
End Function

Public Sub ELRememberInsertedNumberFormat(ByVal Doc As Document, ByVal inserted As Range)
    Dim bookmark As Bookmark, pattern As String, chosen As String, count As Long
    If Not (inserted.Document Is Doc) Then Err.Raise vbObjectError + 7372, "Equation Lab", "The inserted number belongs to another document."
    For Each bookmark In Doc.Bookmarks
        If bookmark.Range.Start >= inserted.Start And bookmark.Range.End <= inserted.End Then
            pattern = RibbonNumberFormat(Doc, bookmark)
            If pattern <> "" Then count = count + 1: chosen = pattern
        End If
    Next
    If count = 1 Then SavePreferenceForDocument Doc, "EquationLabNumberFormat", chosen
End Sub

' The completed fragment is already checked against the insertion ticket and
' Native bytes. Adopt its exact format without re-parsing freshly imported
' Word fields, whose live ranges may not have settled yet.
Public Sub ELAdoptInsertedNumberFormat(ByVal Doc As Document, ByVal pattern As String)
    ValidateRibbonNumberFormat pattern
    SavePreferenceForDocument Doc, "EquationLabNumberFormat", pattern
End Sub

Private Sub ValidateRibbonNumberFormat(ByVal pattern As String)
    Dim i As Long, token As String, seenC As Boolean, seenS As Boolean, seenE As Boolean
    Dim prior As Long, counter As Long, formatCode As String, ch As String
    If Len(pattern) = 0 Or Len(pattern) > 128 Or InStr(pattern, vbCr) > 0 Or InStr(pattern, vbLf) > 0 Then Err.Raise vbObjectError + 7361, "Equation Lab", "Invalid number format."
    i = 1
    Do While i <= Len(pattern)
        ch = Mid$(pattern, i, 1)
        If ch = "#" Then
            If i + 2 > Len(pattern) Then Err.Raise vbObjectError + 7361, "Equation Lab", "Invalid number token."
            token = Mid$(pattern, i + 1, 1): formatCode = Mid$(pattern, i + 2, 1)
            Select Case token
                Case "C"
                    If seenC Then Err.Raise vbObjectError + 7361, "Equation Lab", "A number format may use #C only once."
                    seenC = True: counter = 1
                Case "S"
                    If seenS Then Err.Raise vbObjectError + 7361, "Equation Lab", "A number format may use #S only once."
                    seenS = True: counter = 2
                Case "E"
                    If seenE Then Err.Raise vbObjectError + 7361, "Equation Lab", "A number format requires exactly one #E token."
                    seenE = True: counter = 3
                Case Else: Err.Raise vbObjectError + 7361, "Equation Lab", "Use #E1, #EA, #Ea, #EI, #Ei and corresponding #C/#S tokens."
            End Select
            If InStr(1, "1AaIi", formatCode, vbBinaryCompare) = 0 Then Err.Raise vbObjectError + 7361, "Equation Lab", "Unsupported number format token."
            If counter < prior Then Err.Raise vbObjectError + 7361, "Equation Lab", "Number counters must appear in chapter, section, equation order."
            prior = counter: i = i + 3
        Else
            i = i + 1
        End If
    Loop
    If Not seenE Then Err.Raise vbObjectError + 7361, "Equation Lab", "A number format requires exactly one equation counter."
End Sub

Private Sub AddRibbonNumber(ByVal Doc As Document, ByVal insertion As Range, ByVal pattern As String, ByRef changed As Boolean, ByRef bookmarkName As String)
    Dim i As Long, literalStart As Long, token As String, fmt As String, sequence As String, command As String
    Dim field As Field, fieldRange As Range, bookmarkRange As Range
    Dim contentStart As Long, numberEnd As Long, cursor As Long
    ValidateRibbonNumberFormat pattern
    cursor = insertion.Start
    contentStart = cursor
    literalStart = 1: i = 1
    Do While i <= Len(pattern)
        If Mid$(pattern, i, 1) = "#" Then
            If i > literalStart Then
                Set fieldRange = Doc.Range(cursor, cursor): fieldRange.InsertAfter Mid$(pattern, literalStart, i - literalStart): changed = True
                cursor = cursor + (i - literalStart)
            End If
            token = Mid$(pattern, i + 1, 1): fmt = Mid$(pattern, i + 2, 1)
            Select Case token
                Case "C": sequence = "ELChapter": command = "\c"
                Case "S": sequence = "ELSection": command = "\c"
                Case Else: sequence = "EquationLab": command = "\n"
            End Select
            Select Case fmt
                Case "1": fmt = "ARABIC"
                Case "A": fmt = "ALPHABETIC"
                Case "a": fmt = "alphabetic"
                Case "I": fmt = "ROMAN"
                Case "i": fmt = "roman"
            End Select
            Set fieldRange = Doc.Range(cursor, cursor)
            Set field = Doc.Fields.Add(Range:=fieldRange, Type:=wdFieldSequence, Text:=sequence & " " & command & " \* " & fmt, PreserveFormatting:=True)
            changed = True
            cursor = field.Result.End + 1
            i = i + 3: literalStart = i
        Else
            i = i + 1
        End If
    Loop
    If literalStart <= Len(pattern) Then
        Set fieldRange = Doc.Range(cursor, cursor): fieldRange.InsertAfter Mid$(pattern, literalStart)
        changed = True
        cursor = cursor + Len(pattern) - literalStart + 1
    End If
    numberEnd = cursor
    Set bookmarkRange = Doc.Range(contentStart, numberEnd)
    Randomize
    bookmarkName = "EL_" & Hex$(CLng(Timer * 1000)) & Hex$(CLng(Rnd() * 2147483647#))
    Do While Doc.Bookmarks.Exists(bookmarkName): bookmarkName = bookmarkName & "X": Loop
    Doc.Bookmarks.Add Name:=bookmarkName, Range:=bookmarkRange
End Sub

Private Function FieldWord(ByVal code As String, ByVal index As Long) As String
    code = Replace(Replace(Replace(Trim$(code), vbTab, " "), vbCr, " "), vbLf, " ")
    Do While InStr(code, "  ") > 0: code = Replace(code, "  ", " "): Loop
    Dim words() As String
    words = Split(code, " ")
    If index <= UBound(words) Then FieldWord = Replace(words(index), Chr$(34), "")
End Function

Private Function IsEquationSequence(ByVal field As Field) As Boolean
    If UCase$(FieldWord(field.Code.Text, 0)) <> "SEQ" Then Exit Function
    Select Case UCase$(FieldWord(field.Code.Text, 1))
        Case "EQUATIONLAB", "ELCHAPTER", "ELSECTION", "MTEQN", "MTCHAP", "MTSEC"
            IsEquationSequence = True
    End Select
End Function

Private Sub CollectEquationFields(ByVal scope As Range, ByVal fields As Collection, ByVal seen As Collection, ByVal depth As Long)
    If depth > 32 Then Err.Raise vbObjectError + 7371, "Equation Lab", "Equation fields are nested too deeply."
    Dim field As Field, key As String, previous As Field
    For Each field In scope.Fields
        If field.Type <> wdFieldEmbed Then
            key = "F" & CStr(field.Code.Start)
            Set previous = Nothing
            On Error Resume Next
            Set previous = seen(key)
            On Error GoTo 0
            If previous Is Nothing Then
                seen.Add field, key
                fields.Add field
                ' MathType keeps its hidden increment and visible \c fields
                ' inside MTPlaceRef's CODE. Never execute the macrobutton.
                CollectEquationFields field.Code, fields, seen, depth + 1
                CollectEquationFields field.Result, fields, seen, depth + 1
            End If
        End If
    Next
End Sub

Private Function IsEquationReference(ByVal field As Field, ByVal Doc As Document) As Boolean
    If UCase$(FieldWord(field.Code.Text, 0)) <> "REF" Then Exit Function
    Dim name As String, nested As Field, fields As Collection, seen As Collection, target As Range
    name = FieldWord(field.Code.Text, 1)
    If UCase$(Left$(name, 3)) = "EL_" Then IsEquationReference = True: Exit Function
    If Not Doc.Bookmarks.Exists(name) Then Exit Function
    Set target = Doc.Bookmarks(name).Range
    ' A table or prose bookmark can contain an equation without referencing
    ' its number. Only inspect a number-sized, single-paragraph bookmark.
    If target.Paragraphs.Count <> 1 Or target.Tables.Count <> 0 Or target.InlineShapes.Count <> 0 Or target.Characters.Count > 256 Then Exit Function
    Set fields = New Collection
    Set seen = New Collection
    CollectEquationFields target, fields, seen, 0
    For Each nested In fields
        If IsEquationSequence(nested) Then IsEquationReference = True: Exit Function
    Next
End Function

Private Sub UpdateNumbersForDocument(ByVal Doc As Document)
    Dim field As Field, fields As Collection, seen As Collection, showHidden As Boolean
    Dim failureNumber As Long, failureDescription As String
    showHidden = Doc.Bookmarks.ShowHidden
    On Error GoTo Failed
    Doc.Bookmarks.ShowHidden = True
    Set fields = New Collection
    Set seen = New Collection
    CollectEquationFields Doc.Content, fields, seen, 0
    ' Fields were collected in document/code/result order before any update.
    ' Preserve reset, repeat and chapter switches instead of rebuilding numbers.
    For Each field In fields
        If IsEquationSequence(field) And Not field.Locked Then field.Update
    Next
    For Each field In fields
        If IsEquationReference(field, Doc) And Not field.Locked Then field.Update
    Next
    Doc.Bookmarks.ShowHidden = showHidden
    Exit Sub
Failed:
    failureNumber = Err.Number
    failureDescription = Err.Description
    On Error Resume Next
    Doc.Bookmarks.ShowHidden = showHidden
    On Error GoTo 0
    Err.Raise failureNumber, "Equation Lab", failureDescription
End Sub

' Reuse the same ordered SEQ and REF update after an insertion. The caller
' supplies the document that owns the retained insertion range.
Public Sub ELUpdateNumbersForDocument(ByVal Doc As Document)
    If Doc Is Nothing Then Err.Raise vbObjectError + 7372, "Equation Lab", "The insertion document is unavailable."
    UpdateNumbersForDocument Doc
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

' Shared by the Ribbon and Word's assignable macro commands.
Public Sub UpdateNumbers()
    RequireDocument
    Dim Doc As Document
    Set Doc = ActiveDocument
    UpdateNumbersForDocument Doc
    ELInvalidateDocumentSnapshot
End Sub

Private Sub SetNumberFormat()
    RequireDocument
    Dim value As String
    value = InputBox("Format for new numbered equations. Example: (#C1.#E1)", "Equation Lab", ELDocumentNumberFormat(ActiveDocument, Selection.Start))
    If value = "" Then Exit Sub
    If Len(value) > 128 Or InStr(value, vbLf) > 0 Or InStr(value, vbCr) > 0 Then Err.Raise vbObjectError + 7355, "Equation Lab", "Invalid number format."
    ValidateRibbonNumberFormat value
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
    ELWriteUtf8 WorkDirectory() & "ribbon-settings.txt", ELDocumentNumberFormat(ActiveDocument, Selection.Start) & vbLf & CStr(CLng(chapter)) & vbLf & CStr(CLng(section)) & vbLf & CStr(NextNumber()) & vbLf
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
