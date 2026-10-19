Attribute VB_Name = "EquationLabDocumentContext"
Option Explicit

Private mEvents As EquationLabWordEvents
Private mDocument As Document
Private mEquations As Collection
Private mPollScheduled As Boolean
Private mPaintDocument As Document

Public Sub ELStartDocumentEvents()
    If mEvents Is Nothing Then Set mEvents = New EquationLabWordEvents
    Set mEvents.Host = Word.Application
End Sub

Public Sub ELQueueDisplayRefresh(ByVal Doc As Document)
    On Error GoTo Missing
    Dim shape As InlineShape
    For Each shape In Doc.InlineShapes
        If Supported(shape) Then
            Set mPaintDocument = Doc
            SchedulePoll
            Exit Sub
        End If
    Next
Missing:
End Sub

Public Sub ELClearDocumentContext()
    On Error Resume Next
    Dim result As Long
    result = EquationLabNativeCommand("MathTypeBridgeClearDocumentContext")
    ' Word can reactivate after the old OLE session ends but before the
    ' scheduled navigation callback runs. Keep its document binding until
    ' that callback consumes the requested target.
    If EquationLabNativeCommand("MathTypeBridgeTransportActive") = 0 And Not mPollScheduled Then
        Set mEquations = Nothing
        Set mDocument = Nothing
    End If
End Sub

Public Sub ELWatchNativeSession()
    On Error GoTo Missing
    If EquationLabNativeCommand("MathTypeBridgeTransportActive") <> 0 Then SchedulePoll
Missing:
End Sub

Private Function Supported(ByVal shape As InlineShape) As Boolean
    On Error GoTo Missing
    Dim id As String
    id = shape.OLEFormat.ProgID
    Supported = (id = "Equation.DSMT4" Or id = "Equation.3")
Missing:
End Function

Public Sub ELCaptureSelection(ByVal selected As Selection)
    On Error GoTo Missing
    If selected.Range.StoryType <> wdMainTextStory Then Exit Sub
    Dim shapes As InlineShapes
    Set shapes = selected.InlineShapes
    If shapes.Count = 0 Then Set shapes = selected.Paragraphs(1).Range.InlineShapes
    If shapes.Count = 1 Then ELCaptureEquation shapes(1)
Missing:
End Sub

Public Sub ELCaptureEquation(ByVal target As InlineShape)
    On Error GoTo Failed
    If Not Supported(target) Then Exit Sub
    If EquationLabNativeCommand("MathTypeBridgeTransportActive") <> 0 Then
        If EquationLabNativeCommand("MathTypeBridgeDocumentCaptureAllowed") = 0 Then SchedulePoll: Exit Sub
    End If
    If target.Range.StoryType <> wdMainTextStory Then Exit Sub
    Dim shape As InlineShape, selected As Long, index As Long, directory As String, xml As String, result As Long
    Set mDocument = target.Range.Document
    Set mEquations = New Collection
    selected = -1
    For Each shape In mDocument.InlineShapes
        If Supported(shape) Then
            If shape.Range.Start = target.Range.Start Then selected = index
            mEquations.Add shape
            index = index + 1
        End If
    Next
    If selected < 0 Then Exit Sub
    ' WordOpenXML reflects the live document, including unsaved edits. Never
    ' save, rename, or alter the user's document to obtain this snapshot.
    xml = mDocument.Content.WordOpenXML
    If Len(xml) > 30000000 Then Exit Sub
    directory = Options.DefaultFilePath(wdStartupPath)
    Do While Right$(directory, 1) = "/": directory = Left$(directory, Len(directory) - 1): Loop
    ELWriteUtf8 directory & "/.EquationLab/document-context.txt", CStr(selected) & vbLf & Replace(Replace(mDocument.Name, vbCr, " "), vbLf, " ") & vbLf & xml
    result = EquationLabNativeCommand("MathTypeBridgeCaptureDocument")
    If result = 0 Then SchedulePoll
    Exit Sub
Failed:
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
                    Application.ScreenUpdating = True
                End If
            End If
        End If
        Set mPaintDocument = Nothing
    End If
    Dim target As Long, shape As InlineShape
    target = EquationLabNativeCommand("MathTypeBridgeTakeNavigation")
    If target <= 0 Then
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
