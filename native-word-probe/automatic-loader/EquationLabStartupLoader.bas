Attribute VB_Name = "EquationLabStartupLoader"
Option Explicit

' Release-build source. Users install the compiled EquationLabStartup.dotm;
' they do not import this module or run a registration macro manually.
' The fixed library path belongs to the independently installed plugin.
' Do not change Word security preferences, Word.app, Normal.dotm or documents.
#If Mac And VBA7 Then
Private Declare PtrSafe Function ELRegisterClasses Lib "/Library/Application Support/Equation Lab/Word/MathTypeBridgeProbe.bundle/Contents/MacOS/MathTypeBridgeProbe" Alias "MathTypeBridgeRegisterMathTypeClasses" () As Long
Private Declare PtrSafe Function ELRegistrationState Lib "/Library/Application Support/Equation Lab/Word/MathTypeBridgeProbe.bundle/Contents/MacOS/MathTypeBridgeProbe" Alias "MathTypeBridgeMathTypeRegistrationState" () As Long
#End If

Private mStartupAttempted As Boolean
Private mConnected As Boolean
Private mNativeResult As Long
Private mBindingError As Long

Public Sub AutoExec()
    If mStartupAttempted Then Exit Sub
    mStartupAttempted = True
    ConnectNativeBridge
End Sub

Private Sub ConnectNativeBridge()
    On Error GoTo BindingFailed
    mConnected = False
    mBindingError = 0
#If Mac And VBA7 Then
    ' Re-loading the global template during an edit does not re-register.
    If ELRegistrationState() = 1 Then
        mNativeResult = 0
        mConnected = True
        Exit Sub
    End If
    mNativeResult = ELRegisterClasses()
    If mNativeResult = 0 Then mConnected = (ELRegistrationState() = 1)
#Else
    mNativeResult = -1
#End If
    ' Metadata only. No equation, document name, ticket or editor URL is logged.
    Debug.Print "Equation Lab startup result="; mNativeResult; "; connected="; mConnected
    Exit Sub
BindingFailed:
    mBindingError = Err.Number
    mConnected = False
    Debug.Print "Equation Lab startup binding error="; mBindingError
End Sub

Public Sub EquationLabShowConnectionStatus()
    Dim text As String
    If mConnected Then
        text = "Equation Lab native Word integration is registered for this Word process."
    Else
        text = "Equation Lab native Word integration is not registered." & vbCrLf & _
            "Use Equation Lab to check or repair its Word plugin installation." & vbCrLf & _
            "Native result: " & CStr(mNativeResult) & "; binding error: " & CStr(mBindingError)
    End If
    MsgBox text, IIf(mConnected, vbInformation, vbExclamation), "Equation Lab"
End Sub

' No AutoOpen: document opening does not install or alter anything.
' No AutoExit unregister: the native factory is retained until Word exits.
' No app launch at Word startup: the native transport wakes Equation Lab
' only on an actual edit after connection-refused, using app.equationlab.mac.
