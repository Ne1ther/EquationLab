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
        Case "number-format": OpenNumberingSettings False
        Case "chapter-section": OpenNumberingSettings True
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
    SequenceBeforeSelection = SequenceBeforePosition(ActiveDocument, Selection.Start, sequenceName, found)
End Function

Private Function SequenceBeforePosition(ByVal Doc As Document, ByVal beforePosition As Long, ByVal sequenceName As String, ByRef found As Boolean) As Long
    Dim field As Field, code As String, parts() As String, i As Long, value As Long
    Dim fields As Collection, seen As Collection
    Dim repeatCurrent As Boolean, resetFound As Boolean, resetValue As Long
    found = False
    Set fields = New Collection: Set seen = New Collection
    CollectEquationFields Doc.Content, fields, seen, 0
    For Each field In fields
        If field.Code.Start < beforePosition Then
            code = UCase$(Trim$(Replace(field.Code.Text, vbTab, " ")))
            Do While InStr(code, "  ") > 0: code = Replace(code, "  ", " "): Loop
            parts = Split(code, " ")
            If UBound(parts) >= 1 Then
                If parts(0) = "SEQ" And SharedSequenceName(parts(1)) = SharedSequenceName(sequenceName) Then
                    found = True: repeatCurrent = False: resetFound = False
                    For i = 2 To UBound(parts)
                        If parts(i) = "\C" Then repeatCurrent = True
                        If parts(i) = "\S" Then Err.Raise vbObjectError + 7347, "Equation Lab", "This sequence uses a heading-level reset that cannot be previewed safely."
                        If parts(i) = "\R" Then
                            If parts(1) = "MTEQN" And i < UBound(parts) Then
                                If parts(i + 1) = "\H" Then resetValue = 0: resetFound = True: GoTo ResetParsed
                            End If
                            If i = UBound(parts) Then Err.Raise vbObjectError + 7347, "Equation Lab", "Invalid sequence reset."
                            If Not IsNumeric(parts(i + 1)) Then Err.Raise vbObjectError + 7347, "Equation Lab", "Invalid sequence reset."
                            If CDbl(parts(i + 1)) < 0 Or CDbl(parts(i + 1)) > 32767 Or CDbl(parts(i + 1)) <> Fix(CDbl(parts(i + 1))) Then Err.Raise vbObjectError + 7347, "Equation Lab", "Invalid sequence reset."
                            resetValue = CLng(parts(i + 1)): resetFound = True
ResetParsed:
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
    SequenceBeforePosition = value
End Function

Private Function SharedSequenceName(ByVal name As String) As String
    Select Case UCase$(name)
        Case "EQUATIONLAB", "MTEQN": SharedSequenceName = "MTEqn"
        Case "ELCHAPTER", "MTCHAP": SharedSequenceName = "MTChap"
        Case "ELSECTION", "MTSEC": SharedSequenceName = "MTSec"
        Case Else: SharedSequenceName = UCase$(name)
    End Select
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
    Dim hasChapter As Boolean, hasSection As Boolean, ignoredCounter As Long
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
    ELStartEquationInsertion kind, selectedRange
End Sub

' Both the Ribbon and App requests enter this document-bound path. Read all
' counters at the actual insertion position, including initially unnumbered
' equations which may be changed to numbered mode inside the editor.
Public Sub ELStartEquationInsertion(ByVal kind As String, ByVal selectedRange As Range, Optional ByVal leadingParagraph As Boolean = False)
    Dim Doc As Document, chapter As String, section As String, equationNumber As Long
    Dim hasChapter As Boolean, hasSection As Boolean, ignoredCounter As Long
    Set Doc = selectedRange.Document
    If Not (Doc Is ActiveDocument) Then Err.Raise vbObjectError + 7346, "Equation Lab", "The insertion document changed."
    If selectedRange.Start <> selectedRange.End Or selectedRange.StoryType <> wdMainTextStory Then Err.Raise vbObjectError + 7346, "Equation Lab", "Place an empty cursor in the document body."
    ELUpgradeNumberingForInterop Doc
    selectedRange.Select
    chapter = CurrentCounter("ELChapter", Preference("EquationLabChapter", "1"))
    section = CurrentCounter("ELSection", Preference("EquationLabSection", "1"))
    equationNumber = NextNumber()
    ignoredCounter = SequenceBeforePosition(Doc, selectedRange.Start, "ELChapter", hasChapter)
    ignoredCounter = SequenceBeforePosition(Doc, selectedRange.Start, "ELSection", hasSection)
    ELWriteUtf8 WorkDirectory() & "ribbon-settings.txt", ELDocumentNumberFormat(Doc, selectedRange.Start) & vbLf & chapter & vbLf & section & vbLf & CStr(equationNumber) & vbLf & IIf(hasChapter And hasSection, "1", "0") & vbLf
    EquationLabDocumentContext.ELBeginEquationInsertion kind, leadingParagraph
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
Public Sub NumberSelectedEquation(ByVal Doc As Document, ByVal equation As InlineShape, ByVal rightSide As Boolean, Optional ByVal patternOverride As String = "", Optional ByVal verifiedBackgroundTarget As Boolean = False, Optional ByVal chapter As Long = 0, Optional ByVal section As Long = 0, Optional ByVal expectedChapter As Long = -1, Optional ByVal expectedSection As Long = -1)
    Dim record As UndoRecord, changed As Boolean, own As Boolean
    Dim failureNumber As Long, failureDescription As String, futureFormat As String
    On Error GoTo Failed
    If Doc Is Nothing Or equation Is Nothing Then Err.Raise vbObjectError + 7360, "Equation Lab", "The selected equation is unavailable."
    If Doc.ReadOnly Or Doc.ProtectionType <> wdNoProtection Or Doc.TrackRevisions Then Err.Raise vbObjectError + 7360, "Equation Lab", "The document is not available for numbering."
    If Not (equation.Range.Document Is Doc) Then Err.Raise vbObjectError + 7360, "Equation Lab", "The selected equation belongs to a different document."
    If Not verifiedBackgroundTarget And EquationLabNativeCommand("MathTypeBridgeTransportActive") <> 0 Then Err.Raise vbObjectError + 7360, "Equation Lab", "Finish the active Equation Lab edit before changing equation numbering."
    Set record = Application.UndoRecord
    If record.CustomRecordLevel <> 0 Then Err.Raise vbObjectError + 7360, "Equation Lab", "Another Word edit is in progress."
    futureFormat = ELDocumentNumberFormat(Doc, equation.Range.Start)
    record.StartCustomRecord "Equation Lab equation numbering": own = True
    UnwrapSelectedSharedNumber Doc, equation, changed
    NumberSelectedEquationCore Doc, equation, rightSide, changed, patternOverride, verifiedBackgroundTarget, chapter, section, expectedChapter, expectedSection
    UpgradeLegacyNumbering Doc, changed
    UpdateNumbersForDocument Doc
    If patternOverride <> "" Then futureFormat = patternOverride
    SaveSharedNumberFormat Doc, futureFormat
    NumberingChanged Doc: ELInvalidateDocumentSnapshot
    record.EndCustomRecord: own = False
    Exit Sub
Failed:
    failureNumber = Err.Number: failureDescription = Err.Description
    On Error Resume Next
    If own Then
        record.EndCustomRecord
        If changed Then Doc.Undo
    End If
    On Error GoTo 0
    Err.Raise failureNumber, "Equation Lab", failureDescription
End Sub

