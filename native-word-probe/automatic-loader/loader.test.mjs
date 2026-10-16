import test from 'node:test';
import assert from 'node:assert/strict';
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
