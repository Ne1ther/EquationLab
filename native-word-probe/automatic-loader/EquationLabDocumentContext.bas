Attribute VB_Name = "EquationLabDocumentContext"
Option Explicit

Private mEvents As EquationLabWordEvents
Private mDocument As Document
Private mEquations As Collection
Private mPollScheduled As Boolean
Private mPaintDocument As Document
Private mCapturing As Boolean
Private mSnapshotReady As Boolean
Private mSnapshotAt As Double
Private mSnapshotEnd As Long
Private mSnapshotShapes As Long
Private mSnapshotGeneration As Long
Private mSnapshotSaved As Boolean
Private mSnapshotIdentity As Long
Private mDocumentIdentity As Long
Private mSnapshotToken As Long
Private mKnownDocuments As Collection
Private mKnownDocumentIds As Collection
Private mBoundDocuments As Collection
Private mBoundEquations As Collection
Private mBoundTokens As Collection

Public Sub ELObserveDocument(ByVal Doc As Document)
    Dim i As Long
    If mDocument Is Nothing Then
        Set mDocument = Doc
    ElseIf Not Doc Is mDocument Then
        ELClearDocumentContext
        Set mDocument = Doc
    End If
    If mKnownDocuments Is Nothing Then
        Set mKnownDocuments = New Collection
        Set mKnownDocumentIds = New Collection
    End If
    For i = 1 To mKnownDocuments.Count
        If Doc Is mKnownDocuments(i) Then
            mDocumentIdentity = CLng(mKnownDocumentIds(i))
            Exit Sub
        End If
    Next
    mDocumentIdentity = EquationLabNativeCommand("MathTypeBridgeNewDocumentToken")
    mKnownDocuments.Add Doc
    mKnownDocumentIds.Add mDocumentIdentity
End Sub

Private Sub RememberSnapshot()
    If mBoundDocuments Is Nothing Then
        Set mBoundDocuments = New Collection
        Set mBoundEquations = New Collection
        Set mBoundTokens = New Collection
    End If
    mBoundDocuments.Add mDocument, CStr(mSnapshotToken)
    mBoundEquations.Add mEquations, CStr(mSnapshotToken)
    mBoundTokens.Add mSnapshotToken
    ' Keep the live Range anchors for recent editing sessions. An evicted or
    ' deleted anchor fails the save rather than falling back to ActiveDocument.
    If mBoundDocuments.Count > 32 Then
        mBoundDocuments.Remove 1
        mBoundEquations.Remove 1
        mBoundTokens.Remove 1
    End If
End Sub

Public Sub ELCloseDocumentContext(ByVal Doc As Document)
    On Error Resume Next
    Dim i As Long
    If Not mBoundDocuments Is Nothing Then
        For i = mBoundDocuments.Count To 1 Step -1
            If Doc Is mBoundDocuments(i) Then
                mBoundDocuments.Remove i
                mBoundEquations.Remove i
                mBoundTokens.Remove i
            End If
        Next
    End If
    If Not mKnownDocuments Is Nothing Then
        For i = mKnownDocuments.Count To 1 Step -1
            If Doc Is mKnownDocuments(i) Then
                mKnownDocuments.Remove i
                mKnownDocumentIds.Remove i
            End If
        Next
    End If
    If Doc Is mDocument Then
        Set mDocument = Nothing
        Set mEquations = Nothing
    End If
    If Doc Is mPaintDocument Then Set mPaintDocument = Nothing
    ELClearDocumentContext
End Sub

Public Sub ELInvalidateDocumentSnapshot()
    mSnapshotReady = False
    ELClearSelectionCapture
End Sub

Private Sub ELClearSelectionCapture()
    On Error Resume Next
    Dim result As Long
    ' A text click invalidates the pending selection, not the live Range
    ' bindings of existing OLE owners or their verified document snapshots.
    result = EquationLabNativeCommand("MathTypeBridgeClearDocumentSelection")
End Sub

Public Sub ELStartDocumentEvents()
    If mEvents Is Nothing Then Set mEvents = New EquationLabWordEvents
    Set mEvents.Host = Word.Application
End Sub

Public Sub ELQueueDisplayRefresh(ByVal Doc As Document)
    On Error GoTo Missing
    Set mPaintDocument = Doc
    SchedulePoll
Missing:
End Sub

Public Sub ELClearDocumentContext()
    On Error Resume Next
    Dim result As Long
    result = EquationLabNativeCommand("MathTypeBridgeClearDocumentContext")
    mSnapshotReady = False
    ' Word can reactivate after the old OLE session ends but before the
    ' scheduled navigation callback runs. Keep its document binding until
    ' that callback consumes the requested target.
    If EquationLabNativeCommand("MathTypeBridgeTransportActive") = 0 And Not mPollScheduled Then
        Set mEquations = Nothing
        Set mDocument = Nothing
    End If
