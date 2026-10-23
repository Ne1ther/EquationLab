Attribute VB_Name = "EquationLabDocumentContext"
Option Explicit

Private mEvents As EquationLabWordEvents
Private mDocument As Document
Private mEquations As Collection
Private mPollScheduled As Boolean
Private mPaintDocument As Document
Private mCapturing As Boolean
Private mOpeningEquation As Boolean
Private mSnapshotReady As Boolean
Private mSnapshotAt As Double
Private mSnapshotEnd As Long
Private mSnapshotShapes As Long
Private mSnapshotGeneration As Long
Private mSnapshotSaved As Boolean
Private mSnapshotIdentity As Long
Private mDocumentIdentity As Long
Private mPublishedIdentity As Long
Private mPublishedName As String
Private mPublishedWorkspace As String
Private mWorkspaceClearPublished As Boolean
Private mWorkspaceRefreshRecheck As Boolean
Private mReconcilingDocuments As Boolean
Private mSnapshotToken As Long
Private mKnownDocuments As Collection
Private mKnownDocumentIds As Collection
Private mBoundDocuments As Collection
Private mBoundRanges As Collection
Private mBoundTokens As Collection
Private mInsertionDocument As Document
Private mInsertionRange As Range
Private mInsertionToken As Long
Private mCaptureFailureNotified As Long
Private mActivationDocument As Document
Private mActivationRange As Range
Private mActivationAt As Double
Private mActivationNonce As Long
Private mActivationSnapshot As Long
Private mActivationIndex As Long
Private mRestoredActivationAnchor As Boolean

Public Sub ELObserveDocument(ByVal Doc As Document)
    If Not mReconcilingDocuments Then ELReconcileKnownDocuments
    If Not ELIsDocumentOpen(Doc) Then Exit Sub
    mWorkspaceClearPublished = False
    If mDocument Is Nothing Then
        Set mDocument = Doc
    ElseIf Not Doc Is mDocument Then
        ELClearDocumentContext
        Set mDocument = Doc
    End If
    mDocumentIdentity = EnsureKnownDocumentIdentity(Doc)
    If mDocumentIdentity <= 0 Then Exit Sub
    PublishActiveDocument Doc
End Sub

Public Sub ELReconcileKnownDocuments()
    If mReconcilingDocuments Then Exit Sub
    mReconcilingDocuments = True
    On Error GoTo Finished
    Dim documentCount As Long, i As Long, Doc As Document
    documentCount = Application.Documents.Count
    If documentCount = 0 Then
        If Not mKnownDocuments Is Nothing Then
            For i = mKnownDocuments.Count To 1 Step -1
                Set Doc = mKnownDocuments(i)
                ELCloseDocumentContext Doc
            Next
        End If
        If Not mWorkspaceClearPublished Then
            If EquationLabNativeCommand("MathTypeBridgeClearWordWorkspace") = 0 Then
                mWorkspaceClearPublished = True
                mPublishedIdentity = 0
                mPublishedName = ""
                mPublishedWorkspace = ""
            End If
        End If
        GoTo Finished
    End If
    If Not mKnownDocuments Is Nothing Then
        For i = mKnownDocuments.Count To 1 Step -1
            Set Doc = mKnownDocuments(i)
            If Not ELIsDocumentOpen(Doc) Then ELCloseDocumentContext Doc
        Next
    End If
    If Application.Documents.Count > 0 Then ELReconcileActiveDocumentWorkspace
Finished:
    mReconcilingDocuments = False
End Sub

Private Function ELIsDocumentOpen(ByVal Doc As Document) As Boolean
    On Error GoTo Missing
    Dim candidate As Document
    ' Documents remain open while any of their windows remain. Comparing the
    ' live Documents collection avoids treating one closed window as a closed
    ' document and uses only COM identity checks, without reading document XML.
    For Each candidate In Application.Documents
        If candidate Is Doc Then
            ELIsDocumentOpen = True
            Exit Function
        End If
    Next
Missing:
End Function

Private Sub PublishActiveDocument(ByVal Doc As Document)
    PublishDocumentWorkspace Doc, mDocumentIdentity
End Sub

Private Sub ELReconcileActiveDocumentWorkspace()
    On Error GoTo Failed
    If Application.Documents.Count = 0 Then Exit Sub
    Dim Doc As Document, identity As Long
    Set Doc = ActiveDocument
    identity = EnsureKnownDocumentIdentity(Doc)
    If identity <= 0 Then Exit Sub
    mWorkspaceClearPublished = False
    PublishDocumentWorkspace Doc, identity
Failed:
End Sub

Private Function EnsureKnownDocumentIdentity(ByVal Doc As Document) As Long
    On Error GoTo Missing
    If mKnownDocuments Is Nothing Then
        Set mKnownDocuments = New Collection
        Set mKnownDocumentIds = New Collection
    End If
    Dim i As Long, identity As Long
    For i = 1 To mKnownDocuments.Count
        If Doc Is mKnownDocuments(i) Then
            EnsureKnownDocumentIdentity = CLng(mKnownDocumentIds(i))
            Exit Function
        End If
    Next
    identity = EquationLabNativeCommand("MathTypeBridgeNewDocumentToken")
    If identity <= 0 Then Exit Function
    mKnownDocuments.Add Doc
    mKnownDocumentIds.Add identity
    EnsureKnownDocumentIdentity = identity
Missing:
End Function

Private Sub PublishDocumentWorkspace(ByVal Doc As Document, ByVal identity As Long)
    On Error GoTo Failed
    Dim directory As String, result As Long, content As String
    Dim documentIdentity As Long, candidate As Document, documentName As String, readOnly As String
    If identity <= 0 Then Exit Sub
    If Application.Documents.Count > 128 Then Exit Sub
    content = "ELWORK2" & vbLf & CStr(identity) & vbLf & CStr(Application.Documents.Count) & vbLf
    For Each candidate In Application.Documents
        documentIdentity = EnsureKnownDocumentIdentity(candidate)
        If documentIdentity <= 0 Then Exit Sub
        documentName = ELWorkspaceSafeName(candidate.Name)
        readOnly = "0"
        If candidate.ReadOnly Then readOnly = "1"
        content = content & CStr(documentIdentity) & vbLf & readOnly & vbLf & documentName & vbLf
    Next
    If mPublishedWorkspace = content Then Exit Sub
    directory = Options.DefaultFilePath(wdStartupPath)
    Do While Right$(directory, 1) = "/": directory = Left$(directory, Len(directory) - 1): Loop
    ELWriteUtf8 directory & "/.EquationLab/active-document.txt", content
    result = EquationLabNativeCommand("MathTypeBridgePublishWordWorkspace")
    If result = 0 Then
        mPublishedIdentity = identity
        mPublishedName = ELWorkspaceSafeName(Doc.Name)
        mPublishedWorkspace = content
    End If
