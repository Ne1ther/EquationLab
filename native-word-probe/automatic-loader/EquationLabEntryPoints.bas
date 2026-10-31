Attribute VB_Name = "EquationLabEntryPoints"
Option Explicit

' Keep Word's discoverable macros separate from platform Declare statements.

Public Sub ELInitializeDocumentEvents()
    EquationLabDocumentContext.ELStartDocumentEvents
    Dim result As Long
    result = EquationLabNativeCommand("MathTypeBridgeWordHostInitialized")
    EquationLabDocumentContext.ELReportActiveDocument
    EquationLabDocumentContext.ELQueueNativeSessionWatch
    If Application.Documents.Count > 0 Then EquationLabDocumentContext.ELQueueDisplayRefresh ActiveDocument
End Sub

Public Sub EquationLabShowConnectionStatus()
    EquationLabDynamicStartupLoader.ELShowNativeConnectionStatus
End Sub