End Sub

Private Function EquationIndex(ByVal target As InlineShape) As Long
    On Error GoTo Missing
    EquationIndex = -1
    If mEquations Is Nothing Then Exit Function
    Dim index As Long, shape As InlineShape, position As Long
    position = target.Range.Start
    For Each shape In mEquations
        If shape.Range.Start = position Then EquationIndex = index: Exit Function
        index = index + 1
    Next
Missing:
End Function

Private Sub ELCaptureTimingMarker(ByVal command As String)
    Dim ignored As Long
    On Error Resume Next
    ignored = EquationLabNativeCommand(command)
    Err.Clear
    On Error GoTo 0
End Sub

Public Sub ELWatchNativeSession()
    On Error GoTo Missing
    If EquationLabNativeCommand("MathTypeBridgeCaptureWatch") <> 0 Then SchedulePoll
Missing:
End Sub

Private Function Supported(ByVal shape As InlineShape) As Boolean
    On Error GoTo Missing
    Dim id As String
    id = shape.OLEFormat.ProgID
    Supported = (id = "Equation.DSMT4" Or id = "Equation.3")
Missing:
End Function

Public Sub ELCaptureSelection(ByVal selected As Selection, Optional ByVal allowParagraphFallback As Boolean = True)
    On Error GoTo Missing
    If mCapturing Then Exit Sub
    If selected.Range.StoryType <> wdMainTextStory Then GoTo Missing
    Dim shapes As InlineShapes, shape As InlineShape, position As Long
    Set shapes = selected.InlineShapes
    If shapes.Count = 1 Then
        If Not Supported(shapes(1)) Then GoTo Missing
        ELCaptureEquation shapes(1), False, True
        Exit Sub
    End If
    ' Word's text/caret selection and its OLE sizing frame can expose
    ' different InlineShapes collections for the same click. Match the
    ' actual object character; never choose the first formula in a paragraph
    ' that contains several formulas or capture an ordinary body-text click.
    position = selected.Range.Start
    Set shapes = selected.Paragraphs(1).Range.InlineShapes
    For Each shape In shapes
        If position >= shape.Range.Start And position < shape.Range.End Then
            If Not Supported(shape) Then GoTo Missing
            ELCaptureEquation shape, False, True
            Exit Sub
        End If
    Next
    ' A before-double-click callback can precede Word updating its selection.
    ' This unambiguous single-object fallback is restricted to that callback;
    ' ordinary selection changes only use the exact hit above.
    If allowParagraphFallback And shapes.Count = 1 Then
        ELClearSelectionCapture
        ELCaptureEquation shapes(1)
        Exit Sub
    End If
Missing:
    ELClearSelectionCapture
End Sub

