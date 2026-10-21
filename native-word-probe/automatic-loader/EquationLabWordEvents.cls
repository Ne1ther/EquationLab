VERSION 1.0 CLASS
BEGIN
  MultiUse = -1
END
Attribute VB_Name = "EquationLabWordEvents"
Attribute VB_GlobalNameSpace = False
Attribute VB_Creatable = False
Attribute VB_PredeclaredId = False
Attribute VB_Exposed = False
Option Explicit

Public WithEvents Host As Word.Application

Private Sub Host_WindowSelectionChange(ByVal Sel As Selection)
    EquationLabDocumentContext.ELObserveDocument Sel.Document
    If EquationLabNativeCommand("MathTypeBridgeTransportActive") = 0 Then
        ' Capture an exact OLE selection before Word enters its native verb.
        EquationLabDocumentContext.ELCaptureSelection Sel, True
    Else
        ' While an editor is active, keep the existing lightweight selection path.
        EquationLabDocumentContext.ELCaptureSelection Sel
    End If
End Sub

Private Sub Host_WindowActivate(ByVal Doc As Document, ByVal Wn As Window)
    EquationLabDocumentContext.ELObserveDocument Doc
    EquationLabDocumentContext.ELQueueDisplayRefresh Doc
End Sub

Private Sub Host_DocumentOpen(ByVal Doc As Document)
    EquationLabDocumentContext.ELQueueDisplayRefresh Doc
End Sub

Private Sub Host_WindowDeactivate(ByVal Doc As Document, ByVal Wn As Window)
    EquationLabDocumentContext.ELWatchNativeSession
End Sub

Private Sub Host_DocumentBeforeClose(ByVal Doc As Document, Cancel As Boolean)
    EquationLabDocumentContext.ELCloseDocumentContext Doc
End Sub

Private Sub Host_WindowBeforeDoubleClick(ByVal Sel As Selection, Cancel As Boolean)
    ' Leave Word's normal OLE activation intact.
    ' Arm one exact Doc+Range for the immediately following DoVerb. Native
    ' consumes it once, then asks VBA for a fresh ELCTX4 full-document capture.
    EquationLabDocumentContext.ELCaptureSelection Sel, True
    ' Word may publish the exact OLE selection only after this callback. Keep
    ' the OnTime poll alive so a newly created native request gets serviced.
    EquationLabDocumentContext.ELQueueNativeSessionWatch
End Sub
