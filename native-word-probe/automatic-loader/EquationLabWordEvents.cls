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
    ' macOS can activate OLE before its double-click callback reaches VBA.
    ' Capture only an explicitly selected object, while the native session is idle.
    EquationLabDocumentContext.ELObserveDocument Sel.Document
    EquationLabDocumentContext.ELCaptureSelection Sel, False
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
    EquationLabDocumentContext.ELCaptureSelection Sel
End Sub