Public Sub ELCaptureEquation(ByVal target As InlineShape, Optional ByVal forceSnapshot As Boolean = False, Optional ByVal selectionBound As Boolean = False)
    On Error GoTo Failed
    If mCapturing Then Exit Sub
    If Not Supported(target) Then Exit Sub
    If EquationLabNativeCommand("MathTypeBridgeTransportActive") <> 0 Then
        If EquationLabNativeCommand("MathTypeBridgeDocumentCaptureAllowed") = 0 Then
            If selectionBound Then ELClearSelectionCapture
            SchedulePoll
            Exit Sub
        End If
    End If
    If target.Range.StoryType <> wdMainTextStory Then Exit Sub
    mCapturing = True
    Dim shape As InlineShape, selected As Long, index As Long, directory As String, xml As String, result As Long
    Dim generation As Long, elapsed As Double, contentEnd As Long, shapeCount As Long, isSaved As Boolean, selectionText As String, contextHeader As String
    ELObserveDocument target.Range.Document
    generation = EquationLabNativeCommand("MathTypeBridgeEditGeneration")
    contentEnd = mDocument.Content.End
    shapeCount = mDocument.InlineShapes.Count
    isSaved = mDocument.Saved
    elapsed = Timer - mSnapshotAt
    If elapsed < 0 Then elapsed = elapsed + 86400#
    directory = Options.DefaultFilePath(wdStartupPath)
    Do While Right$(directory, 1) = "/": directory = Left$(directory, Len(directory) - 1): Loop
    ' A clean document remains a valid snapshot past the short event-coalescing
    ' window. Unsaved snapshots remain short-lived because same-size edits can
    ' leave the range end and formula count unchanged.
    If Not forceSnapshot And mSnapshotReady And generation = mSnapshotGeneration And contentEnd = mSnapshotEnd And shapeCount = mSnapshotShapes And isSaved = mSnapshotSaved And mDocumentIdentity = mSnapshotIdentity And ((selectionBound And isSaved) Or elapsed < 0.5) Then
        selected = EquationIndex(target)
        If selected >= 0 Then
            If selectionBound Then
                selectionText = "ELSEL4" & vbLf & CStr(mSnapshotIdentity) & vbLf & CStr(mSnapshotToken) & vbLf & CStr(selected)
            Else
                selectionText = CStr(selected)
            End If
            ELWriteUtf8 directory & "/.EquationLab/document-selection.txt", selectionText
            result = EquationLabNativeCommand("MathTypeBridgeSelectDocumentEquation")
            If result = 0 Then GoTo Captured
        End If
    End If
    Set mEquations = New Collection
    selected = -1
    For Each shape In mDocument.InlineShapes
        If Supported(shape) Then
            If shape.Range.Start = target.Range.Start Then selected = index
            mEquations.Add shape
            index = index + 1
        End If
    Next
    If selected < 0 Then GoTo Failed
    ' WordOpenXML reflects the live document, including unsaved edits. Never
    ' save, rename, or alter the user's document to obtain this snapshot.
    ELCaptureTimingMarker "MathTypeBridgeCaptureTimingStart"
    xml = mDocument.Content.WordOpenXML
    ELCaptureTimingMarker "MathTypeBridgeCaptureTimingXMLReady"
    If Len(xml) > 30000000 Then GoTo Failed
    mSnapshotToken = EquationLabNativeCommand("MathTypeBridgeNewDocumentToken")
    ' Word does not emit another selection/double-click event when an already
    ' selected OLE object is opened. An exact selection remains eligible until
    ' the selection changes or one activation consumes it. Other captures keep
    ' the short-lived ELCTX2 contract.
    contextHeader = "ELCTX2"
    If selectionBound Then contextHeader = "ELCTX3"
    ELWriteUtf8 directory & "/.EquationLab/document-context.txt", contextHeader & vbLf & CStr(mDocumentIdentity) & vbLf & CStr(mSnapshotToken) & vbLf & CStr(selected) & vbLf & Replace(Replace(mDocument.Name, vbCr, " "), vbLf, " ") & vbLf & xml
    ELCaptureTimingMarker "MathTypeBridgeCaptureTimingFileReady"
    result = EquationLabNativeCommand("MathTypeBridgeCaptureDocument")
    If result = 0 Then RememberSnapshot
    mSnapshotReady = (result = 0)
    mSnapshotAt = Timer
    mSnapshotEnd = contentEnd
    mSnapshotShapes = shapeCount
    mSnapshotSaved = isSaved
    mSnapshotGeneration = generation
    mSnapshotIdentity = mDocumentIdentity
Captured:
    mCapturing = False
    If result = 0 Then SchedulePoll
    Exit Sub
Failed:
    mCapturing = False
    mSnapshotReady = False
    ELClearSelectionCapture
    Debug.Print "Equation Lab document context unavailable: "; Err.Number
End Sub

Private Sub SchedulePoll()
    If mPollScheduled Then Exit Sub
    mPollScheduled = True
    Application.OnTime When:=Now + TimeSerial(0, 0, 1), Name:="EquationLabDocumentContext.ELPollNavigation"
End Sub

Public Sub ELPollNavigation()
    On Error GoTo Failed
    mPollScheduled = False
    Dim saveToken As Long
    saveToken = EquationLabNativeCommand("MathTypeBridgeTakeBackgroundSave")
    If saveToken > 0 Then
        ApplyBackgroundSave saveToken
        ELWatchNativeSession
        Exit Sub
    End If
    Dim captureToken As Long
    captureToken = EquationLabNativeCommand("MathTypeBridgeTakeDocumentCaptureRequest")
    If captureToken > 0 Then
        ApplyDocumentCaptureRequest captureToken
        ELWatchNativeSession
        Exit Sub
    End If
    If EquationLabNativeCommand("MathTypeBridgeTransportActive") <> 0 Then SchedulePoll: Exit Sub
    ' Word for Mac can leave newly visible inline previews blank after a
    ' jump. Repaint once after layout settles, without changing zoom,
    ' selection, document content, or another macro's ScreenUpdating state.
    ' Share the existing timer: Word supports only one pending OnTime task.
    If Not mPaintDocument Is Nothing Then
        If Application.Documents.Count > 0 Then
            If mPaintDocument Is ActiveDocument Then
                If Application.ScreenUpdating Then
                    Application.ScreenRefresh
                End If
            End If
        End If
        Set mPaintDocument = Nothing
    End If
    Dim target As Long, shape As InlineShape
    target = EquationLabNativeCommand("MathTypeBridgeTakeNavigation")
    If target <= 0 Then
        ' Only an integer request check is repeated. WordOpenXML runs once
        ' for an explicit request, never as periodic background polling.
        ELWatchNativeSession
        Exit Sub
    End If
    If mDocument Is Nothing Or mEquations Is Nothing Then Exit Sub
    If target > mEquations.Count Then Exit Sub
    Set shape = mEquations(target)
    If Not Supported(shape) Then Exit Sub
    shape.Range.Select
    ELCaptureEquation shape
    shape.OLEFormat.Activate
    Exit Sub
