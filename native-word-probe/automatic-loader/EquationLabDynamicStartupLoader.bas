Attribute VB_Name = "EquationLabDynamicStartupLoader"
Option Explicit

' Native arm64 candidate, independently verified in CLI; Word VBA/AutoExec
' acceptance is still required before this is distributed as a compiled dotm.
' All Declare Lib names are macOS system libraries. The own bundle path is
' resolved from Word's actual Startup folder; no user/app path is compiled in.
#If Mac And VBA7 Then
Private Declare PtrSafe Function ELdlopen Lib "/usr/lib/libSystem.B.dylib" Alias "dlopen" (ByRef pathname As Byte, ByVal mode As Long) As LongPtr
Private Declare PtrSafe Function ELdlsym Lib "/usr/lib/libSystem.B.dylib" Alias "dlsym" (ByVal handle As LongPtr, ByRef name As Byte) As LongPtr
Private Declare PtrSafe Function ELcalloc Lib "/usr/lib/libSystem.B.dylib" Alias "calloc" (ByVal count As LongPtr, ByVal size As LongPtr) As LongPtr
Private Declare PtrSafe Sub ELfree Lib "/usr/lib/libSystem.B.dylib" Alias "free" (ByVal pointer As LongPtr)
Private Declare PtrSafe Function ELcopyLong Lib "/usr/lib/libSystem.B.dylib" Alias "memcpy" (ByRef destination As Long, ByVal source As LongPtr, ByVal count As LongPtr) As LongPtr
Private Declare PtrSafe Function ELffiPrep Lib "/usr/lib/libffi.dylib" Alias "ffi_prep_cif" (ByVal cif As LongPtr, ByVal abi As Long, ByVal nargs As Long, ByVal returnType As LongPtr, ByVal argTypes As LongPtr) As Long
Private Declare PtrSafe Sub ELffiCall Lib "/usr/lib/libffi.dylib" Alias "ffi_call" (ByVal cif As LongPtr, ByVal functionPointer As LongPtr, ByVal result As LongPtr, ByVal arguments As LongPtr)
Private mNativeHandle As LongPtr
Private mFfiHandle As LongPtr
Private mReturnType As LongPtr
#End If

Private mAttempted As Boolean
Private mConnected As Boolean
Private mNativeResult As Long
Private mReceiptResult As Long
Private mBindingError As Long
Private mPhase As String

Public Sub ELConnectNativeAtStartup()
    If mAttempted Then Exit Sub
    mAttempted = True
    ConnectDynamicBridge
End Sub

Private Sub ConnectDynamicBridge()
    On Error GoTo Failed
    mConnected = False
    mBindingError = 0
    mReceiptResult = -1001
#If Mac And VBA7 Then
    Dim startup As String
    Dim libraryPath As String
    Dim bytes() As Byte
    Dim receiptFunction As LongPtr
    mPhase = "startup-path"
    startup = Options.DefaultFilePath(wdStartupPath)
    ' Current target is modern Word with POSIX Startup paths. An unknown HFS
    ' or relative path is an explicit failure, never a guessed filesystem path.
    If Len(startup) < 2 Or Left$(startup, 1) <> "/" Then
        Err.Raise vbObjectError + 7301, "Equation Lab", "Word Startup must be an absolute POSIX path."
    End If
    Do While Right$(startup, 1) = "/"
        startup = Left$(startup, Len(startup) - 1)
    Loop
    libraryPath = startup & "/MathTypeBridgeProbe.bundle/Contents/MacOS/MathTypeBridgeProbe"
    mPhase = "load-libffi"
    EncodeUtf8Z "/usr/lib/libffi.dylib", bytes
    mFfiHandle = ELdlopen(bytes(0), 6) ' RTLD_NOW 2 | RTLD_LOCAL 4
    If mFfiHandle = 0 Then Err.Raise vbObjectError + 7302, "Equation Lab", "System libffi could not load."
    mReturnType = FindSymbol(mFfiHandle, "ffi_type_sint32")
    If mReturnType = 0 Then Err.Raise vbObjectError + 7303, "Equation Lab", "System int32 ffi type is unavailable."
    mPhase = "load-own-bundle"
    EncodeUtf8Z libraryPath, bytes
    mNativeHandle = ELdlopen(bytes(0), 6)
    If mNativeHandle = 0 Then Err.Raise vbObjectError + 7304, "Equation Lab", "Equation Lab native Word component could not load."
    mPhase = "registration-state"
    If CallOwnInt32("MathTypeBridgeMathTypeRegistrationState") = 1 Then
        mNativeResult = 0
        mConnected = True
    Else
        mPhase = "register-classes"
        mNativeResult = CallOwnInt32("MathTypeBridgeRegisterMathTypeClasses")
        If mNativeResult = 0 Then mConnected = (CallOwnInt32("MathTypeBridgeMathTypeRegistrationState") = 1)
    End If
    If mConnected Then
        mPhase = "startup-receipt"
        ' Optional stable zero-argument ABI for the upcoming native receipt
        ' implementation. A missing receipt never proves installer verification.
        receiptFunction = FindSymbol(mNativeHandle, "MathTypeBridgeWriteStartupReceipt")
        If receiptFunction <> 0 Then mReceiptResult = InvokeInt32(receiptFunction)
        mPhase = "registered"
    End If
    ' Keep native and libffi handles for the Word process lifetime. Registered
    ' callbacks must not be invalidated when a global template is unloaded.
