import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareLoader,LIBRARY_CANDIDATES} from './prepare-loader.mjs';

test('Startup loader binds both calls to one fixed system path without user or app-location literals',async()=>{
 for(const variant of ['product','office']){
  const {source,contract}=await prepareLoader({variant});assert.equal(contract.declarations.length,2);
  assert.deepEqual(contract.declarations.map(d=>d.library),[LIBRARY_CANDIDATES[variant],LIBRARY_CANDIDATES[variant]]);
  assert.deepEqual(contract.declarations.map(d=>d.symbol),['MathTypeBridgeRegisterMathTypeClasses','MathTypeBridgeMathTypeRegistrationState']);
  assert.doesNotMatch(source,/\/Users\/|\/Applications\/|~\//);assert.equal(contract.compiledTemplateAvailable,false);assert.equal(contract.validatedInWord,false);assert.equal(contract.installed,false);
 }
});

test('Startup source uses AutoExec registration, no per-document mutation or VBA project self-editing',async()=>{
 const {source}=await prepareLoader();assert.match(source,/Public Sub AutoExec\(\)/);
 assert.match(source,/mNativeResult = ELRegisterClasses\(\)/);assert.match(source,/mConnected = \(ELRegistrationState\(\) = 1\)/);
 assert.doesNotMatch(source,/Public Sub AutoOpen|Public Sub AutoExit|VBProject|VBComponents|NormalTemplate|ActiveDocument|AppleScriptTask|MacScript|Shell\s*\(/i);
 assert.ok(source.indexOf('If ELRegistrationState() = 1 Then')<source.indexOf('mNativeResult = ELRegisterClasses()'));
 assert.match(source,/mBindingError = Err.Number/);assert.match(source,/EquationLabShowConnectionStatus/);
 await assert.rejects(prepareLoader({variant:'user-home'}),/Unknown fixed-path/);
});

test('Only exact selections reuse saved snapshots durably; ordinary fallback keeps the short window',async()=>{
 const source=await readFile(new URL('./EquationLabDocumentContext.bas',import.meta.url),'utf8');
 const reuse=source.slice(source.indexOf('If Not forceSnapshot And mSnapshotReady'),source.indexOf('Set mEquations = New Collection'));
 assert.match(reuse,/mSnapshotIdentity/);assert.match(reuse,/mSnapshotGeneration/);assert.match(reuse,/mSnapshotEnd/);assert.match(reuse,/mSnapshotShapes/);
 assert.match(reuse,/isSaved = mSnapshotSaved/);assert.match(reuse,/\(\(selectionBound And isSaved\) Or elapsed < 0\.5\)/);
 assert.match(reuse,/If selectionBound Then\s+selectionText = "ELSEL4" & vbLf & CStr\(mSnapshotIdentity\) & vbLf & CStr\(mSnapshotToken\) & vbLf & CStr\(selected\)\s+Else\s+selectionText = CStr\(selected\)\s+End If/);
 assert.doesNotMatch(reuse,/CaptureTiming/);
 const full=source.slice(source.indexOf("ELCaptureTimingMarker \"MathTypeBridgeCaptureTimingStart\""),source.indexOf('If result = 0 Then RememberSnapshot'));
 assert.ok(full.indexOf('MathTypeBridgeCaptureTimingStart')<full.indexOf('mDocument.Content.WordOpenXML'));
 assert.ok(full.indexOf('MathTypeBridgeCaptureTimingXMLReady')<full.indexOf('ELWriteUtf8 directory & "/.EquationLab/document-context.txt"'));
 assert.ok(full.indexOf('ELWriteUtf8 directory & "/.EquationLab/document-context.txt"')<full.indexOf('MathTypeBridgeCaptureTimingFileReady'));
});