Private Sub NumberSelectedEquationCore(ByVal Doc As Document, ByVal equation As InlineShape, ByVal rightSide As Boolean, ByRef changed As Boolean, Optional ByVal patternOverride As String = "", Optional ByVal verifiedBackgroundTarget As Boolean = False, Optional ByVal chapter As Long = 0, Optional ByVal section As Long = 0, Optional ByVal expectedChapter As Long = -1, Optional ByVal expectedSection As Long = -1)
    Dim paragraph As Range, objectRange As Range, oleRange As Range, numberBookmark As Bookmark
    Dim oldNumberRange As Range, insertion As Range, copiedRange As Range, bookmarkRange As Range, equationField As Field
    Dim contextChanged As Boolean, foundCounter As Boolean, actualCounter As Long, equationReset As Long
    Dim bookmarkName As String, field As Field, code As String, numberCount As Long
    Dim undoRecord As UndoRecord, customUndo As Boolean
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
    Set paragraph = NumberingEquationParagraph(Doc, equation)
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
            Set equationField = field
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
            If Not IsNumberBookmarkName(numberBookmark.Name) And numberBookmark.Name <> "_GoBack" Then Err.Raise vbObjectError + 7360, "Equation Lab", "The equation paragraph contains another bookmark; its layout was not changed."
        End If
        If IsNumberBookmarkName(numberBookmark.Name) Then
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
    equationReset = -1
    If numberCount > 0 Then
        ValidateExistingRibbonNumber Doc, paragraph, bookmarkName
        equationReset = NumberIncrementReset(Doc, Doc.Bookmarks(bookmarkName))
    End If
    contextChanged = (chapter <> 0 Or section <> 0)
    If contextChanged Then
        If chapter < 1 Or chapter > 32767 Or section < 1 Or section > 32767 Then Err.Raise vbObjectError + 7363, "Equation Lab", "Chapter and section must be between 1 and 32767."
        actualCounter = SequenceBeforePosition(Doc, oleStart, "ELChapter", foundCounter)
        If expectedChapter >= 0 And actualCounter <> expectedChapter Then Err.Raise vbObjectError + 7363, "Equation Lab", "Chapter changed in Word. Reopen the equation before saving."
        actualCounter = SequenceBeforePosition(Doc, oleStart, "ELSection", foundCounter)
        If expectedSection >= 0 And actualCounter <> expectedSection Then Err.Raise vbObjectError + 7363, "Equation Lab", "Section changed in Word. Reopen the equation before saving."
    End If

    Set bookmarkRange = Nothing
    If bookmarkName <> "" Then Set bookmarkRange = Doc.Bookmarks(bookmarkName).Range.Duplicate
    ValidateEquationParagraphRemainder Doc, paragraph, oleRange, bookmarkRange
    If Not bookmarkRange Is Nothing Then
        If Not contextChanged And patternOverride = "" And ((rightSide And bookmarkRange.Start >= oleEnd) Or ((Not rightSide) And bookmarkRange.End <= oleStart)) Then
            UpdateNumbersForDocument Doc
            NumberingChanged Doc
            ELInvalidateDocumentSnapshot
            Exit Sub
        End If
    End If

    Dim pattern As String
    If numberCount = 0 Or patternOverride <> "" Then
        If patternOverride <> "" Then pattern = patternOverride Else pattern = ELDocumentNumberFormat(Doc, oleStart)
        ValidateRibbonNumberFormat pattern
        If Not contextChanged Then RequireCounterContext Doc, pattern, oleStart
    End If
    ' Word must expose an isolated undo record before the first change.
    Set undoRecord = Application.UndoRecord
    ValidateNumberParagraphLayout paragraph
    ' Smart cut/paste can insert a space when the tab next to an OLE is
    ' removed. Disable it only for this synchronous range operation.
    oldSmartCutPaste = Options.SmartCutPaste
    Options.SmartCutPaste = False
    smartCutPasteChanged = True
    If contextChanged Then
        InsertNumberingContext Doc, paragraph.Start, chapter, section, changed
        fieldStart = RibbonEmbeddedEquationFieldStart(equationField, Doc)
        If fieldStart < 0 Then Err.Raise vbObjectError + 7360, "Equation Lab", "The equation moved while setting its chapter."
        Set oleRange = Doc.Range(fieldStart, equationField.Result.End + 1)
        oleStart = oleRange.Start: oleEnd = oleRange.End
    End If
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
        AddRibbonNumber Doc, insertion, pattern, changed, temporaryName, equationReset
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
    If contextChanged Then
        SavePreferenceForDocument Doc, "EquationLabChapter", CStr(chapter)
        SavePreferenceForDocument Doc, "EquationLabSection", CStr(section)
    End If
    NumberingChanged Doc
    ELInvalidateDocumentSnapshot
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

Private Function NumberingEquationParagraph(ByVal Doc As Document, ByVal equation As InlineShape) As Range
    Set NumberingEquationParagraph = PhysicalNumberingParagraph(Doc, equation.Range)
End Function

Private Function PhysicalNumberingParagraph(ByVal Doc As Document, ByVal scope As Range) As Range
    ' With hidden text off, Word can report the preceding hidden chapter marker
    ' as part of the equation's logical paragraph. Use real paragraph marks so
    ' a reset counter is never counted as an equation or deleted as whitespace.
    Dim logical As Range, character As Range, position As Long, start As Long, finish As Long
    Set logical = scope.Paragraphs(1).Range.Duplicate
    start = logical.Start: finish = logical.End
    If scope.Start - start > 16384 Or finish - scope.End > 16384 Then Err.Raise vbObjectError + 7360, "Equation Lab", "The equation paragraph boundary is too large to resolve safely."
    For position = scope.Start - 1 To start Step -1
        Set character = Doc.Range(position, position + 1)
        character.TextRetrievalMode.IncludeHiddenText = True
        character.TextRetrievalMode.IncludeFieldCodes = True
        If character.Text = Chr$(13) Then start = position + 1: Exit For
    Next
    For position = scope.End To finish - 1
        Set character = Doc.Range(position, position + 1)
        character.TextRetrievalMode.IncludeHiddenText = True
        character.TextRetrievalMode.IncludeFieldCodes = True
        If character.Text = Chr$(13) Then finish = position + 1: Exit For
    Next
    Set PhysicalNumberingParagraph = Doc.Range(start, finish)
End Function

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

Private Sub InsertNumberingContext(ByVal Doc As Document, ByVal beforePosition As Long, ByVal chapter As Long, ByVal section As Long, ByRef changed As Boolean)
    Dim marker As Range, field As Field, cursor As Long, codes As Variant, code As Variant
    Set marker = Doc.Range(beforePosition, beforePosition)
    marker.InsertBefore vbCr
    changed = True
    Set marker = Doc.Range(beforePosition, beforePosition + 1)
    ' Keep the paragraph end real even when hidden text is off. Only the
    ' fields are hidden; hiding this CR makes Word merge it with the equation.
    marker.Font.Hidden = False: marker.Font.Size = 1
    marker.ParagraphFormat.SpaceBefore = 0: marker.ParagraphFormat.SpaceAfter = 0
    marker.ParagraphFormat.LineSpacingRule = wdLineSpaceExactly: marker.ParagraphFormat.LineSpacing = 1
    codes = Array("ELChapter \r " & CStr(chapter) & " \h", "ELSection \r " & CStr(section) & " \h", "EquationLab \r 0 \h")
    For Each code In codes
        ' Hidden SEQ fields have an empty result and a different Result.End
        ' boundary. The retained paragraph mark is the insertion boundary.
        cursor = marker.End - 1
        Set field = Doc.Fields.Add(Range:=Doc.Range(cursor, cursor), Type:=wdFieldSequence, Text:=CStr(code), PreserveFormatting:=False)
        field.Result.Font.Hidden = True
    Next
End Sub

Private Sub RequireCounterContext(ByVal Doc As Document, ByVal pattern As String, ByVal beforePosition As Long)
    Dim found As Boolean, value As Long
    If InStr(1, pattern, "#C", vbBinaryCompare) > 0 Then
        value = SequenceBeforePosition(Doc, beforePosition, "MTChap", found)
        If Not found Or value < 1 Then Err.Raise vbObjectError + 7363, "Equation Lab", "Set Chapter/Section numbering before using a #C token."
    End If
    If InStr(1, pattern, "#S", vbBinaryCompare) > 0 Then
        value = SequenceBeforePosition(Doc, beforePosition, "MTSec", found)
        If Not found Or value < 1 Then Err.Raise vbObjectError + 7363, "Equation Lab", "Set Chapter/Section numbering before using a #S token."
    End If
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
    Set paragraph = NumberingEquationParagraph(Doc, equation)
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
            If Not ValidDisplaySequence(field) Or InStr(1, code, "\c", vbBinaryCompare) > 0 Then Err.Raise vbObjectError + 7362, "Equation Lab", "The existing equation counter is not a supported SEQ field."
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
    If Not IsNumberBookmarkName(numberBookmark.Name) Then Exit Function
    RibbonNumberFormat = NumberRangeFormat(Doc, numberBookmark.Range)
End Function

Private Function NumberRangeFormat(ByVal Doc As Document, ByVal numberRange As Range) As String
    On Error GoTo Unsupported
    Dim field As Field, span As Range, cursor As Long, start As Long, pattern As String
    Dim code As String, sequence As String, switchAt As Long, format As String, token As String
    Set span = numberRange.Duplicate
    If span.StoryType <> wdMainTextStory Or span.Paragraphs.Count <> 1 Then Exit Function
    cursor = span.Start
    For Each field In span.Fields
        start = field.Code.Start - 1
        If start < cursor Or start >= span.End Then Exit Function
        If Len(Doc.Range(start, start + 1).Text) > 0 And Doc.Range(start, start + 1).Text <> Chr$(19) Then Exit Function
        pattern = pattern & Doc.Range(cursor, start).Text
        code = Trim$(field.Code.Text)
        If Not ValidDisplaySequence(field) Then Exit Function
        sequence = UCase$(SharedSequenceName(FieldWord(code, 1)))
        Select Case sequence
            Case "MTCHAP": token = "#C"
            Case "MTSEC": token = "#S"
            Case "MTEQN": token = "#E"
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
    NumberRangeFormat = pattern
Unsupported:
End Function

Public Function ELNumberingRevision(ByVal Doc As Document) As Long
    On Error GoTo Missing
    Dim value As String
    value = PreferenceForDocument(Doc, "EquationLabNumberingRevision", "0")
    If IsNumeric(value) Then
        If CDbl(value) >= 0 And CDbl(value) <= 2147483646# And CDbl(value) = Fix(CDbl(value)) Then ELNumberingRevision = CLng(value)
    End If
Missing:
End Function

Private Sub NumberingChanged(ByVal Doc As Document)
    Dim revision As Long
    revision = ELNumberingRevision(Doc)
    If revision >= 2147483646 Then revision = 0
    SavePreferenceForDocument Doc, "EquationLabNumberingRevision", CStr(revision + 1)
    EquationLabDocumentContext.ELQueueWorkspaceRefresh
End Sub

Public Function ELStoredNumberFormat(ByVal Doc As Document) As String
    On Error GoTo Missing
    Dim pattern As String
    pattern = SharedDefaultFormat(Doc)
    If pattern = "" Then pattern = PreferenceForDocument(Doc, "EquationLabNumberFormat", "")
    If pattern <> "" Then ValidateRibbonNumberFormat pattern
    ELStoredNumberFormat = pattern
Missing:
End Function