Failed:
End Sub

Private Function ELWorkspaceSafeName(ByVal value As String) As String
    Dim i As Long, code As Long
    For i = 1 To Len(value)
        code = AscW(Mid$(value, i, 1))
        If code < 0 Then code = code + 65536
        If code < 32 Or (code >= 127 And code <= 159) Then Mid$(value, i, 1) = " "
    Next
    If Len(value) > 512 Then value = Left$(value, 512)
    ELWorkspaceSafeName = value
End Function

Public Sub ELReportActiveDocument()
    If Application.Documents.Count > 0 Then
        ELObserveDocument ActiveDocument
    Else
        ELReconcileKnownDocuments
    End If
End Sub

Private Sub RememberSnapshot()
    If mBoundDocuments Is Nothing Then
        Set mBoundDocuments = New Collection
        Set mBoundRanges = New Collection
        Set mBoundTokens = New Collection
    End If
    Dim anchors As Collection, shape As InlineShape, anchor As Range
    Set anchors = New Collection
    For Each shape In mEquations
        Set anchor = shape.Range.Duplicate
        anchors.Add anchor
    Next
    RememberDocumentRanges mDocument, mSnapshotToken, anchors
End Sub

Private Sub RememberDocumentRanges(ByVal Doc As Document, ByVal snapshotToken As Long, ByVal anchors As Collection)
    If mBoundDocuments Is Nothing Then
        Set mBoundDocuments = New Collection
        Set mBoundRanges = New Collection
        Set mBoundTokens = New Collection
    End If
    mBoundDocuments.Add Doc, CStr(snapshotToken)
    mBoundRanges.Add anchors, CStr(snapshotToken)
    mBoundTokens.Add snapshotToken
    ' Keep only live Range anchors for recent editing sessions. An evicted or
    ' deleted anchor fails rather than falling back to ActiveDocument.
    If mBoundDocuments.Count > 32 Then
        mBoundDocuments.Remove 1
        mBoundRanges.Remove 1
        mBoundTokens.Remove 1
    End If
End Sub

Public Sub ELCloseDocumentContext(ByVal Doc As Document)
    On Error Resume Next
    Dim i As Long, closeIdentity As Long, directory As String, preserveOtherActivation As Boolean
    preserveOtherActivation = ELHasPreparedActivationForOtherDocument(Doc)
    If Not mActivationDocument Is Nothing Then
        If mActivationDocument Is Doc Then ELClearActivationAnchor
    End If
    If Not mInsertionDocument Is Nothing Then
        If mInsertionDocument Is Doc Then
            i = EquationLabNativeCommand("MathTypeBridgeCancelInsertion")
            ClearInsertion
        End If
    End If
    closeIdentity = KnownDocumentIdentity(Doc)
    If closeIdentity > 0 Then
        directory = Options.DefaultFilePath(wdStartupPath)
        Do While Right$(directory, 1) = "/": directory = Left$(directory, Len(directory) - 1): Loop
        ELWriteUtf8 directory & "/.EquationLab/document-close.txt", "ELCLOSE1" & vbLf & CStr(closeIdentity)
        i = EquationLabNativeCommand("MathTypeBridgeCloseDocumentIdentity")
        If preserveOtherActivation Then ELRestoreActivationAnchorAfterIdentityClose
        If closeIdentity = mPublishedIdentity Then
            mPublishedIdentity = 0
            mPublishedName = ""
        End If
    End If
    If Not mBoundDocuments Is Nothing Then
        For i = mBoundDocuments.Count To 1 Step -1
            If Doc Is mBoundDocuments(i) Then
                mBoundDocuments.Remove i
                mBoundRanges.Remove i
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
    If Not mDocument Is Nothing Then
        If Doc Is mDocument Then
            Set mDocument = Nothing
            Set mEquations = Nothing
            ELClearDocumentContext
        End If
    End If
    If Doc Is mPaintDocument Then Set mPaintDocument = Nothing
End Sub

