Attribute VB_Name = "EquationLabEntryPoints"
Option Explicit

' Keep Word's discoverable macros separate from platform Declare statements.
Public Sub AutoExec()
    EquationLabDynamicStartupLoader.ELConnectNativeAtStartup
    ' Bind application events after Word finishes loading its global templates.
    Application.OnTime When:=Now + TimeSerial(0, 0, 1), Name:="EquationLabEntryPoints.ELInitializeDocumentEvents"
End Sub

Public Sub ELInitializeDocumentEvents()
    EquationLabDocumentContext.ELStartDocumentEvents
    If Application.Documents.Count > 0 Then EquationLabDocumentContext.ELQueueDisplayRefresh ActiveDocument
End Sub

Public Sub EquationLabShowConnectionStatus()
    EquationLabDynamicStartupLoader.ELShowNativeConnectionStatus
End Sub