Public Function ELDocumentNumberFormat(ByVal Doc As Document, ByVal beforePosition As Long) As String
    Dim pattern As String, bookmark As Bookmark, formats As Collection, counts As Collection
    Dim i As Long, found As Boolean, total As Long, bestCount As Long, closestStart As Long, closest As String
    pattern = SharedDefaultFormat(Doc)
    If pattern = "" Then pattern = PreferenceForDocument(Doc, "EquationLabNumberFormat", "")
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
    If count = 1 Then SaveSharedNumberFormat Doc, chosen
End Sub

' The completed fragment is already checked against the insertion ticket and
' Native bytes. Adopt its exact format without re-parsing freshly imported
' Word fields, whose live ranges may not have settled yet.
Public Sub ELAdoptInsertedNumberFormat(ByVal Doc As Document, ByVal pattern As String)
    ValidateRibbonNumberFormat pattern
    SaveSharedNumberFormat Doc, pattern
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

Private Sub AddRibbonNumber(ByVal Doc As Document, ByVal insertion As Range, ByVal pattern As String, ByRef changed As Boolean, ByRef bookmarkName As String, Optional ByVal equationReset As Long = -1)
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
            If token = "E" And equationReset >= 1 Then command = "\r " & CStr(equationReset)
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
    bookmarkName = "ZEqnNum" & CStr(100000 + CLng(Rnd() * 899999))
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

Private Function HiddenContextReset(ByVal field As Field) As Boolean
    Dim sequence As String, value As String
    If field.Locked Or UCase$(FieldWord(field.Code.Text, 0)) <> "SEQ" Then Exit Function
    sequence = UCase$(FieldWord(field.Code.Text, 1))
    If sequence <> "ELCHAPTER" And sequence <> "ELSECTION" And sequence <> "EQUATIONLAB" Then Exit Function
    If LCase$(FieldWord(field.Code.Text, 2)) <> "\r" Or LCase$(FieldWord(field.Code.Text, 4)) <> "\h" Or FieldWord(field.Code.Text, 5) <> "" Then Exit Function
    value = FieldWord(field.Code.Text, 3)
    If Not IsNumeric(value) Then Exit Function
    If CDbl(value) <> Fix(CDbl(value)) Or CDbl(value) < 0 Or CDbl(value) > 32767 Then Exit Function
    If sequence = "EQUATIONLAB" Then
        If CLng(value) <> 0 Then Exit Function
    ElseIf CLng(value) = 0 Then
        Exit Function
    End If
    HiddenContextReset = True
End Function

Private Function PhysicalContextParagraph(ByVal Doc As Document, ByVal first As Field) As Range
    Dim field As Field, start As Long, finish As Long, firstStart As Long, following As Boolean
    ' A legacy specVanish paragraph mark is omitted from Word's logical
    ' paragraph boundary. Bind the consecutive hidden reset fields instead.
    firstStart = first.Code.Start
    start = firstStart - 1: finish = first.Result.End
    For Each field In Doc.Fields
        If field.Code.Start = firstStart Then
            following = True
        ElseIf following Then
            If field.Code.Start - 1 <> finish Or Not HiddenContextReset(field) Then Exit For
            finish = field.Result.End
        End If
    Next
    If finish < Doc.Content.End Then Set PhysicalContextParagraph = Doc.Range(start, finish + 1)
End Function

Private Function ContextWhitespace(ByVal scope As Range) As Boolean
    Dim value As String, i As Long, ch As String
    value = scope.Text
    For i = 1 To Len(value)
        ch = Mid$(value, i, 1)
        If ch <> " " And ch <> vbTab And ch <> vbCr Then Exit Function
    Next
    ContextWhitespace = True
End Function

Private Function ManagedContextParagraph(ByVal Doc As Document, ByVal marker As Range) As Boolean
    Dim field As Field, chapter As Long, section As Long, equation As Long, cursor As Long, sequence As String
    If marker Is Nothing Then Exit Function
    If marker.Tables.Count <> 0 Or marker.InlineShapes.Count <> 0 Or marker.Bookmarks.Count <> 0 Or marker.Revisions.Count <> 0 Then Exit Function
    If marker.Fields.Count < 2 Or marker.Fields.Count > 3 Then Exit Function
    cursor = marker.Start
    For Each field In marker.Fields
        If Not HiddenContextReset(field) Then Exit Function
        If field.Code.Start - 1 < cursor Or field.Result.End > marker.End Then Exit Function
        If Not ContextWhitespace(Doc.Range(cursor, field.Code.Start - 1)) Then Exit Function
        sequence = UCase$(FieldWord(field.Code.Text, 1))
        Select Case sequence
            Case "ELCHAPTER": chapter = chapter + 1
            Case "ELSECTION": section = section + 1
            Case "EQUATIONLAB": equation = equation + 1
        End Select
        cursor = field.Result.End
    Next
    If Not ContextWhitespace(Doc.Range(cursor, marker.End)) Then Exit Function
    ManagedContextParagraph = (chapter = 1 And section = 1 And equation <= 1)
End Function

Private Function VisibleContextXML(ByVal marker As Range) As String
    Dim xml As String, field As Field, sequence As String, code As String
    xml = "<w:document xmlns:w=""http://schemas.openxmlformats.org/wordprocessingml/2006/main""><w:body><w:p><w:pPr><w:keepLines/><w:spacing w:before=""0"" w:after=""0"" w:line=""1"" w:lineRule=""exact""/><w:rPr><w:vanish w:val=""0""/><w:sz w:val=""2""/><w:specVanish w:val=""0""/></w:rPr></w:pPr>"
    For Each field In marker.Fields
        Select Case UCase$(FieldWord(field.Code.Text, 1))
            Case "ELCHAPTER": sequence = "ELChapter"
            Case "ELSECTION": sequence = "ELSection"
            Case "EQUATIONLAB": sequence = "EquationLab"
        End Select
        code = "SEQ " & sequence & " \r " & CStr(CLng(FieldWord(field.Code.Text, 3))) & " \h"
        xml = xml & "<w:r><w:rPr><w:vanish/></w:rPr><w:fldChar w:fldCharType=""begin""/></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:instrText>" & code & "</w:instrText></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:fldChar w:fldCharType=""end""/></w:r>"
    Next
    xml = xml & "</w:p></w:body></w:document>"
    VisibleContextXML = "<pkg:package xmlns:pkg=""http://schemas.microsoft.com/office/2006/xmlPackage""><pkg:part pkg:name=""/_rels/.rels"" pkg:contentType=""application/vnd.openxmlformats-package.relationships+xml""><pkg:xmlData><Relationships xmlns=""http://schemas.openxmlformats.org/package/2006/relationships""><Relationship Id=""rId1"" Type=""http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"" Target=""word/document.xml""/></Relationships></pkg:xmlData></pkg:part><pkg:part pkg:name=""/word/document.xml"" pkg:contentType=""application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml""><pkg:xmlData>" & xml & "</pkg:xmlData></pkg:part></pkg:package>"
End Function

Private Sub NormalizeContextParagraphMarks(ByVal Doc As Document)
    Dim field As Field, marker As Range, markers As Collection, lastStart As Long, i As Long
    Dim repaired As String, oldTracking As Boolean, trackingChanged As Boolean
    Dim undoRecord As Object, ownUndo As Boolean, changed As Boolean, beforeFields As Long, beforeObjects As Long, beforeLength As Long
    Dim failureNumber As Long, failureDescription As String, phase As String
    If Doc.ProtectionType <> wdNoProtection Then Exit Sub
    On Error GoTo Failed
    Set markers = New Collection: lastStart = -1
    For Each field In Doc.Fields
        phase = "reset-field"
        If HiddenContextReset(field) Then
            phase = "reset-range"
            Set marker = PhysicalContextParagraph(Doc, field)
            If Not marker Is Nothing Then
                phase = "range-validation"
                If marker.Start <> lastStart And ManagedContextParagraph(Doc, marker) Then
                    If marker.Paragraphs(1).Range.End <= marker.End Then GoTo NextField
                    markers.Add marker.Duplicate
                    lastStart = marker.Start
                End If
            End If
        End If
NextField:
    Next
    For i = markers.Count To 1 Step -1
        Set marker = markers(i)
        phase = "range-xml"
        repaired = VisibleContextXML(marker)
        If repaired <> "" Then
            If Not changed Then
                Set undoRecord = Application.UndoRecord
                If undoRecord.CustomRecordLevel = 0 Then undoRecord.StartCustomRecord "Equation Lab chapter boundary": ownUndo = True
                oldTracking = Doc.TrackRevisions
                If oldTracking Then Doc.TrackRevisions = False: trackingChanged = True
                beforeFields = Doc.Fields.Count: beforeObjects = Doc.InlineShapes.Count: beforeLength = Doc.Content.End
            End If
            phase = "range-repair"
            marker.InsertXML repaired
            changed = True
            If Doc.Fields.Count <> beforeFields Or Doc.InlineShapes.Count <> beforeObjects Then Err.Raise vbObjectError + 7373, "Equation Lab", "Word changed a chapter marker boundary; the operation was rolled back."
        End If
    Next
    If trackingChanged Then Doc.TrackRevisions = oldTracking
    If ownUndo Then undoRecord.EndCustomRecord
    Exit Sub
Failed:
    failureNumber = Err.Number: failureDescription = Err.Description
    On Error Resume Next
    ELWriteUtf8 WorkDirectory() & "numbering-context-error.txt", phase & ":" & CStr(failureNumber)
    If trackingChanged Then Doc.TrackRevisions = oldTracking
    If ownUndo Then
        undoRecord.EndCustomRecord
        If changed Or Doc.Content.End <> beforeLength Or Doc.Fields.Count <> beforeFields Or Doc.InlineShapes.Count <> beforeObjects Then Doc.Undo
    End If
    On Error GoTo 0
    Err.Raise failureNumber, "Equation Lab", failureDescription
