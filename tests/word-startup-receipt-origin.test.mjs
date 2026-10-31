import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateStartupSource} from '../packaging/word-native-installer/artifacts.mjs';

test('artifact source validation accepts both documented single AutoExec forms', async()=>{
 const startup=await readFile(new URL('../native-word-probe/automatic-loader/AutoExec.bas',import.meta.url),'utf8');
 const entries=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabEntryPoints.bas',import.meta.url),'utf8');
 assert.deepEqual(validateStartupSource(startup+'\n'+entries),{module:'AutoExec',form:'module-main'});
 assert.deepEqual(validateStartupSource('Public Sub AutoExec()\nEnd Sub\n'),{module:null,form:'procedure'});
 assert.deepEqual(validateStartupSource('Public Sub AutoExec\nEnd Sub\n'),{module:null,form:'procedure'});
 assert.deepEqual(validateStartupSource('Attribute VB_Name = "LegacyLoader"\r\nPublic Sub AutoExec()\r\nEnd Sub\r\n'),{module:'LegacyLoader',form:'procedure'});
});

test('artifact source validation rejects ambiguous and undiscoverable startup entries',()=>{
 const main='Attribute VB_Name = "AutoExec"\nPublic Sub Main()\nEnd Sub\n';
 const legacy='Attribute VB_Name = "LegacyLoader"\nPublic Sub AutoExec()\nEnd Sub\n';
 for(const source of [main+legacy,legacy+legacy,main.replace('Public','Private'),main.replace('Main()','Main(value As Long)'),main.replace('"AutoExec"','"OtherModule"'),main.replace('Public Sub','Option Private Module\nPublic Sub'),main.replace('Public Sub Main()\nEnd Sub',''),main+main]){
  assert.throws(()=>validateStartupSource(source),/Startup entry|AutoExec entry|Duplicate VBA module/);
 }
 assert.throws(()=>validateStartupSource("' Public Sub AutoExec()\nRem Public Sub AutoExec()\n"),/AutoExec entry/);
 assert.throws(()=>validateStartupSource(main+'Public Sub AutoExec\nEnd Sub\n'),/AutoExec entry/);
 assert.throws(()=>validateStartupSource(main+'Private Sub AutoExec\nEnd Sub\n'),/Startup entry/);
 assert.throws(()=>validateStartupSource(main.replace('Main()', 'Main( _\n value As Long)')),/Startup entry/);
 assert.throws(()=>validateStartupSource(main+main.replace('Attribute VB_Name', '  attribute vb_name')),/Duplicate VBA module/);
 assert.throws(()=>validateStartupSource(main+"Public Static Sub AutoExec()\nEnd Sub\n"),/Startup entry/);
 assert.throws(()=>validateStartupSource(main.replace('Public Sub',"Option Private Module 'hidden\nPublic Sub")),/Startup entry/);
});

test('dynamic loader separates AutoExec and lazy receipt origins while retaining the arm64 libffi ABI', async()=>{
 const source=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabDynamicStartupLoader.bas',import.meta.url),'utf8');
 const part=(start,end)=>{const begin=source.indexOf(start);assert.notEqual(begin,-1);const finish=source.indexOf(end,begin);assert.notEqual(finish,-1);return source.slice(begin,finish);};
 const startup=part('Public Sub ELConnectNativeAtStartup()', 'End Sub');
 assert.match(startup,/^\s*ConnectDynamicBridge True\s*$/m);
 const connect=part('Private Sub ConnectDynamicBridge(', 'End Sub');
 assert.match(connect,/Optional ByVal fromAutoExec As Boolean = False/);
 assert.match(connect,/If fromAutoExec Then\s+receiptName = "MathTypeBridgeWriteStartupReceipt"\s+Else\s+receiptName = "MathTypeBridgeWriteConnectionReceipt"\s+End If\s+receiptFunction = FindSymbol\(mNativeHandle, receiptName\)\s+If receiptFunction <> 0 Then mReceiptResult = InvokeInt32\(receiptFunction\)/);
 const command=part('Public Function EquationLabNativeCommand(', 'End Function');
 assert.match(command,/If Not mConnected Then ConnectDynamicBridge\s*$/m);
 assert.doesNotMatch(command,/ConnectDynamicBridge\s+True|MathTypeBridgeWriteStartupReceipt/);
 const ffi=part('Private Function InvokeInt32(', 'End Function');
 assert.match(source,/Alias "ffi_prep_cif"/);assert.match(source,/Alias "ffi_call"/);
 assert.match(connect,/FindSymbol\(mFfiHandle, "ffi_type_sint32"\)/);
 assert.match(ffi,/cif = ELcalloc\(1, 256\)/);assert.match(ffi,/result = ELcalloc\(1, 8\)/);
 assert.match(ffi,/ELffiPrep\(cif, 1, 0, mReturnType, 0\)/);assert.match(ffi,/ELffiCall cif, pointer, result, 0/);
 assert.match(ffi,/ELcopyLong\(value, result, 4\)/);assert.match(ffi,/If result <> 0 Then ELfree result\s+If cif <> 0 Then ELfree cif/);
});