Failed:
    Debug.Print "Equation Lab navigation unavailable: "; Err.Number
End Sub

Private Function KnownDocumentIdentity(ByVal Doc As Document) As Long
    On Error GoTo Missing
    If mKnownDocuments Is Nothing Then Exit Function
    Dim i As Long
    For i = 1 To mKnownDocuments.Count
        If Doc Is mKnownDocuments(i) Then
            KnownDocumentIdentity = CLng(mKnownDocumentIds(i))
            Exit Function
        End If
    Next
Missing:
End Function

Private Sub ApplyDocumentCaptureRequest(ByVal requestToken As Long)
    On Error GoTo Failed
    Dim snapshot As Long, index As Long, identity As Long, result As Long
    Dim Doc As Document, candidate As Document, equations As Collection, shape As InlineShape, isOpen As Boolean
    snapshot = EquationLabNativeCommand("MathTypeBridgeDocumentCaptureSnapshot")
    index = EquationLabNativeCommand("MathTypeBridgeDocumentCaptureIndex")
    identity = EquationLabNativeCommand("MathTypeBridgeDocumentCaptureIdentity")
    If snapshot <= 0 Or index <= 0 Or identity <= 0 Then GoTo Failed
    If mBoundDocuments Is Nothing Or mBoundEquations Is Nothing Then GoTo Failed
    Set Doc = mBoundDocuments(CStr(snapshot))
    If KnownDocumentIdentity(Doc) <> identity Then GoTo Failed
    For Each candidate In Application.Documents
        If candidate Is Doc Then isOpen = True: Exit For
    Next
    If Not isOpen Then GoTo Failed
    Set equations = mBoundEquations(CStr(snapshot))
    If index > equations.Count Then GoTo Failed
    Set shape = equations(index)
    If Not (shape.Range.Document Is Doc) Then GoTo Failed
    If shape.Range.StoryType <> wdMainTextStory Then GoTo Failed
    If shape.Range.InlineShapes.Count <> 1 Then GoTo Failed
    If Not Supported(shape) Then GoTo Failed
    If EquationLabNativeCommand("MathTypeBridgeDocumentCaptureRequestToken") <> requestToken Then Exit Sub
    ' The retained live Range identifies the exact original OLE owner. A new
    ' snapshot is required after Native writes, even when selection is still
    ' on that same object and Word emits no new selection/double-click event.
    ELCaptureEquation shape, True
    If EquationLabNativeCommand("MathTypeBridgeDocumentCaptureRequestToken") <> requestToken Then Exit Sub
    result = EquationLabNativeCommand("MathTypeBridgeFinishDocumentCaptureRequest")
    Exit Sub
Failed:
    If EquationLabNativeCommand("MathTypeBridgeDocumentCaptureRequestToken") = requestToken Then
        result = EquationLabNativeCommand("MathTypeBridgeFailDocumentCaptureRequest")
    End If
    Debug.Print "Equation Lab requested document capture unavailable: "; Err.Number
End Sub

Private Sub ApplyBackgroundSave(ByVal token As Long)
    On Error GoTo Failed
    Dim Doc As Document, equations As Collection, shape As InlineShape, index As Long, result As Long
    If mBoundDocuments Is Nothing Or mBoundEquations Is Nothing Then GoTo Failed
    Set Doc = mBoundDocuments(CStr(token))
    Set equations = mBoundEquations(CStr(token))
    index = EquationLabNativeCommand("MathTypeBridgeBackgroundSaveIndex")
    If index <= 0 Or index > equations.Count Then GoTo Failed
    Set shape = equations(index)
    If Not (shape.Range.Document Is Doc) Then GoTo Failed
    If shape.Range.InlineShapes.Count <> 1 Then GoTo Failed
    If Not Supported(shape) Then GoTo Failed
    ' Activation supplies the target's real OLE owner and client site. Native
    ' code verifies its original Native hash and applies the prepared result
    ' directly. Do not select/scroll the object or launch the editor again.
    shape.OLEFormat.Activate
    result = EquationLabNativeCommand("MathTypeBridgeBackgroundSaveActivationFinished")
    mSnapshotReady = False
    Exit Sub
Failed:
    result = EquationLabNativeCommand("MathTypeBridgeFailBackgroundSave")
    Debug.Print "Equation Lab background save unavailable: "; Err.Number
End Sub