End Sub

Private Sub UpdateNumbersForDocument(ByVal Doc As Document)
    Dim field As Field, fields As Collection, seen As Collection, showHidden As Boolean
    Dim failureNumber As Long, failureDescription As String
    showHidden = Doc.Bookmarks.ShowHidden
    On Error GoTo Failed
    Doc.Bookmarks.ShowHidden = True
    NormalizeContextParagraphMarks Doc
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
    NumberingChanged Doc
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

Private Function ReferenceDisplayText(ByVal value As String) As String
    Dim i As Long
    For i = 0 To 31
        value = Replace(value, Chr$(i), " ")
    Next
    value = Replace(value, ChrW$(127), " ")
    ReferenceDisplayText = Trim$(value)
End Function

Private Function ChooseReference(ByVal request As String) As String
    Dim status As Long, unit As Long, i As Long, value As String
    ELWriteUtf8 WorkDirectory() & "ribbon-reference-picker.txt", request
    status = EquationLabNativeCommand("MathTypeBridgeReferencePicker")
    On Error Resume Next
    Kill WorkDirectory() & "ribbon-reference-picker.txt"
    On Error GoTo 0
    If status = 1 Then Exit Function
    If status <> 0 Then Err.Raise vbObjectError + 7355, "Equation Lab", "The reference picker is unavailable or its target list is invalid. Update the Word component and restart Word."
    For i = 1 To 41
        unit = EquationLabNativeCommand("MathTypeBridgeReferencePickerNextChar")
        If unit = 0 Then Exit For
        If unit < 32 Or unit > 127 Then Err.Raise vbObjectError + 7355, "Equation Lab", "Invalid reference picker response."
        value = value & Chr$(unit)
    Next
    If i > 41 Or Len(value) = 0 Then Err.Raise vbObjectError + 7355, "Equation Lab", "Invalid reference picker response."
    ChooseReference = value
End Function

Private Sub InsertReference()
    Static showing As Boolean
    If showing Then Err.Raise vbObjectError + 7353, "Equation Lab", "A reference selection is already open."
    RequireDocument
    If Selection.Start <> Selection.End Then Err.Raise vbObjectError + 7353, "Equation Lab", "Place an empty cursor before inserting a reference."
    If EquationLabNativeCommand("MathTypeBridgeInsertionActive") <> 0 Or EquationLabNativeCommand("MathTypeBridgeTransportActive") <> 0 Then Err.Raise vbObjectError + 7353, "Equation Lab", "Finish or cancel the active equation before inserting a reference."
    Dim Doc As Document, candidate As Document, target As Range, selectedNumber As Range, context As Range
    Dim bookmark As Bookmark, list As String, answer As String, field As Field, i As Long, index As Long
    Dim names As Collection, anchors As Collection, starts As Collection, ends As Collection, originalTexts As Collection
    Dim originalStart As Long, originalEnd As Long, beforeLength As Long, title As String, nearby As String, isOpen As Boolean
    Dim oldShowHidden As Boolean, visibilityChanged As Boolean, undoRecord As UndoRecord, customUndo As Boolean, changed As Boolean
    Set Doc = Selection.Document
    Set target = Selection.Range.Duplicate
    originalStart = target.Start: originalEnd = target.End
    If Doc.ProtectionType <> wdNoProtection Then Err.Raise vbObjectError + 7353, "Equation Lab", "This document is protected."
    On Error GoTo Failed
    showing = True
    ELUpgradeNumberingForInterop Doc
    Set names = New Collection: Set anchors = New Collection
    Set starts = New Collection: Set ends = New Collection: Set originalTexts = New Collection
    oldShowHidden = Doc.Bookmarks.ShowHidden
    Doc.Bookmarks.ShowHidden = True: visibilityChanged = True
    For Each bookmark In Doc.Bookmarks
        If IsNumberBookmarkName(bookmark.Name) And bookmark.Range.StoryType = wdMainTextStory And RibbonNumberFormat(Doc, bookmark) <> "" Then
            If names.Count >= 2000 Then Err.Raise vbObjectError + 7353, "Equation Lab", "This document has too many reference targets for one selection."
            Set selectedNumber = bookmark.Range.Duplicate
            title = ReferenceDisplayText(selectedNumber.Text)
            If Len(title) = 0 Or Len(title) > 128 Then Err.Raise vbObjectError + 7353, "Equation Lab", "An equation reference target has invalid number text."
            Set context = selectedNumber.Paragraphs(1).Range.Duplicate
            context.SetRange IIf(context.Start > 180, context.Start - 180, 0), selectedNumber.Start
            nearby = ReferenceDisplayText(Right$(context.Text, 180))
            names.Add bookmark.Name: anchors.Add selectedNumber
            starts.Add selectedNumber.Start: ends.Add selectedNumber.End: originalTexts.Add selectedNumber.Text
            list = list & CStr(names.Count) & vbTab & bookmark.Name & vbTab & title & vbTab & nearby & vbLf
        End If
    Next
    Doc.Bookmarks.ShowHidden = oldShowHidden: visibilityChanged = False
    If names.Count = 0 Then
        MsgBox "No Equation Lab numbers are available for reference.", vbInformation, "Equation Lab"
        GoTo Done
    End If
    answer = ChooseReference("ELREF1" & vbLf & CStr(names.Count) & vbLf & list)
    If answer = "" Then GoTo Done
    For i = 1 To names.Count
        If StrComp(CStr(names(i)), answer, vbBinaryCompare) = 0 Then index = i: Exit For
    Next
    If index = 0 Then Err.Raise vbObjectError + 7354, "Equation Lab", "The selected reference was not in the captured target list."
    For Each candidate In Application.Documents
        If candidate Is Doc Then isOpen = True: Exit For
    Next
    If Not isOpen Then Err.Raise vbObjectError + 7354, "Equation Lab", "The original Word document has closed."
    If Doc.ReadOnly Or Doc.ProtectionType <> wdNoProtection Then Err.Raise vbObjectError + 7354, "Equation Lab", "The original document is no longer writable."
    If Not (Selection.Document Is Doc) Then Err.Raise vbObjectError + 7354, "Equation Lab", "The active document changed; no reference was inserted."
    If target.Start <> originalStart Or target.End <> originalEnd Or Selection.Start <> originalStart Or Selection.End <> originalEnd Or Selection.Range.StoryType <> wdMainTextStory Then Err.Raise vbObjectError + 7354, "Equation Lab", "The insertion cursor changed; no reference was inserted."
    If Not Doc.Bookmarks.Exists(answer) Then Err.Raise vbObjectError + 7354, "Equation Lab", "The selected reference target has disappeared."
    Set selectedNumber = Doc.Bookmarks(answer).Range.Duplicate
    Set context = anchors(index)
    If selectedNumber.StoryType <> wdMainTextStory Or selectedNumber.Start <> CLng(starts(index)) Or selectedNumber.End <> CLng(ends(index)) Or context.Start <> selectedNumber.Start Or context.End <> selectedNumber.End Or selectedNumber.Text <> CStr(originalTexts(index)) Then Err.Raise vbObjectError + 7354, "Equation Lab", "The selected reference target changed; no reference was inserted."
    If target.Start >= selectedNumber.Start And target.Start < selectedNumber.End Then Err.Raise vbObjectError + 7354, "Equation Lab", "Place the cursor outside the target equation number."
    Set undoRecord = Application.UndoRecord
    If undoRecord.CustomRecordLevel <> 0 Then Err.Raise vbObjectError + 7354, "Equation Lab", "Another Word edit is in progress."
    beforeLength = Doc.Content.End
    undoRecord.StartCustomRecord "Equation Lab equation reference": customUndo = True
    Set field = Doc.Fields.Add(Range:=target, Type:=wdFieldRef, Text:=answer & " \h \!", PreserveFormatting:=True)
    changed = True
    field.Update
    NumberingChanged Doc
    ELInvalidateDocumentSnapshot
    undoRecord.EndCustomRecord: customUndo = False
Done:
    showing = False
    Exit Sub
Failed:
    Dim failureNumber As Long, failureDescription As String
    failureNumber = Err.Number: failureDescription = Err.Description
    On Error Resume Next
    If visibilityChanged Then Doc.Bookmarks.ShowHidden = oldShowHidden
    If customUndo Then
        undoRecord.EndCustomRecord
        If changed Or Doc.Content.End <> beforeLength Then Doc.Undo
    End If
    Kill WorkDirectory() & "ribbon-reference-picker.txt"
    showing = False
    On Error GoTo 0
    Err.Raise failureNumber, "Equation Lab", failureDescription
End Sub

' Shared by the Ribbon and Word's assignable macro commands.
Public Sub UpdateNumbers()
    RequireDocument
    Dim Doc As Document
    Set Doc = ActiveDocument
    ELUpgradeNumberingForInterop Doc
    UpdateNumbersForDocument Doc
    NumberingChanged Doc
    ELInvalidateDocumentSnapshot
End Sub

Private Sub OpenNumberingSettings(ByVal chapterSettings As Boolean)
    RequireDocument
    Dim equation As InlineShape
    Set equation = EquationLabDocumentContext.ELSelectedEquation(Selection)
    If Not equation Is Nothing Then
        EditEquation
        NativeTool "Numbering"
    ElseIf EquationLabNativeCommand("MathTypeBridgeTransportActive") <> 0 Then
        ' A Word modal dialog would block the host callback needed to finish
        ' that edit. Keep the draft in its current editor instead.
        NativeTool "Numbering"
    ElseIf chapterSettings Then
        SetChapter
    Else
        SetNumberFormat
    End If