Private Function ELHasPreparedActivationForOtherDocument(ByVal Doc As Document) As Boolean
    Dim elapsed As Double
    On Error GoTo Missing
    If mActivationDocument Is Nothing Or mActivationRange Is Nothing Or mDocument Is Nothing Then Exit Function
    If mActivationDocument Is Doc Or Not (mActivationDocument Is mDocument) Then Exit Function
    If Not (mActivationDocument Is ActiveDocument) Or Not ELIsDocumentOpen(mActivationDocument) Then Exit Function
    If EquationLabNativeCommand("MathTypeBridgeTransportActive") <> 0 Then Exit Function
    If mRestoredActivationAnchor Then
        elapsed = Timer - mActivationAt
        If elapsed < 0 Then elapsed = elapsed + 86400#
        ELHasPreparedActivationForOtherDocument = (elapsed < 5#)
    ElseIf mActivationNonce > 0 Then
        ELHasPreparedActivationForOtherDocument = (EquationLabNativeCommand("MathTypeBridgePreparedDocumentActivationNonce") = mActivationNonce)
    End If
Missing:
End Function

Private Sub ELRestoreActivationAnchorAfterIdentityClose()
    Dim elapsed As Double, identity As Long, directory As String, path As String, result As Long
    On Error GoTo Missing
    If mActivationDocument Is Nothing Or mActivationRange Is Nothing Or mDocument Is Nothing Then Exit Sub
    If Not (mActivationDocument Is mDocument) Or Not (mActivationDocument Is ActiveDocument) Then Exit Sub
    If Not ELIsDocumentOpen(mActivationDocument) Then Exit Sub
    elapsed = Timer - mActivationAt
    If elapsed < 0 Then elapsed = elapsed + 86400#
    If elapsed >= 5# Then Exit Sub
    identity = KnownDocumentIdentity(mActivationDocument)
    If identity <= 0 Or mActivationSnapshot <= 0 Or mActivationIndex < 0 Then Exit Sub
    directory = Options.DefaultFilePath(wdStartupPath)
    Do While Right$(directory, 1) = "/": directory = Left$(directory, Len(directory) - 1): Loop
    path = directory & "/.EquationLab/document-activation.txt"
    ' Native close retires by identity but also clears the process-wide
    ' activation hint. Restore only this still-live current document's hint;
    ' the original five-second expiry remains in force.
    ELWriteUtf8 path, "ELACT1" & vbLf & CStr(identity) & vbLf & CStr(mActivationSnapshot) & vbLf & CStr(mActivationIndex)
    result = EquationLabNativeCommand("MathTypeBridgePrepareDocumentActivation")
    If result = 0 Then
        mActivationNonce = 0
        mRestoredActivationAnchor = True
    Else
        ELClearActivationAnchor
    End If
Missing:
End Sub

Public Sub ELQueueWorkspaceRefresh()
    On Error Resume Next
    Dim result As Long
    mWorkspaceRefreshRecheck = True
    result = EquationLabNativeCommand("MathTypeBridgeQueueWorkspaceRefresh")
End Sub

Public Sub ELInvalidateDocumentSnapshot()
    mSnapshotReady = False
    ELClearActivationAnchor
    ELClearSelectionCapture
End Sub

Private Sub ELClearSelectionCapture()
    On Error Resume Next
    Dim result As Long
    ' A text click invalidates the pending selection, not the live Range
    ' bindings of existing OLE owners or their verified document snapshots.
    result = EquationLabNativeCommand("MathTypeBridgeClearDocumentSelection")
End Sub

Private Sub ELClearSelectionCaptureDuringCapture()
    On Error Resume Next
    Dim result As Long
    ' Word can re-enter selection events while WordOpenXML is being read. Clear
    ' the sticky selection context but preserve the nonce for this capture.
    result = EquationLabNativeCommand("MathTypeBridgeClearDocumentSelectionDuringCapture")
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
    ELClearActivationAnchor
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

Private Function ELFindEquationIndex(ByVal target As InlineShape) As Long
    On Error GoTo Missing
    ELFindEquationIndex = -1
    Dim Doc As Document, shape As InlineShape, index As Long
    Set Doc = target.Range.Document
    For Each shape In Doc.InlineShapes
        If Supported(shape) Then
            If shape.Range.Start = target.Range.Start And shape.Range.End = target.Range.End Then
                ELFindEquationIndex = index
                Exit Function
            End If
            index = index + 1
        End If
    Next
Missing:
End Function

Private Function ELIssueDocumentActivationNonce(ByVal identity As Long, ByVal index As Long) As Long
    On Error GoTo Missing
    Dim directory As String, ignored As Long, path As String
    directory = Options.DefaultFilePath(wdStartupPath)
    Do While Right$(directory, 1) = "/": directory = Left$(directory, Len(directory) - 1): Loop
    path = directory & "/.EquationLab/document-activation-request.txt"
    ELWriteUtf8 path, "ELACT0" & vbLf & CStr(identity) & vbLf & CStr(index)
    ELIssueDocumentActivationNonce = EquationLabNativeCommand("MathTypeBridgeIssueDocumentActivationNonce")
    If ELIssueDocumentActivationNonce <= 0 Then Kill path
Missing:
    Err.Clear
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

Public Sub ELQueueNativeSessionWatch()
    SchedulePoll
End Sub

Private Sub ELReportDocumentCaptureFailure()
    On Error GoTo Missing
    Dim state As Long
    state = EquationLabNativeCommand("MathTypeBridgeDocumentCaptureState")
    If state = 3 Or state = 5 Then
        If mCaptureFailureNotified <> state Then
            mCaptureFailureNotified = state
            MsgBox "Equation Lab could not confirm the active equation's Word document context. The editor was not opened for this activation. Select the equation and try again.", vbExclamation, "Equation Lab"
        End If
    ElseIf state = 0 Or state = 1 Or state = 2 Then
        mCaptureFailureNotified = 0
    End If
Missing:
End Sub

Private Function Supported(ByVal shape As InlineShape) As Boolean
    On Error GoTo Missing
    Dim id As String
    id = shape.OLEFormat.ProgID
    Supported = (id = "Equation.DSMT4" Or id = "Equation.3")
Missing:
End Function

Private Function EditableEquation(ByVal shape As InlineShape) As Boolean
    On Error GoTo Missing
    ' Preserve the legacy external editor entry without including its data
    ' in our native document snapshots.
    EditableEquation = Supported(shape) Or shape.OLEFormat.ProgID = "DSEquations"
Missing:
End Function

Private Sub ELClearActivationAnchor()
    On Error Resume Next
    Dim ignored As Long
    ignored = EquationLabNativeCommand("MathTypeBridgeClearDocumentActivationAnchor")
    Set mActivationDocument = Nothing
    Set mActivationRange = Nothing
    mActivationAt = 0
    mActivationNonce = 0
    mActivationSnapshot = 0
    mActivationIndex = 0
    mRestoredActivationAnchor = False
End Sub

Private Function SameActivationTarget(ByVal target As InlineShape, ByVal Doc As Document) As Boolean
    On Error GoTo Missing
    If mActivationDocument Is Nothing Or mActivationRange Is Nothing Then Exit Function
    Dim elapsed As Double
    elapsed = Timer - mActivationAt
    If elapsed < 0 Then elapsed = elapsed + 86400#
    If elapsed > 5# Then Exit Function
    If Not (Doc Is mActivationDocument) Or Not (target.Range.Document Is mActivationDocument) Then Exit Function
    SameActivationTarget = target.Range.Start = mActivationRange.Start And target.Range.End = mActivationRange.End
Missing:
End Function

Private Function CanReusePreparedActivation(ByVal target As InlineShape, ByVal Doc As Document) As Boolean
    On Error GoTo Missing
    If mActivationNonce <= 0 Or mActivationSnapshot <= 0 Or mActivationIndex < 0 Then Exit Function
    If mActivationDocument Is Nothing Then Exit Function
    If mActivationRange Is Nothing Then Exit Function
    If Not mSnapshotReady Or Not mSnapshotSaved Or Not Doc.Saved Then Exit Function
    If Not (Doc Is mActivationDocument) Or Not (target.Range.Document Is Doc) Then Exit Function
    If Not (mActivationRange.Document Is Doc) Then Exit Function
    If mActivationRange.StoryType <> wdMainTextStory Then Exit Function
    If target.Range.StoryType <> wdMainTextStory Then Exit Function
    If target.Range.Start <> mActivationRange.Start Or target.Range.End <> mActivationRange.End Then Exit Function
    If mSnapshotToken <> mActivationSnapshot Or mSnapshotIdentity <> mDocumentIdentity Then Exit Function
    If KnownDocumentIdentity(Doc) <> mSnapshotIdentity Then Exit Function
    If mSnapshotGeneration <> EquationLabNativeCommand("MathTypeBridgeEditGeneration") Then Exit Function
    If mSnapshotEnd <> Doc.Content.End Or mSnapshotShapes <> Doc.InlineShapes.Count Then Exit Function
    If ELFindEquationIndex(target) <> mActivationIndex Then Exit Function
    Dim elapsed As Double
    elapsed = Timer - mActivationAt
    If elapsed < 0 Then elapsed = elapsed + 86400#
    If elapsed >= 0.5 Then Exit Function
    If EquationLabNativeCommand("MathTypeBridgePreparedDocumentActivationNonce") <> mActivationNonce Then Exit Function
    CanReusePreparedActivation = True
    Exit Function
Missing:
    Err.Clear
End Function

Public Sub ELCaptureSelection(ByVal selected As Selection, Optional ByVal prepareActivation As Boolean = False)
    On Error GoTo Missing
    ' OLE activation can synchronously publish more selection callbacks. The
    ' opening gesture already owns its exact target; do not replace its nonce.
    If mOpeningEquation Then Exit Sub
    If mCapturing Then
        ELClearSelectionCaptureDuringCapture
        Exit Sub
    End If
    Dim shape As InlineShape
    Set shape = ELSelectedEquation(selected)
    If shape Is Nothing Then GoTo Missing
    If Not Supported(shape) Then GoTo Missing
    If prepareActivation And CanReusePreparedActivation(shape, selected.Document) Then Exit Sub
    If Not SameActivationTarget(shape, selected.Document) Then ELClearActivationAnchor
    ELCaptureEquation shape, False, True, 0, prepareActivation
    Exit Sub
Missing:
    ELClearSelectionCapture
End Sub

Public Function ELSelectedEquation(ByVal selected As Selection) As InlineShape
    On Error GoTo Missing
    Set ELSelectedEquation = ExactSelectedEquation(selected, selected.Document)
Missing:
End Function

Public Sub ELOpenEquation(ByVal target As InlineShape)
    If mOpeningEquation Then Exit Sub
    On Error GoTo Failed
    mOpeningEquation = True
    ' Reuse only the still-pending fresh capture from this exact gesture.
    ' Neither opening nor capture needs Range.Select or an OLE sizing frame.
    Dim prepare As Boolean
    If Supported(target) Then
        prepare = (EquationLabNativeCommand("MathTypeBridgeTransportActive") = 0)
        If Not prepare Then prepare = (EquationLabNativeCommand("MathTypeBridgeDocumentCaptureAllowed") <> 0)
    End If
    If prepare Then
        If Not CanReusePreparedActivation(target, target.Range.Document) Then
            ELCaptureEquation target, False, True, 0, True
        End If
        If Not SameActivationTarget(target, target.Range.Document) Then Err.Raise vbObjectError + 7351, "Equation Lab", "Could not prepare the selected equation. Please try again."
        If mActivationNonce <= 0 Then Err.Raise vbObjectError + 7351, "Equation Lab", "Could not prepare the selected equation. Please try again."
    End If
    ' An already-active owner is re-shown by native DoVerb; do not replace
    ' its session or require an activation nonce that it already consumed.
    target.OLEFormat.Activate
    mOpeningEquation = False
    Exit Sub
Failed:
    Dim number As Long, description As String
    number = Err.Number
    description = Err.Description
    mOpeningEquation = False
    Err.Raise number, "Equation Lab", description
End Sub

Public Sub ELCaptureEquation(ByVal target As InlineShape, Optional ByVal forceSnapshot As Boolean = False, Optional ByVal selectionBound As Boolean = False, Optional ByVal captureRequestToken As Long = 0, Optional ByVal prepareActivation As Boolean = False)
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
    Dim activationNonce As Long
    ELObserveDocument target.Range.Document
    selected = EquationIndex(target)
    If selected < 0 Then selected = ELFindEquationIndex(target)
    If selected < 0 Then GoTo Failed
    If prepareActivation Then
        ELClearActivationAnchor
        activationNonce = ELIssueDocumentActivationNonce(mDocumentIdentity, selected)
        If activationNonce <= 0 Then GoTo Failed
        captureRequestToken = activationNonce
    End If
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
    If isSaved Then
        If Not forceSnapshot And mSnapshotReady And captureRequestToken = 0 And generation = mSnapshotGeneration And contentEnd = mSnapshotEnd And shapeCount = mSnapshotShapes And isSaved = mSnapshotSaved And mDocumentIdentity = mSnapshotIdentity And ((selectionBound And isSaved) Or elapsed < 0.5) Then
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
    If captureRequestToken > 0 Then contextHeader = "ELCTX4"
    If captureRequestToken > 0 Then
        ELWriteUtf8 directory & "/.EquationLab/document-context.txt", contextHeader & vbLf & CStr(captureRequestToken) & vbLf & CStr(mDocumentIdentity) & vbLf & CStr(mSnapshotToken) & vbLf & CStr(selected) & vbLf & Replace(Replace(mDocument.Name, vbCr, " "), vbLf, " ") & vbLf & xml
    Else
        ELWriteUtf8 directory & "/.EquationLab/document-context.txt", contextHeader & vbLf & CStr(mDocumentIdentity) & vbLf & CStr(mSnapshotToken) & vbLf & CStr(selected) & vbLf & Replace(Replace(mDocument.Name, vbCr, " "), vbLf, " ") & vbLf & xml
    End If
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
    If prepareActivation Then
        If result = 0 And selected >= 0 And mSnapshotReady Then
            Set mActivationDocument = mDocument
            Set mActivationRange = target.Range.Duplicate
            ELWriteUtf8 directory & "/.EquationLab/document-activation.txt", "ELACT2" & vbLf & CStr(activationNonce) & vbLf & CStr(mDocumentIdentity) & vbLf & CStr(mSnapshotToken) & vbLf & CStr(selected)
            result = EquationLabNativeCommand("MathTypeBridgePrepareDocumentActivation")
            If result = 0 Then
                mActivationNonce = activationNonce
                mActivationSnapshot = mSnapshotToken
                mActivationIndex = selected
                mActivationAt = Timer
            Else
                ELClearActivationAnchor
            End If
        End If
    End If
    ' The fast opening path still needs the Word-owned callback for later
    ' sidebar target saves. A first cold activation may have no existing poll.
    If result = 0 Then SchedulePoll
    Exit Sub
Failed:
    mCapturing = False
    mSnapshotReady = False
    If activationNonce > 0 Then
        ELClearActivationAnchor
        ELClearSelectionCaptureDuringCapture
    Else
        ELClearSelectionCapture
    End If
    Debug.Print "Equation Lab document context unavailable: "; Err.Number
End Sub

Private Sub SchedulePoll()
    If mPollScheduled Then Exit Sub
    Application.OnTime When:=Now + TimeSerial(0, 0, 1), Name:="EquationLabDocumentContext.ELPollNavigation"
    mPollScheduled = True
End Sub

Private Sub ClearInsertion()
    Set mInsertionDocument = Nothing
    Set mInsertionRange = Nothing
    mInsertionToken = 0
End Sub

Private Function ELTryCleanupInlineInsertion(ByVal Doc As Document, ByVal insertionStart As Long, ByVal beforeEnd As Long) As Boolean
    On Error GoTo Failed
    Dim insertedEnd As Long, inserted As Range, trailingBreak As Range
    insertedEnd = insertionStart + Doc.Content.End - beforeEnd
    If insertedEnd <= insertionStart Then Exit Function
    Set inserted = Doc.Range(insertionStart, insertedEnd)
    If inserted.InlineShapes.Count = 1 Then
        If Supported(inserted.InlineShapes(1)) Then
            Set trailingBreak = Doc.Range(insertedEnd - 1, insertedEnd)
            If trailingBreak.Start >= inserted.InlineShapes(1).Range.End And trailingBreak.Text = vbCr Then trailingBreak.Delete
        End If
    End If
    ELTryCleanupInlineInsertion = True
    Exit Function
Failed:
    Dim failureNumber As Long, failureDescription As String
    failureNumber = Err.Number
    failureDescription = Err.Description
    Debug.Print "Equation Lab inline paragraph cleanup failed: "; failureNumber; failureDescription
    Err.Clear
End Function

Public Sub ELBeginEquationInsertion(ByVal kind As String)
    If EquationLabNativeCommand("MathTypeBridgeInsertionActive") <> 0 Or EquationLabNativeCommand("MathTypeBridgeTransportActive") <> 0 Then
        Err.Raise vbObjectError + 7358, "Equation Lab", "Please finish or cancel the current equation first."
    End If
    On Error GoTo Failed
    If Selection.Start <> Selection.End Or Selection.Range.StoryType <> wdMainTextStory Then
        Err.Raise vbObjectError + 7359, "Equation Lab", "Please place an empty cursor in the document body."
    End If
    Set mInsertionDocument = Selection.Document
    If mInsertionDocument.ReadOnly Then Err.Raise vbObjectError + 7360, "Equation Lab", "This document is read only."
    Set mInsertionRange = Selection.Range.Duplicate
    ELObserveDocument mInsertionDocument
    mInsertionToken = EquationLabNativeCommand("MathTypeBridgeNewDocumentToken")
    Dim directory As String, xml As String, result As Long, shape As InlineShape, anchor As Range
    Dim insertionEquations As Collection, insertionAnchors As Collection
    Set insertionEquations = New Collection
    For Each shape In mInsertionDocument.InlineShapes
        If Supported(shape) Then insertionEquations.Add shape
    Next
    Set insertionAnchors = New Collection
    For Each shape In insertionEquations
        Set anchor = shape.Range.Duplicate
        insertionAnchors.Add anchor
    Next
    RememberDocumentRanges mInsertionDocument, mInsertionToken, insertionAnchors
    directory = Options.DefaultFilePath(wdStartupPath)
    Do While Right$(directory, 1) = "/": directory = Left$(directory, Len(directory) - 1): Loop
    xml = mInsertionDocument.Content.WordOpenXML
    If Len(xml) > 30000000 Then Err.Raise vbObjectError + 7361, "Equation Lab", "This document is too large to open for insertion."
    ELWriteUtf8 directory & "/.EquationLab/ribbon-insertion-context.txt", "ELCTX2" & vbLf & CStr(mDocumentIdentity) & vbLf & CStr(mInsertionToken) & vbLf & "0" & vbLf & Replace(Replace(mInsertionDocument.Name, vbCr, " "), vbLf, " ") & vbLf & xml
    result = EquationLabNativeCommand("MathTypeBridgeRibbon" & kind)
    If result <> 0 Then Err.Raise vbObjectError + 7362, "Equation Lab", "The blank equation editor could not be opened."
    SchedulePoll
    Exit Sub
Failed:
    Dim failure As String
    failure = Err.Description
    ClearInsertion
    Err.Raise vbObjectError + 7363, "Equation Lab", failure
End Sub

Private Sub ApplyInsertion(ByVal token As Long)
    On Error GoTo Failed
    Dim Doc As Document, candidate As Document, isOpen As Boolean, result As Long
    Dim start As Long, beforeEnd As Long, target As Range
    Dim inlineMode As Long, mutationAttempted As Boolean, mutationCompleted As Boolean
    Dim cleanupFailed As Boolean, finishAttempted As Boolean
    Dim failureNumber As Long, failureDescription As String
    If token <> mInsertionToken Or mInsertionToken <= 0 Then GoTo Failed
    Set Doc = mInsertionDocument
    If Doc Is Nothing Or mInsertionRange Is Nothing Then GoTo Failed
    For Each candidate In Application.Documents
        If candidate Is Doc Then isOpen = True: Exit For
    Next
    If Not isOpen Or Doc.ReadOnly Then GoTo Failed
    If Not (mInsertionRange.Document Is Doc) Then GoTo Failed
    If mInsertionRange.StoryType <> wdMainTextStory Or mInsertionRange.Start <> mInsertionRange.End Or mInsertionRange.Text <> "" Then GoTo Failed
    inlineMode = EquationLabNativeCommand("MathTypeBridgeInsertionInline")
    If inlineMode < 0 Then GoTo Failed
    Set target = mInsertionRange.Duplicate
    start = target.Start
    beforeEnd = Doc.Content.End
    Dim directory As String
    directory = Options.DefaultFilePath(wdStartupPath)
    Do While Right$(directory, 1) = "/": directory = Left$(directory, Len(directory) - 1): Loop
    mutationAttempted = True
    target.InsertFile FileName:=directory & "/.EquationLab/ribbon-complete-insert.docx", ConfirmConversions:=False, Link:=False, Attachment:=False
    mutationCompleted = True
    On Error Resume Next
    ELInvalidateDocumentSnapshot
    Err.Clear
    On Error GoTo Failed
    ' InsertFile includes the fragment's paragraph mark. For one inline OLE
    ' object followed by that new mark, remove only the inserted mark so
    ' following body text stays in its original paragraph. Never delete an
    ' original paragraph boundary or infer the mode from the initial button.
    If inlineMode = 1 Then cleanupFailed = Not ELTryCleanupInlineInsertion(Doc, start, beforeEnd)
    ' Completion does not select or activate the new OLE object. Its content
    ' has already been edited; opening it again causes focus and sizing-frame races.
    On Error Resume Next
    finishAttempted = True
    result = EquationLabNativeCommand("MathTypeBridgeFinishInsertion")
    Err.Clear
    On Error GoTo Failed
    If cleanupFailed Then MsgBox "The equation was inserted, but Word's paragraph layout could not be confirmed. Check the paragraph layout in Word.", vbExclamation, "Equation Lab"
    GoTo Finished
Failed:
    failureNumber = Err.Number
    failureDescription = Err.Description
    On Error Resume Next
    If mutationCompleted Then
        ELInvalidateDocumentSnapshot
        If Not finishAttempted Then
            finishAttempted = True
            result = EquationLabNativeCommand("MathTypeBridgeFinishInsertion")
        End If
        MsgBox "The equation was inserted, but Word's paragraph layout could not be confirmed. Check the paragraph layout in Word.", vbExclamation, "Equation Lab"
    ElseIf mutationAttempted Then
        ELInvalidateDocumentSnapshot
        result = EquationLabNativeCommand("MathTypeBridgeUncertainInsertion")
        MsgBox "Word may have inserted the equation. Check the document; Equation Lab will not automatically repeat this insertion.", vbExclamation, "Equation Lab"
    Else
        result = EquationLabNativeCommand("MathTypeBridgeFailInsertion")
    End If
    Debug.Print "Equation Lab insertion error: "; failureNumber; failureDescription
    Err.Clear
Finished:
    ClearInsertion
End Sub

Public Sub ELPollNavigation()
    On Error GoTo Failed
    mPollScheduled = False
    ELReconcileKnownDocuments
    Dim insertionToken As Long, workspaceRefreshResult As Long
    insertionToken = EquationLabNativeCommand("MathTypeBridgeTakeInsertion")
    If mWorkspaceRefreshRecheck Then
        mWorkspaceRefreshRecheck = False
        workspaceRefreshResult = EquationLabNativeCommand("MathTypeBridgeQueueWorkspaceRefresh")
    End If
    If insertionToken > 0 Then
        ApplyInsertion insertionToken
        SchedulePoll
        Exit Sub
    End If
    If EquationLabNativeCommand("MathTypeBridgeInsertionActive") <> 0 Then SchedulePoll: Exit Sub
    If mInsertionToken > 0 Then
        ClearInsertion
        If EquationLabNativeCommand("MathTypeBridgeInsertionError") <> 0 Then MsgBox "Equation Lab could not complete this insertion. The document was not changed.", vbExclamation, "Equation Lab"
    End If
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
        ELReportDocumentCaptureFailure
        ELWatchNativeSession
        Exit Sub
    End If
    ELReportDocumentCaptureFailure
    If EquationLabNativeCommand("MathTypeBridgeTransportActive") <> 0 Then SchedulePoll: Exit Sub
    Dim documentRequestToken As Long
    documentRequestToken = EquationLabNativeCommand("MathTypeBridgeTakeWordDocumentRequest")
    If documentRequestToken > 0 Then
        ApplyWordDocumentRequest documentRequestToken
        SchedulePoll
        Exit Sub
    End If
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

Private Function ELIsRequestId(ByVal value As String) As Boolean
    If Len(value) <> 64 Then Exit Function
    Dim i As Long, character As String
    For i = 1 To 64
        character = Mid$(value, i, 1)
        If Not (character >= "0" And character <= "9") And Not (character >= "a" And character <= "f") Then Exit Function
    Next
    ELIsRequestId = True
End Function

Private Function ELIsUnsignedInteger(ByVal value As String) As Boolean
    If Len(value) = 0 Then Exit Function
    Dim i As Long, character As String
    For i = 1 To Len(value)
        character = Mid$(value, i, 1)
        If character < "0" Or character > "9" Then Exit Function
    Next
    ELIsUnsignedInteger = True
End Function

Private Function ELFirstSupportedEquation(ByVal Doc As Document) As InlineShape
    On Error GoTo Missing
    Dim candidate As InlineShape
    For Each candidate In Doc.InlineShapes
        If Supported(candidate) Then
            Set ELFirstSupportedEquation = candidate
            Exit Function
        End If
    Next
Missing:
End Function

Private Sub ELFinishWordDocumentRequest(ByVal command As String)
    On Error Resume Next
    Dim ignored As Long, directory As String, path As String
    ignored = EquationLabNativeCommand(command)
    directory = Options.DefaultFilePath(wdStartupPath)
    Do While Right$(directory, 1) = "/": directory = Left$(directory, Len(directory) - 1): Loop
    path = directory & "/.EquationLab/native-document-request.txt"
    If Len(Dir$(path)) > 0 Then Kill path
    Err.Clear
    On Error GoTo 0
End Sub

Private Sub ApplyWordDocumentRequest(ByVal requestToken As Long)
    On Error GoTo Failed
    Dim directory As String, path As String, fileNumber As Integer, content As String, fields As Variant
    Dim requestId As String, identity As String, snapshot As Long, targetIndex As Long, identityToken As Long
    Dim digest As String, separator As Long, Doc As Document, candidate As Document, anchors As Collection, anchor As Range, shape As InlineShape
    Dim isOpen As Boolean, result As Long
    directory = Options.DefaultFilePath(wdStartupPath)
    Do While Right$(directory, 1) = "/": directory = Left$(directory, Len(directory) - 1): Loop
    path = directory & "/.EquationLab/native-document-request.txt"
    fileNumber = FreeFile
    Open path For Binary Access Read Lock Read As #fileNumber
    content = Space$(LOF(fileNumber))
    If Len(content) = 0 Then GoTo Failed
    Get #fileNumber, , content
    Close #fileNumber
    fields = Split(content, vbLf)
    If UBound(fields) <> 8 Or fields(0) <> "ELDREQ2" Or fields(8) <> "" Then GoTo Failed
    If CLng(fields(1)) <> requestToken Or requestToken <= 0 Then GoTo Failed
    requestId = CStr(fields(2))
    If Not ELIsRequestId(requestId) Then GoTo Failed
    If EquationLabNativeCommand("MathTypeBridgeWordDocumentRequestCurrent") = 0 Then GoTo Cancelled
    If fields(3) = "0" Then
        If fields(4) <> "" Or fields(5) <> "0" Or fields(6) <> "0" Or fields(7) <> "" Then GoTo Failed
        If Application.Documents.Count = 0 Then
            ELFinishWordDocumentRequest "MathTypeBridgeFinishWordDocumentRequestNoDocument"
            Exit Sub
        End If
        Set Doc = ActiveDocument
        ELObserveDocument Doc
        Set shape = ELSelectedEquation(Selection)
        If shape Is Nothing Then
            Set shape = ELFirstSupportedEquation(Doc)
        ElseIf Not Supported(shape) Then
            Set shape = ELFirstSupportedEquation(Doc)
        End If
        If shape Is Nothing Then
            ELFinishWordDocumentRequest "MathTypeBridgeFinishWordDocumentRequestEmpty"
            Exit Sub
        End If
    ElseIf fields(3) = "2" Then
        identity = CStr(fields(4))
        If fields(5) <> "0" Or fields(6) <> "0" Or fields(7) <> "" Then GoTo Failed
        separator = InStrRev(identity, ":")
        If separator <= 1 Or separator = Len(identity) Then GoTo Failed
        If Not ELIsUnsignedInteger(Mid$(identity, separator + 1)) Then GoTo Failed
        identityToken = CLng(Mid$(identity, separator + 1))
        If identityToken <= 0 Or mKnownDocuments Is Nothing Or mKnownDocumentIds Is Nothing Then GoTo Failed
        For Each candidate In mKnownDocuments
            If KnownDocumentIdentity(candidate) = identityToken Then
                Set Doc = candidate
                Exit For
            End If
        Next
        If Doc Is Nothing Or KnownDocumentIdentity(Doc) <> identityToken Then GoTo Failed
        For Each candidate In Application.Documents
            If candidate Is Doc Then isOpen = True: Exit For
        Next
        If Not isOpen Or Doc.ReadOnly Then GoTo Failed
        If Not (Doc Is ActiveDocument) Then Doc.Activate
        If Not (Doc Is ActiveDocument) Then GoTo Failed
        ELObserveDocument Doc
        Set shape = ELSelectedEquation(Selection)
        If shape Is Nothing Then
            Set shape = ELFirstSupportedEquation(Doc)
        ElseIf Not Supported(shape) Or Not (shape.Range.Document Is Doc) Then
            Set shape = ELFirstSupportedEquation(Doc)
        End If
        If shape Is Nothing Then
            ELFinishWordDocumentRequest "MathTypeBridgeFinishWordDocumentRequestEmpty"
            Exit Sub
        End If
    ElseIf fields(3) = "1" Then
        identity = CStr(fields(4)): digest = CStr(fields(7))
        If Len(digest) <> 64 Or Not ELIsRequestId(digest) Then GoTo Failed
        If Not ELIsUnsignedInteger(CStr(fields(5))) Or Not ELIsUnsignedInteger(CStr(fields(6))) Then GoTo Failed
        snapshot = CLng(fields(5)): targetIndex = CLng(fields(6))
        If snapshot <= 0 Or targetIndex < 0 Or targetIndex > 10000 Then GoTo Failed
        separator = InStrRev(identity, ":")
        If separator <= 1 Or separator = Len(identity) Then GoTo Failed
        If Not ELIsUnsignedInteger(Mid$(identity, separator + 1)) Then GoTo Failed
        identityToken = CLng(Mid$(identity, separator + 1))
        If identityToken <= 0 Then GoTo Failed
        If mBoundDocuments Is Nothing Or mBoundRanges Is Nothing Then GoTo Failed
        Set Doc = mBoundDocuments(CStr(snapshot))
        If KnownDocumentIdentity(Doc) <> identityToken Then GoTo Failed
        For Each candidate In Application.Documents
            If candidate Is Doc Then isOpen = True: Exit For
        Next
        If Not isOpen Or Doc.ReadOnly Then GoTo Failed
        Set anchors = mBoundRanges(CStr(snapshot))
        If targetIndex + 1 > anchors.Count Then GoTo Failed
        Set anchor = anchors(targetIndex + 1)
        Set shape = ResolveBoundEquation(Doc, anchor, targetIndex + 1)
        If shape Is Nothing Then GoTo Failed
    Else
        GoTo Failed
    End If
    If Not (shape.Range.Document Is Doc) Or shape.Range.StoryType <> wdMainTextStory Then GoTo Failed
    If shape.Range.InlineShapes.Count <> 1 Or Not Supported(shape) Then GoTo Failed
    If EquationLabNativeCommand("MathTypeBridgeWordDocumentRequestCurrent") = 0 Then GoTo Cancelled
    If EquationLabNativeCommand("MathTypeBridgeBeginWordDocumentRequest") = 0 Then GoTo Cancelled
    ELOpenEquation shape
    ELFinishWordDocumentRequest "MathTypeBridgeFinishWordDocumentRequestOpened"
    Exit Sub
Cancelled:
    ' A status recheck retired this request before activation. Do not open it.
    On Error Resume Next
    If Len(Dir$(path)) > 0 Then Kill path
    Err.Clear
    On Error GoTo 0
    Exit Sub
Failed:
    On Error Resume Next
    If fileNumber <> 0 Then Close #fileNumber
    Debug.Print "Equation Lab document request failed: "; Err.Number
    ELFinishWordDocumentRequest "MathTypeBridgeFinishWordDocumentRequestFailed"
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

Private Function ExactSelectedEquation(ByVal selected As Selection, ByVal Doc As Document) As InlineShape
    On Error GoTo Missing
    If Application.Documents.Count = 0 Then Exit Function
    If Not (Doc Is ActiveDocument) Or Not (selected.Document Is Doc) Then Exit Function
    If selected.Range.StoryType <> wdMainTextStory Then Exit Function
    Dim shapes As InlineShapes, shape As InlineShape, position As Long
    position = selected.Range.Start
    Set shapes = selected.InlineShapes
    If shapes.Count = 1 Then
        Set shape = shapes(1)
        If position >= shape.Range.Start And position < shape.Range.End And selected.Range.End <= shape.Range.End And EditableEquation(shape) Then
            Set ExactSelectedEquation = shape
            Exit Function
        End If
    End If
    ' The paragraph collection is only a lookup surface. The selected OLE
    ' character must still contain the actual selection start; there is no
    ' single-object paragraph fallback.
    Set shapes = selected.Paragraphs(1).Range.InlineShapes
    For Each shape In shapes
        If position >= shape.Range.Start And position < shape.Range.End And selected.Range.End <= shape.Range.End Then
            If EditableEquation(shape) Then Set ExactSelectedEquation = shape
            Exit Function
        End If
    Next
    ' Word can expose an embedded equation as an EMBED field. Blue text
    ' selection then includes field delimiters outside the OLE character.
    ' Accept only that field's own envelope, never adjacent body text.
    Dim embedded As Field, fieldStart As Long
    For Each embedded In selected.Paragraphs(1).Range.Fields
        If embedded.Type = wdFieldEmbed Then
            If embedded.Result.InlineShapes.Count = 1 Then
                Set shape = embedded.Result.InlineShapes(1)
                If EditableEquation(shape) Then
                    fieldStart = EmbeddedEquationFieldStart(embedded, Doc)
                    If fieldStart >= 0 Then
                        If position >= fieldStart And position <= shape.Range.Start And selected.Range.End >= shape.Range.End And selected.Range.End <= embedded.Result.End + 1 Then
                            Set ExactSelectedEquation = shape
                            Exit Function
                        End If
                    End If
                End If
            End If
        End If
    Next
Missing:
End Function

Private Function EmbeddedEquationFieldStart(ByVal embedded As Field, ByVal Doc As Document) As Long
    On Error GoTo Missing
    EmbeddedEquationFieldStart = -1
    Dim position As Long, text As String
    ' Mac Word's EMBED field can report Code.Start two positions past the
    ' opening delimiter, and hides delimiter characters from Range.Text.
    ' Accept only these empty control positions or an explicit field-begin
    ' character; stop before any adjacent body text.
    For position = embedded.Code.Start - 1 To embedded.Code.Start - 2 Step -1
        If position < 0 Then Exit For
        text = Doc.Range(position, position + 1).Text
        If Len(text) > 0 And text <> Chr$(19) Then Exit For
        EmbeddedEquationFieldStart = position
        If text = Chr$(19) Then Exit Function
    Next
Missing:
End Function

Private Function ResolveBoundEquation(ByVal Doc As Document, ByVal anchor As Range, ByVal expectedIndex As Long) As InlineShape
    On Error GoTo Missing
    If Doc Is Nothing Or anchor Is Nothing Then Exit Function
    If Not (anchor.Document Is Doc) Then Exit Function
    If anchor.StoryType <> wdMainTextStory Or anchor.Start >= anchor.End Then Exit Function
    Dim shape As InlineShape, index As Long
    For Each shape In Doc.InlineShapes
        If Supported(shape) Then
            If shape.Range.Start = anchor.Start And shape.Range.End = anchor.End Then
                If shape.Range.StoryType <> wdMainTextStory Then Exit Function
                If shape.Range.InlineShapes.Count <> 1 Then Exit Function
                If index + 1 <> expectedIndex Then Exit Function
                Set ResolveBoundEquation = shape
                Exit Function
            End If
            index = index + 1
        End If
    Next
Missing:
End Function

Private Sub ApplyDocumentCaptureRequest(ByVal requestToken As Long)
    On Error GoTo Failed
    Dim snapshot As Long, index As Long, identity As Long, result As Long
    Dim Doc As Document, candidate As Document, anchors As Collection, anchor As Range, shape As InlineShape, isOpen As Boolean
    snapshot = EquationLabNativeCommand("MathTypeBridgeDocumentCaptureSnapshot")
    index = EquationLabNativeCommand("MathTypeBridgeDocumentCaptureIndex")
    identity = EquationLabNativeCommand("MathTypeBridgeDocumentCaptureIdentity")
    If EquationLabNativeCommand("MathTypeBridgeDocumentCaptureRequestToken") <> requestToken Then Exit Sub
    If snapshot > 0 Then
        If index <= 0 Or identity <= 0 Then GoTo Failed
        If mBoundDocuments Is Nothing Or mBoundRanges Is Nothing Then GoTo Failed
        Set Doc = mBoundDocuments(CStr(snapshot))
        If KnownDocumentIdentity(Doc) <> identity Then GoTo Failed
        For Each candidate In Application.Documents
            If candidate Is Doc Then isOpen = True: Exit For
        Next
        If Not isOpen Then GoTo Failed
        Set anchors = mBoundRanges(CStr(snapshot))
        If index > anchors.Count Then GoTo Failed
        Set anchor = anchors(index)
        Set shape = ResolveBoundEquation(Doc, anchor, index)
        If shape Is Nothing Then GoTo Failed
    Else
        If snapshot <> 0 Or index <> 0 Or identity <> 0 Or Application.Documents.Count = 0 Then GoTo Failed
        Set Doc = ActiveDocument
        If Not (Selection.Document Is Doc) Then GoTo Failed
        ELObserveDocument Doc
        ' A document switch retires this claimed token and creates a request
        ' for the still-active native activation against the newly observed doc.
        If EquationLabNativeCommand("MathTypeBridgeDocumentCaptureRequestToken") <> requestToken Then Exit Sub
        Set shape = ExactSelectedEquation(Selection, Doc)
        If shape Is Nothing Then GoTo Failed
    End If
    If Not (shape.Range.Document Is Doc) Then GoTo Failed
    If shape.Range.StoryType <> wdMainTextStory Then GoTo Failed
    If shape.Range.InlineShapes.Count <> 1 Then GoTo Failed
    If Not Supported(shape) Then GoTo Failed
    ELObserveDocument Doc
    If EquationLabNativeCommand("MathTypeBridgeDocumentCaptureRequestToken") <> requestToken Then Exit Sub
    ' Bound requests use the retained Document+Range and its unchanged index.
    ' Unbound requests use only the exact current OLE selection in ActiveDocument.
    ' Both paths carry a one-shot token into the fresh full-document capture.
    ELCaptureEquation shape, True, True, requestToken
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
    Dim Doc As Document, anchors As Collection, anchor As Range, shape As InlineShape, index As Long, result As Long
    If mBoundDocuments Is Nothing Or mBoundRanges Is Nothing Then GoTo Failed
    Set Doc = mBoundDocuments(CStr(token))
    Set anchors = mBoundRanges(CStr(token))
    index = EquationLabNativeCommand("MathTypeBridgeBackgroundSaveIndex")
    If index <= 0 Or index > anchors.Count Then GoTo Failed
    Set anchor = anchors(index)
    Set shape = ResolveBoundEquation(Doc, anchor, index)
    If shape Is Nothing Then GoTo Failed
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