#Else
    mNativeResult = -1
    mPhase = "unsupported-host"
#End If
    Debug.Print "Equation Lab startup phase="; mPhase; "; native="; mNativeResult; "; receipt="; mReceiptResult; "; connected="; mConnected
    Exit Sub
Failed:
    mBindingError = Err.Number
    mConnected = False
    Debug.Print "Equation Lab startup phase="; mPhase; "; binding="; mBindingError
End Sub

#If Mac And VBA7 Then
Private Function FindSymbol(ByVal handle As LongPtr, ByVal name As String) As LongPtr
    Dim bytes() As Byte
    EncodeUtf8Z name, bytes
    FindSymbol = ELdlsym(handle, bytes(0))
End Function

Private Function CallOwnInt32(ByVal name As String) As Long
    Dim pointer As LongPtr
    pointer = FindSymbol(mNativeHandle, name)
    If pointer = 0 Then Err.Raise vbObjectError + 7305, "Equation Lab", "Required native entry point is unavailable."
    CallOwnInt32 = InvokeInt32(pointer)
End Function

Private Function InvokeInt32(ByVal pointer As LongPtr) As Long
    On Error GoTo Failed
    Dim cif As LongPtr
    Dim result As LongPtr
    Dim ignored As LongPtr
    Dim value As Long
    Dim status As Long
    Dim number As Long
    Dim description As String
    If pointer = 0 Then Err.Raise vbObjectError + 7305, "Equation Lab", "Cannot call a missing entry point."
    ' arm64 SDK proof: FFI_DEFAULT_ABI=1; ffi_cif size40/align8; ffi_arg size8.
    ' calloc supplies native alignment. Never use a four-byte result allocation:
    ' libffi writes ffi_arg width even for an int32 return type.
    cif = ELcalloc(1, 256)
    result = ELcalloc(1, 8)
    If cif = 0 Or result = 0 Then Err.Raise vbObjectError + 7306, "Equation Lab", "Native call allocation failed."
    status = ELffiPrep(cif, 1, 0, mReturnType, 0)
    If status <> 0 Then Err.Raise vbObjectError + 7307, "Equation Lab", "Unsupported native libffi ABI."
    ELffiCall cif, pointer, result, 0
    ignored = ELcopyLong(value, result, 4)
    InvokeInt32 = value
    ELfree result
    ELfree cif
    Exit Function
Failed:
    number = Err.Number
    description = Err.Description
    If result <> 0 Then ELfree result
    If cif <> 0 Then ELfree cif
    Err.Raise number, "Equation Lab", description
End Function

Private Sub EncodeUtf8Z(ByVal value As String, ByRef bytes() As Byte)
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
    bytes(used) = 0
    ReDim Preserve bytes(0 To used)
End Sub
#End If

Public Sub ELShowNativeConnectionStatus()
    MsgBox "Connected: " & CStr(mConnected) & vbCrLf & _
        "Phase: " & mPhase & vbCrLf & "Native result: " & CStr(mNativeResult) & vbCrLf & _
        "Startup receipt: " & CStr(mReceiptResult) & vbCrLf & "VBA binding error: " & CStr(mBindingError), _
        IIf(mConnected, vbInformation, vbExclamation), "Equation Lab"
End Sub

Public Function EquationLabNativeCommand(ByVal name As String) As Long
    If Not mConnected Then ConnectDynamicBridge
    If Not mConnected Then Err.Raise vbObjectError + 7310, "Equation Lab", "Word native component is not connected."
#If Mac And VBA7 Then
    EquationLabNativeCommand = CallOwnInt32(name)
#Else
    EquationLabNativeCommand = -1
#End If
End Function