End Sub

Private Function PromptNumberingSettings(ByVal kind As String, ByVal first As String, Optional ByVal second As String = "") As String
    Dim status As Long, unit As Long, i As Long, value As String
    ELWriteUtf8 WorkDirectory() & "ribbon-numbering-prompt.txt", "ELNUM1" & vbLf & kind & vbLf & first & vbLf & second & vbLf
    status = EquationLabNativeCommand("MathTypeBridgeNumberingPrompt")
    If status = 1 Then Exit Function
    If status <> 0 Then Err.Raise vbObjectError + 7355, "Equation Lab", "The numbering dialog is unavailable. Update the Word component and restart Word."
    For i = 1 To 257
        unit = EquationLabNativeCommand("MathTypeBridgeNumberingPromptNextChar")
        If unit = 0 Then Exit For
        If unit < 0 Or unit > 65535 Then Err.Raise vbObjectError + 7355, "Equation Lab", "Invalid numbering dialog response."
        If unit > 32767 Then unit = unit - 65536
        value = value & ChrW$(unit)
    Next
    If i > 257 Then Err.Raise vbObjectError + 7355, "Equation Lab", "Numbering dialog response is too long."
    PromptNumberingSettings = value
End Function

Private Sub SetNumberFormat()
    RequireDocument
    Dim value As String, Doc As Document
    Set Doc = ActiveDocument
    value = PromptNumberingSettings("format", ELDocumentNumberFormat(Doc, Selection.Start))
    If value = "" Then Exit Sub
    If Not Doc Is ActiveDocument Then Err.Raise vbObjectError + 7355, "Equation Lab", "The Word document changed while the dialog was open."
    If Len(value) > 128 Or InStr(value, vbLf) > 0 Or InStr(value, vbCr) > 0 Then Err.Raise vbObjectError + 7355, "Equation Lab", "Invalid number format."
    ValidateRibbonNumberFormat value
    SaveSharedNumberFormat Doc, value
    NumberingChanged Doc
    ELInvalidateDocumentSnapshot
End Sub

Private Sub SetChapter()
    RequireDocument
    Dim chapter As String, section As String, response As String, parts() As String, Doc As Document, anchor As Range
    Set Doc = ActiveDocument
    Set anchor = Selection.Range.Duplicate
    If Selection.Start <> Selection.End Then Err.Raise vbObjectError + 7356, "Equation Lab", "Place an empty cursor before setting chapter and section."
    If EquationLabNativeCommand("MathTypeBridgeTransportActive") <> 0 Then Err.Raise vbObjectError + 7356, "Equation Lab", "Finish the active Equation Lab edit before starting a new chapter."
    response = PromptNumberingSettings("context", CurrentCounter("ELChapter", Preference("EquationLabChapter", "1")), CurrentCounter("ELSection", Preference("EquationLabSection", "1")))
    If response = "" Then Exit Sub
    parts = Split(response, vbLf)
    If UBound(parts) <> 1 Then Err.Raise vbObjectError + 7356, "Equation Lab", "Invalid chapter and section response."
    chapter = parts(0): section = parts(1)
    If Not Doc Is ActiveDocument Then Err.Raise vbObjectError + 7356, "Equation Lab", "The Word document changed while the dialog was open."
    If Selection.Start <> anchor.Start Or Selection.End <> anchor.End Then Err.Raise vbObjectError + 7356, "Equation Lab", "The Word cursor changed while the dialog was open."
    If Not IsNumeric(chapter) Or Not IsNumeric(section) Then Exit Sub
    If CDbl(chapter) < 1 Or CDbl(chapter) > 32767 Or CDbl(chapter) <> Fix(CDbl(chapter)) Or CDbl(section) < 1 Or CDbl(section) > 32767 Or CDbl(section) <> Fix(CDbl(section)) Then Exit Sub
    SavePreferenceForDocument Doc, "EquationLabChapter", CStr(CLng(chapter))
    SavePreferenceForDocument Doc, "EquationLabSection", CStr(CLng(section))
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

' Word and MathType share one SEQ chain. These helpers rewrite only bounded
' number/context ranges; the equation's EMBED/OLE range is never imported.
Private Function NumberXMLText(ByVal value As String) As String
    value = Replace(value, "&", "&amp;")
    value = Replace(value, "<", "&lt;"): value = Replace(value, ">", "&gt;")
    NumberXMLText = Replace(value, Chr$(34), "&quot;")
End Function

Private Function NumberXMLRun(ByVal value As String, ByVal instruction As Boolean) As String
    Dim tag As String
    If instruction Then tag = "instrText" Else tag = "t"
    NumberXMLRun = "<w:r><w:" & tag & " xml:space=""preserve"">" & NumberXMLText(value) & "</w:" & tag & "></w:r>"
End Function

Private Function NumberXMLField(ByVal code As String, ByVal cached As String, ByVal instructionResult As Boolean, Optional ByVal hidden As Boolean = False) As String
    Dim props As String, xml As String
    If hidden Then props = "<w:rPr><w:vanish/></w:rPr>"
    xml = "<w:r>" & props & "<w:fldChar w:fldCharType=""begin""/></w:r><w:r>" & props & "<w:instrText xml:space=""preserve""> " & NumberXMLText(code) & " </w:instrText></w:r>"
    If Not hidden Then xml = xml & "<w:r><w:fldChar w:fldCharType=""separate""/></w:r>" & NumberXMLRun(cached, instructionResult)
    NumberXMLField = xml & "<w:r>" & props & "<w:fldChar w:fldCharType=""end""/></w:r>"
End Function

Private Function NumberXMLPackage(ByVal contents As String, Optional ByVal paragraphProperties As String = "") As String
    NumberXMLPackage = "<pkg:package xmlns:pkg=""http://schemas.microsoft.com/office/2006/xmlPackage""><pkg:part pkg:name=""/_rels/.rels"" pkg:contentType=""application/vnd.openxmlformats-package.relationships+xml""><pkg:xmlData><Relationships xmlns=""http://schemas.openxmlformats.org/package/2006/relationships""><Relationship Id=""rId1"" Type=""http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"" Target=""word/document.xml""/></Relationships></pkg:xmlData></pkg:part><pkg:part pkg:name=""/word/document.xml"" pkg:contentType=""application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml""><pkg:xmlData><w:document xmlns:w=""http://schemas.openxmlformats.org/wordprocessingml/2006/main""><w:body><w:p>" & paragraphProperties & contents & "</w:p></w:body></w:document></pkg:xmlData></pkg:part></pkg:package>"
End Function

Private Function CounterDisplay(ByVal value As Long, ByVal format As String) As String
    Dim letters As Variant, weights As Variant, i As Long, result As String, remaining As Long
    If value < 1 Or value > 32767 Then Err.Raise vbObjectError + 7374, "Equation Lab", "The number counter is unavailable."
    Select Case format
        Case "1": CounterDisplay = CStr(value): Exit Function
        Case "A", "a"
            result = String$(((value - 1) \ 26) + 1, Chr$(65 + (value - 1) Mod 26))
            If format = "a" Then result = LCase$(result)
            CounterDisplay = result: Exit Function
        Case "I", "i"
            If value > 3999 Then Err.Raise vbObjectError + 7374, "Equation Lab", "The Roman number exceeds 3999."
            letters = Array("M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I")
            weights = Array(1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1)
            remaining = value
            For i = 0 To UBound(weights)
                Do While remaining >= CLng(weights(i))
                    result = result & CStr(letters(i)): remaining = remaining - CLng(weights(i))
                Loop
            Next
            If format = "i" Then result = LCase$(result)
            CounterDisplay = result
    End Select
End Function

