import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const vba=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabRibbon.bas',import.meta.url),'utf8');
const source=vba.slice(vba.indexOf('Private Function ReferenceDisplayText'),vba.indexOf("' Shared by the Ribbon and Word's assignable macro commands."));
test('reference selection binds one document, cursor and bookmarked number before native UI',()=>{
 assert.doesNotMatch(source,/InputBox\(/);
 assert.match(source,/Set Doc = Selection\.Document/);assert.match(source,/Set target = Selection\.Range\.Duplicate/);
 assert.ok(source.indexOf('Set Doc = Selection.Document')<source.indexOf('answer = ChooseReference'));
 assert.ok(source.indexOf('originalTexts.Add selectedNumber.Text')<source.indexOf('answer = ChooseReference'));
 assert.match(source,/If Not \(Selection\.Document Is Doc\) Then Err\.Raise/);
 assert.match(source,/target\.Start <> originalStart Or target\.End <> originalEnd/);
 assert.match(source,/selectedNumber\.Text <> CStr\(originalTexts\(index\)\)/);
 assert.match(source,/If Not Doc\.Bookmarks\.Exists\(answer\)/);
 assert.match(source,/Set field = Doc\.Fields\.Add\(Range:=target/);
 assert.doesNotMatch(source,/ActiveDocument\.Fields\.Add|Range:=Selection\.Range/);
});
test('reference cancellation, protected targets and error recovery have explicit bounded paths',()=>{
 assert.match(source,/If status = 1 Then Exit Function/);assert.match(source,/If answer = "" Then GoTo Done/);
 assert.match(source,/For i = 1 To 41/);assert.match(source,/names\.Count >= 2000/);
 assert.match(source,/Doc\.ReadOnly Or Doc\.ProtectionType <> wdNoProtection/);
 assert.match(source,/For Each candidate In Application\.Documents/);
 assert.match(source,/Doc\.Bookmarks\.ShowHidden = oldShowHidden/);
 assert.match(source,/undoRecord\.StartCustomRecord "Equation Lab equation reference"/);
 assert.match(source,/Doc\.Undo/);assert.doesNotMatch(source,/Application\.Undo\b/);
 assert.match(source,/Kill WorkDirectory\(\) & "ribbon-reference-picker\.txt"/);
});
