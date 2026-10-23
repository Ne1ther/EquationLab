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
    EquationLabDocumentContext.ELQueueWorkspaceRefresh
    EquationLabDocumentContext.ELWatchNativeSession
End Sub

Private Sub Host_DocumentBeforeClose(ByVal Doc As Document, Cancel As Boolean)
    ' Word raises this before the close has committed. Reconcile after the
    ' event so a cancelled close stays in Application.Documents and retains
    ' its identity and anchors.
    EquationLabDocumentContext.ELQueueWorkspaceRefresh
End Sub

Private Sub Host_WindowBeforeDoubleClick(ByVal Sel As Selection, Cancel As Boolean)
    On Error GoTo Failed
    Dim target As InlineShape
    Set target = EquationLabDocumentContext.ELSelectedEquation(Sel)
    If Not target Is Nothing Then
        ' The exact OLE character is enough, including Word's blue text
        ' selection. Own this gesture once, rather than also allowing Word's
        ' default double-click to change selection and activate it again.
        Cancel = True
        EquationLabDocumentContext.ELOpenEquation target
    End If
    ' Word can bypass this event for a native OLE double-click. Its existing
    ' DoVerb path and exact selection pre-capture remain available.
    EquationLabDocumentContext.ELQueueNativeSessionWatch
    Exit Sub
Failed:
    MsgBox "Equation Lab: " & Err.Description, vbExclamation, "Equation Lab"
End Sub