Private Function NumberRangeXML(ByVal pattern As String, ByVal bookmarkName As String, ByVal chapter As Long, ByVal section As Long, ByVal equationNumber As Long, ByVal sharedCounters As Boolean, Optional ByVal equationReset As Long = -1) As String
    ValidateRibbonNumberFormat pattern
    Dim i As Long, literalStart As Long, token As String, format As String, formatName As String
    Dim sequence As String, value As Long, contents As String, command As String
    literalStart = 1: i = 1
    Do While i <= Len(pattern)
        If Mid$(pattern, i, 1) = "#" Then
            If i > literalStart Then contents = contents & NumberXMLRun(Mid$(pattern, literalStart, i - literalStart), sharedCounters)
            token = Mid$(pattern, i + 1, 1): format = Mid$(pattern, i + 2, 1)
            Select Case token
                Case "C": value = chapter: sequence = "ELChapter": command = "\c"
                Case "S": value = section: sequence = "ELSection": command = "\c"
                Case "E": value = equationNumber: sequence = "EquationLab": command = "\n"
            End Select
            If token = "E" And equationReset >= 1 Then command = "\r " & CStr(equationReset)
            If sharedCounters Then sequence = SharedSequenceName(sequence): command = "\c"
            Select Case format
                Case "1": formatName = "ARABIC"
                Case "A": formatName = "ALPHABETIC"
                Case "a": formatName = "alphabetic"
                Case "I": formatName = "ROMAN"
                Case "i": formatName = "roman"
            End Select
            contents = contents & NumberXMLField("SEQ " & sequence & " " & command & " \* " & formatName, CounterDisplay(value, format), sharedCounters)
            i = i + 3: literalStart = i
        Else
            i = i + 1
        End If
    Loop
    If literalStart <= Len(pattern) Then contents = contents & NumberXMLRun(Mid$(pattern, literalStart), sharedCounters)
    contents = "<w:bookmarkStart w:id=""0"" w:name=""" & NumberXMLText(bookmarkName) & """/>" & contents & "<w:bookmarkEnd w:id=""0""/>"
    If sharedCounters Then
        command = "\n"
        If equationReset >= 1 Then command = "\r " & CStr(equationReset)
        contents = "<w:r><w:fldChar w:fldCharType=""begin""/></w:r>" & NumberXMLRun(" MACROBUTTON MTPlaceRef ", True) & NumberXMLField("SEQ MTEqn " & command & " \h", "", True, True) & contents & "<w:r><w:fldChar w:fldCharType=""end""/></w:r>"
    End If
    NumberRangeXML = NumberXMLPackage(contents)
End Function

Private Function IsNumberBookmarkName(ByVal name As String) As Boolean
    IsNumberBookmarkName = (UCase$(Left$(name, 3)) = "EL_" Or UCase$(Left$(name, 7)) = "ZEQNNUM")
End Function

Private Sub ReplaceNumberXML(ByVal Doc As Document, ByVal target As Range, ByVal pattern As String, ByVal name As String, ByVal chapter As Long, ByVal section As Long, ByVal equationNumber As Long, ByVal sharedCounters As Boolean, ByRef changed As Boolean, Optional ByVal equationReset As Long = -1)
    Dim paragraph As Range, formatting As ParagraphFormat, font As Font, style As Variant, inserted As Range
    Dim beforeObjects As Long, beforeParagraphs As Long, xml As String
    Dim other As Bookmark, showHidden As Boolean, atParagraphStart As Boolean, oldSmartCutPaste As Boolean
    Dim failureNumber As Long, failureDescription As String
    If target.StoryType <> wdMainTextStory Or target.Paragraphs.Count <> 1 Or target.Tables.Count <> 0 Or target.Revisions.Count <> 0 Or target.ContentControls.Count <> 0 Or target.InlineShapes.Count <> 0 Then Err.Raise vbObjectError + 7374, "Equation Lab", "The number range contains unsupported content."
    showHidden = Doc.Bookmarks.ShowHidden
    oldSmartCutPaste = Options.SmartCutPaste
    On Error GoTo Failed
    Doc.Bookmarks.ShowHidden = True
    For Each other In Doc.Bookmarks
        If other.Name <> name And other.Name <> "_GoBack" And other.Range.Start < target.End And other.Range.End > target.Start Then
            Doc.Bookmarks.ShowHidden = showHidden
            Err.Raise vbObjectError + 7374, "Equation Lab", "Another reference bookmark overlaps the number."
        End If
    Next
    Doc.Bookmarks.ShowHidden = showHidden
    Set paragraph = PhysicalNumberingParagraph(Doc, target)
    atParagraphStart = (target.Start = paragraph.Start)
    Set formatting = paragraph.ParagraphFormat.Duplicate: Set font = Doc.Bookmarks(name).Range.Font.Duplicate
    style = paragraph.Style
    beforeObjects = Doc.InlineShapes.Count: beforeParagraphs = Doc.Paragraphs.Count
    xml = NumberRangeXML(pattern, name, chapter, section, equationNumber, sharedCounters, equationReset)
    changed = True
    Options.SmartCutPaste = False
    target.InsertXML xml
    ' At the start of a paragraph Word can retain the imported Flat OPC
    ' paragraph end. Remove only that newly created, number-only boundary.
    If atParagraphStart And Doc.InlineShapes.Count = beforeObjects And Doc.Paragraphs.Count = beforeParagraphs + 1 And Doc.Bookmarks.Exists(name) Then
        Set paragraph = PhysicalNumberingParagraph(Doc, Doc.Bookmarks(name).Range)
        Set inserted = NumberEnvelope(Doc, Doc.Bookmarks(name))
        If inserted.Start = paragraph.Start And inserted.End = paragraph.End - 1 And paragraph.InlineShapes.Count = 0 Then
            If Doc.Range(paragraph.End - 1, paragraph.End).Text = vbCr Then Doc.Range(paragraph.End - 1, paragraph.End).Delete
        End If
    End If
    If Doc.InlineShapes.Count <> beforeObjects Or Doc.Paragraphs.Count <> beforeParagraphs Or Not Doc.Bookmarks.Exists(name) Then Err.Raise vbObjectError + 7374, "Equation Lab", "Word changed the number boundary; the operation was rolled back."
    Set paragraph = PhysicalNumberingParagraph(Doc, Doc.Bookmarks(name).Range)
    paragraph.Style = style: paragraph.ParagraphFormat = formatting
    Doc.Bookmarks(name).Range.Font = font
    Options.SmartCutPaste = oldSmartCutPaste
    Exit Sub
Failed:
    failureNumber = Err.Number: failureDescription = Err.Description
    On Error Resume Next
    Doc.Bookmarks.ShowHidden = showHidden
    Options.SmartCutPaste = oldSmartCutPaste
    On Error GoTo 0
    Err.Raise failureNumber, "Equation Lab", failureDescription
End Sub

Private Function NumberEnvelope(ByVal Doc As Document, ByVal bookmark As Bookmark) As Range
    Dim field As Field, span As Range, found As Field
    Set span = bookmark.Range.Duplicate
    For Each field In span.Paragraphs(1).Range.Fields
        If UCase$(FieldWord(field.Code.Text, 0)) = "MACROBUTTON" And UCase$(FieldWord(field.Code.Text, 1)) = "MTPLACEREF" Then
            If field.Code.Start <= span.Start And field.Code.End >= span.End Then
                If Not found Is Nothing Then Err.Raise vbObjectError + 7374, "Equation Lab", "Several number envelopes overlap."
                Set found = field
            End If
        End If
    Next
    If found Is Nothing Then
        Set NumberEnvelope = span
    Else
        ValidateSharedNumberEnvelope Doc, found, bookmark.Range
        Set NumberEnvelope = Doc.Range(found.Code.Start - 1, NumberEnvelopeEnd(Doc, found))
    End If
End Function

Private Function NumberEnvelopeEnd(ByVal Doc As Document, ByVal field As Field) As Long
    Dim position As Long, finish As Long, character As Range
    ' An unseparated MACROBUTTON has no result: Result.End can already be
    ' after its end delimiter. Locate the delimiter rather than adding one
    ' and accidentally consuming the following tab or paragraph mark.
    finish = field.Result.End + 1
    If finish >= Doc.Content.End Then finish = Doc.Content.End - 1
    If finish - field.Code.End > 512 Then Err.Raise vbObjectError + 7374, "Equation Lab", "The number envelope boundary is unavailable."
    For position = field.Code.End To finish
        Set character = Doc.Range(position, position + 1)
        character.TextRetrievalMode.IncludeHiddenText = True
        character.TextRetrievalMode.IncludeFieldCodes = True
        If character.Text = Chr$(21) Then NumberEnvelopeEnd = position + 1: Exit Function
    Next
    If field.Code.End > field.Code.Start Then
        Set character = Doc.Range(field.Code.End - 1, field.Code.End)
        character.TextRetrievalMode.IncludeHiddenText = True
        character.TextRetrievalMode.IncludeFieldCodes = True
        If character.Text = Chr$(21) Then NumberEnvelopeEnd = field.Code.End: Exit Function
    End If
    Err.Raise vbObjectError + 7374, "Equation Lab", "The number envelope end delimiter is unavailable."
End Function

Private Sub SaveSharedNumberFormat(ByVal Doc As Document, ByVal pattern As String)
    ValidateRibbonNumberFormat pattern
    SavePreferenceForDocument Doc, "EquationLabNumberFormat", pattern
    On Error GoTo AddProperty
    Doc.CustomDocumentProperties("MTEquationNumber2").Value = pattern
    Exit Sub
AddProperty:
    Err.Clear
    Doc.CustomDocumentProperties.Add Name:="MTEquationNumber2", LinkToContent:=False, Type:=msoPropertyTypeString, value:=pattern
End Sub

Private Function SharedContextXML(ByVal chapter As Long, ByVal section As Long, ByVal resetEquation As Boolean) As String
    Dim contents As String, props As String
    contents = "<w:r><w:fldChar w:fldCharType=""begin""/></w:r>" & NumberXMLRun(" MACROBUTTON MTEditEquationSection2 ", True)
    contents = contents & NumberXMLField("SEQ MTChap \r " & CStr(chapter) & " \h", "", True, True)
    contents = contents & NumberXMLField("SEQ MTSec \r " & CStr(section) & " \h", "", True, True)
    If resetEquation Then contents = contents & NumberXMLField("SEQ MTEqn \r 0 \h", "", True, True)
    contents = contents & "<w:r><w:fldChar w:fldCharType=""end""/></w:r>"
    props = "<w:pPr><w:keepNext w:val=""0""/><w:spacing w:before=""0"" w:after=""0"" w:line=""1"" w:lineRule=""exact""/><w:rPr><w:vanish w:val=""0""/><w:sz w:val=""2""/><w:specVanish w:val=""0""/></w:rPr></w:pPr>"
    SharedContextXML = NumberXMLPackage(contents, props)
End Function

Private Sub UpgradeLegacyNumbering(ByVal Doc As Document, ByRef changed As Boolean)
    Dim fields As Collection, seen As Collection, names As Collection, patterns As Collection, markers As Collection
    Dim field As Field, bookmark As Bookmark, marker As Range, span As Range, pattern As String, legacy As Boolean
    Dim i As Long, chapter As Long, section As Long, equationNumber As Long, equationReset As Long, found As Boolean, sequence As String, reset As Boolean
    Dim showHidden As Boolean, lastStart As Long
    Set fields = New Collection: Set seen = New Collection
    Set names = New Collection: Set patterns = New Collection: Set markers = New Collection
    CollectEquationFields Doc.Content, fields, seen, 0
    For Each field In fields
        sequence = UCase$(FieldWord(field.Code.Text, 1))
        If UCase$(FieldWord(field.Code.Text, 0)) = "SEQ" And (sequence = "EQUATIONLAB" Or sequence = "ELCHAPTER" Or sequence = "ELSECTION") Then
            If field.Locked Or field.Code.Revisions.Count > 0 Or field.Result.Revisions.Count > 0 Then Err.Raise vbObjectError + 7374, "Equation Lab", "A locked or tracked legacy number cannot be synchronized."
            legacy = True
        End If
    Next
    If Not legacy Then Exit Sub
    showHidden = Doc.Bookmarks.ShowHidden
    On Error GoTo Failed
    Doc.Bookmarks.ShowHidden = True
    For Each bookmark In Doc.Bookmarks
        If IsNumberBookmarkName(bookmark.Name) Then
            legacy = False
            For Each field In bookmark.Range.Fields
                If UCase$(FieldWord(field.Code.Text, 1)) = "EQUATIONLAB" Then legacy = True
            Next
            If legacy Then
                pattern = RibbonNumberFormat(Doc, bookmark)
                If pattern = "" Then Err.Raise vbObjectError + 7374, "Equation Lab", "A legacy number needs a valid, bounded format before synchronization."
                names.Add bookmark.Name: patterns.Add pattern
            End If
        End If
    Next
    lastStart = -1
    For Each field In Doc.Fields
        If HiddenContextReset(field) And UCase$(FieldWord(field.Code.Text, 1)) = "ELCHAPTER" Then
            Set marker = PhysicalContextParagraph(Doc, field)
            If marker Is Nothing Then Err.Raise vbObjectError + 7374, "Equation Lab", "A chapter marker boundary is unavailable."
            If marker.Start <> lastStart Then
                If Not ManagedContextParagraph(Doc, marker) Then Err.Raise vbObjectError + 7374, "Equation Lab", "The chapter marker contains custom content."
                markers.Add marker.Duplicate: lastStart = marker.Start
            End If
        End If
    Next
    ' All ranges have been validated before the first mutation.
    For i = markers.Count To 1 Step -1
        Set marker = markers(i): chapter = 0: section = 0: reset = False
        For Each field In marker.Fields
            Select Case UCase$(FieldWord(field.Code.Text, 1))
                Case "ELCHAPTER": chapter = CLng(FieldWord(field.Code.Text, 3))
                Case "ELSECTION": section = CLng(FieldWord(field.Code.Text, 3))
                Case "EQUATIONLAB": reset = True
            End Select
        Next
        If chapter < 1 Or section < 1 Then Err.Raise vbObjectError + 7374, "Equation Lab", "The chapter marker is incomplete."
        changed = True
        marker.InsertXML SharedContextXML(chapter, section, reset)
    Next
    Set fields = New Collection: Set seen = New Collection
    CollectEquationFields Doc.Content, fields, seen, 0
    For Each field In fields
        If UCase$(FieldWord(field.Code.Text, 0)) = "SEQ" Then
            sequence = FieldWord(field.Code.Text, 1)
            Select Case UCase$(sequence)
                Case "EQUATIONLAB", "ELCHAPTER", "ELSECTION"
                    changed = True
                    field.Code.Text = Replace(field.Code.Text, sequence, SharedSequenceName(sequence), 1, 1, vbBinaryCompare)
            End Select
        End If
    Next
    For i = names.Count To 1 Step -1
        Set bookmark = Doc.Bookmarks(CStr(names(i))): Set span = bookmark.Range.Duplicate
        equationReset = NumberIncrementReset(Doc, bookmark)
        equationNumber = SequenceBeforePosition(Doc, span.End, "MTEqn", found)
        chapter = SequenceBeforePosition(Doc, span.Start, "MTChap", found): If chapter < 1 Then chapter = 1
        section = SequenceBeforePosition(Doc, span.Start, "MTSec", found): If section < 1 Then section = 1
        ReplaceNumberXML Doc, span, CStr(patterns(i)), CStr(names(i)), chapter, section, equationNumber, True, changed, equationReset
    Next
    Doc.Bookmarks.ShowHidden = showHidden
    Exit Sub
Failed:
    Dim failureNumber As Long, failureDescription As String
    failureNumber = Err.Number: failureDescription = Err.Description
    On Error Resume Next
    Doc.Bookmarks.ShowHidden = showHidden
    On Error GoTo 0
    Err.Raise failureNumber, "Equation Lab", failureDescription
End Sub

Private Sub UnwrapSelectedSharedNumber(ByVal Doc As Document, ByVal equation As InlineShape, ByRef changed As Boolean)
    Dim bookmark As Bookmark, target As Bookmark, paragraph As Range, envelope As Range
    Dim pattern As String, chapter As Long, section As Long, equationNumber As Long, equationReset As Long, found As Boolean
    Set paragraph = NumberingEquationParagraph(Doc, equation)
    EnsureSharedNumberBookmark Doc, equation, changed
    For Each bookmark In Doc.Bookmarks
        If IsNumberBookmarkName(bookmark.Name) And bookmark.Range.Start >= paragraph.Start And bookmark.Range.End <= paragraph.End Then
            Set envelope = NumberEnvelope(Doc, bookmark)
            If envelope.Start < bookmark.Range.Start Then
                If Not target Is Nothing Then Err.Raise vbObjectError + 7374, "Equation Lab", "Several equation numbers share this paragraph."
                Set target = bookmark
            End If
        End If
    Next
    If target Is Nothing Then Exit Sub
    pattern = RibbonNumberFormat(Doc, target)
    If pattern = "" Then Err.Raise vbObjectError + 7374, "Equation Lab", "The MathType number format is unavailable."
    Set envelope = NumberEnvelope(Doc, target)
    equationReset = NumberIncrementReset(Doc, target)
    equationNumber = SequenceBeforePosition(Doc, envelope.End, "MTEqn", found)
    chapter = SequenceBeforePosition(Doc, envelope.Start, "MTChap", found): If chapter < 1 Then chapter = 1
    section = SequenceBeforePosition(Doc, envelope.Start, "MTSec", found): If section < 1 Then section = 1
    ReplaceNumberXML Doc, envelope, pattern, target.Name, chapter, section, equationNumber, False, changed, equationReset
End Sub

' Native MathType adds a ZEqnNum bookmark when the number is first referenced.
' Before that, anchor only the validated display, keeping its hidden increment
' outside the REF target. Adding an anchor never replaces an equation or field.
Private Sub EnsureSharedNumberBookmark(ByVal Doc As Document, ByVal equation As InlineShape, ByRef changed As Boolean)
    Dim paragraph As Range, field As Field, outer As Field, increment As Field, span As Range
    Dim bookmark As Bookmark, name As String, hidden As Long, pattern As String, showHidden As Boolean
    Dim failureNumber As Long, failureDescription As String
    Set paragraph = NumberingEquationParagraph(Doc, equation)
    For Each field In paragraph.Fields
        If UCase$(FieldWord(field.Code.Text, 0)) = "MACROBUTTON" And UCase$(FieldWord(field.Code.Text, 1)) = "MTPLACEREF" Then
            If Not outer Is Nothing Then Err.Raise vbObjectError + 7374, "Equation Lab", "Several equation numbers share this paragraph."
            Set outer = field
        End If
    Next
    If outer Is Nothing Then Exit Sub
    If paragraph.InlineShapes.Count <> 1 Or paragraph.Revisions.Count <> 0 Or paragraph.ContentControls.Count <> 0 Then Err.Raise vbObjectError + 7374, "Equation Lab", "The equation number does not have a single editable target."
    showHidden = Doc.Bookmarks.ShowHidden
    On Error GoTo Failed
    Doc.Bookmarks.ShowHidden = True
    For Each bookmark In Doc.Bookmarks
        If IsNumberBookmarkName(bookmark.Name) And bookmark.Range.Start >= outer.Code.Start And bookmark.Range.End <= outer.Code.End Then
            Doc.Bookmarks.ShowHidden = showHidden
            Exit Sub
        End If
    Next
    For Each field In outer.Code.Fields
        If ValidDisplaySequence(field, True) Then hidden = hidden + 1: Set increment = field
    Next
    If hidden <> 1 Then Err.Raise vbObjectError + 7374, "Equation Lab", "The MathType number needs exactly one hidden increment."
    Set span = Doc.Range(NumberEnvelopeEnd(Doc, increment), outer.Code.End)
    ValidateSharedNumberEnvelope Doc, outer, span
    pattern = NumberRangeFormat(Doc, span)
    If pattern = "" Then Err.Raise vbObjectError + 7374, "Equation Lab", "The MathType number format is unavailable."
    For Each bookmark In Doc.Bookmarks
        If bookmark.Name <> "_GoBack" And bookmark.Range.Start < span.End And bookmark.Range.End > span.Start Then Err.Raise vbObjectError + 7374, "Equation Lab", "Another reference bookmark overlaps the number."
    Next
    Randomize
    name = "ZEqnNum" & CStr(100000 + CLng(Rnd() * 899999))
    Do While Doc.Bookmarks.Exists(name): name = name & "X": Loop
    changed = True
    Doc.Bookmarks.Add Name:=name, Range:=span
    Doc.Bookmarks.ShowHidden = showHidden
    Exit Sub
Failed:
    failureNumber = Err.Number: failureDescription = Err.Description
    On Error Resume Next
    Doc.Bookmarks.ShowHidden = showHidden
    On Error GoTo 0
    Err.Raise failureNumber, "Equation Lab", failureDescription
End Sub

Public Sub ELUpgradeNumberingForInterop(ByVal Doc As Document)
    Dim record As UndoRecord, changed As Boolean, own As Boolean, futureFormat As String, equation As InlineShape
    On Error GoTo Failed
    If Doc.ReadOnly Or Doc.ProtectionType <> wdNoProtection Then Err.Raise vbObjectError + 7374, "Equation Lab", "The document is not writable."
    If Doc.TrackRevisions Then
        If HasLegacyNumbering(Doc) Then Err.Raise vbObjectError + 7374, "Equation Lab", "Turn off Track Changes before synchronizing legacy equation numbers."
        Exit Sub
    End If
    Set record = Application.UndoRecord
    If record.CustomRecordLevel <> 0 Then Err.Raise vbObjectError + 7374, "Equation Lab", "Another Word edit is in progress."
    futureFormat = ELDocumentNumberFormat(Doc, Doc.Content.End)
    record.StartCustomRecord "Equation Lab shared numbering": own = True
    UpgradeLegacyNumbering Doc, changed
    For Each equation In Doc.InlineShapes
        If IsEquation(equation) Then EnsureSharedNumberBookmark Doc, equation, changed
    Next
    If changed Then
        UpdateNumbersForDocument Doc
        SaveSharedNumberFormat Doc, futureFormat
        NumberingChanged Doc: ELInvalidateDocumentSnapshot
    End If
    If own Then record.EndCustomRecord
    Exit Sub
Failed:
    Dim failureNumber As Long, failureDescription As String
    failureNumber = Err.Number: failureDescription = Err.Description
    On Error Resume Next
    If own Then
        record.EndCustomRecord
        If changed Then Doc.Undo
    End If
    On Error GoTo 0
    Err.Raise failureNumber, "Equation Lab", failureDescription
End Sub

Private Function ValidDisplaySequence(ByVal field As Field, Optional ByVal hiddenIncrement As Boolean = False) As Boolean
    Dim code As String, parts() As String, i As Long, role As String, mode As String, hide As Boolean, formatCount As Long
    If field.Locked Or field.Code.Fields.Count <> 0 Or field.Result.Fields.Count <> 0 Then Exit Function
    code = Replace(Replace(Replace(Trim$(field.Code.Text), vbTab, " "), vbCr, " "), vbLf, " ")
    Do While InStr(code, "  ") > 0: code = Replace(code, "  ", " "): Loop
    parts = Split(code, " ")
    If UBound(parts) < 1 Then Exit Function
    If UCase$(parts(0)) <> "SEQ" Then Exit Function
    role = UCase$(SharedSequenceName(parts(1)))
    If role <> "MTEQN" And role <> "MTCHAP" And role <> "MTSEC" Then Exit Function
    i = 2
    Do While i <= UBound(parts)
        Select Case UCase$(parts(i))
            Case "\N", "\C"
                If mode <> "" Then Exit Function
                mode = UCase$(parts(i))
            Case "\R"
                If mode <> "" Or i = UBound(parts) Then Exit Function
                i = i + 1
                If Not IsNumeric(parts(i)) Then Exit Function
                If CDbl(parts(i)) < 1 Or CDbl(parts(i)) > 32767 Or CDbl(parts(i)) <> Fix(CDbl(parts(i))) Then Exit Function
                mode = "\R"
            Case "\H"
                If hide Then Exit Function
                hide = True
            Case "\*"
                If i = UBound(parts) Then Exit Function
                i = i + 1
                Select Case UCase$(parts(i))
                    Case "ARABIC", "ALPHABETIC", "ROMAN"
                        formatCount = formatCount + 1
                        If formatCount > 1 Then Exit Function
                    Case "MERGEFORMAT", "CHARFORMAT"
                    Case Else: Exit Function
                End Select
            Case Else: Exit Function
        End Select
        i = i + 1
    Loop
    If hiddenIncrement Then
        If role <> "MTEQN" Or Not hide Or mode = "\C" Or formatCount > 0 Then Exit Function
    Else
        If hide Then Exit Function
        If role <> "MTEQN" And mode <> "\C" Then Exit Function
    End If
    ValidDisplaySequence = True
End Function

Private Function CodeRangeText(ByVal scope As Range) As String
    Dim retained As Range, value As String
    Set retained = scope.Duplicate
    retained.TextRetrievalMode.IncludeFieldCodes = False
    retained.TextRetrievalMode.IncludeHiddenText = False
    value = Replace(Replace(Replace(retained.Text, vbTab, " "), vbCr, " "), vbLf, " ")
    Do While InStr(value, "  ") > 0: value = Replace(value, "  ", " "): Loop
    CodeRangeText = Trim$(value)
End Function

Private Sub ValidateSharedNumberEnvelope(ByVal Doc As Document, ByVal outer As Field, ByVal numberRange As Range)
    Dim field As Field, hidden As Long, prefix As String, span As Range
    Set span = numberRange.Duplicate
    If outer.Locked Or outer.Code.Revisions.Count <> 0 Or outer.Result.Revisions.Count <> 0 Then Err.Raise vbObjectError + 7374, "Equation Lab", "The number envelope is locked or tracked."
    prefix = UCase$(CodeRangeText(Doc.Range(outer.Code.Start, span.Start)))
    If prefix <> "MACROBUTTON MTPLACEREF" And prefix <> "MACROBUTTON MTPLACEREF \* MERGEFORMAT" And prefix <> "MACROBUTTON MTPLACEREF \* CHARFORMAT" Then Err.Raise vbObjectError + 7374, "Equation Lab", "The MathType number has custom content before its bookmark."
    If CodeRangeText(Doc.Range(span.End, outer.Code.End)) <> "" Then Err.Raise vbObjectError + 7374, "Equation Lab", "The MathType number has custom content after its bookmark."
    For Each field In outer.Code.Fields
        If field.Code.Start < span.Start Then
            If Not ValidDisplaySequence(field, True) Then Err.Raise vbObjectError + 7374, "Equation Lab", "The MathType number has an unsupported hidden counter."
            hidden = hidden + 1
        ElseIf field.Code.Start >= span.Start And field.Result.End < span.End Then
            If Not ValidDisplaySequence(field) Then Err.Raise vbObjectError + 7374, "Equation Lab", "The MathType number contains an unsupported field."
        Else
            Err.Raise vbObjectError + 7374, "Equation Lab", "A field crosses the MathType number boundary."
        End If
    Next
    If hidden <> 1 Then Err.Raise vbObjectError + 7374, "Equation Lab", "The MathType number needs exactly one hidden increment."
End Sub

Private Function NumberIncrementReset(ByVal Doc As Document, ByVal bookmark As Bookmark) As Long
    Dim envelope As Range, field As Field, scope As Range, nested As Field, i As Long, value As String
    NumberIncrementReset = -1
    Set envelope = NumberEnvelope(Doc, bookmark)
    Set scope = bookmark.Range.Duplicate
    If envelope.Start < scope.Start Then
        For Each field In scope.Paragraphs(1).Range.Fields
            If field.Code.Start - 1 = envelope.Start Then Set scope = field.Code.Duplicate: Exit For
        Next
    End If
    For Each nested In scope.Fields
        If UCase$(FieldWord(nested.Code.Text, 0)) = "SEQ" And SharedSequenceName(FieldWord(nested.Code.Text, 1)) = "MTEqn" Then
            If InStr(1, nested.Code.Text, "\c", vbTextCompare) = 0 Then
                For i = 2 To 32
                    value = FieldWord(nested.Code.Text, i)
                    If value = "" Then Exit For
                    If LCase$(value) = "\r" Then
                        value = FieldWord(nested.Code.Text, i + 1)
                        If Not IsNumeric(value) Then Err.Raise vbObjectError + 7374, "Equation Lab", "The equation restart is invalid."
                        If CDbl(value) < 1 Or CDbl(value) > 32767 Or CDbl(value) <> Fix(CDbl(value)) Then Err.Raise vbObjectError + 7374, "Equation Lab", "The equation restart is invalid."
                        NumberIncrementReset = CLng(value)
                    End If
                Next
                Exit Function
            End If
        End If
    Next
End Function

Private Function HasLegacyNumbering(ByVal Doc As Document) As Boolean
    Dim fields As Collection, seen As Collection, field As Field, sequence As String
    Set fields = New Collection: Set seen = New Collection
    CollectEquationFields Doc.Content, fields, seen, 0
    For Each field In fields
        If UCase$(FieldWord(field.Code.Text, 0)) = "SEQ" Then
            sequence = UCase$(FieldWord(field.Code.Text, 1))
            If sequence = "EQUATIONLAB" Or sequence = "ELCHAPTER" Or sequence = "ELSECTION" Then HasLegacyNumbering = True: Exit Function
        End If
    Next
End Function

Private Function SharedDefaultFormat(ByVal Doc As Document) As String
    On Error GoTo Missing
    Dim pattern As String
    If HasLegacyNumbering(Doc) Then Exit Function
    pattern = CStr(Doc.CustomDocumentProperties("MTEquationNumber2").Value)
    ValidateRibbonNumberFormat pattern
    SharedDefaultFormat = pattern
Missing:
End Function
