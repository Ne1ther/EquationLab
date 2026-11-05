import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Word insertion reads an owned unique basename rather than a reused source document',async()=>{
 const source=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabDocumentContext.bas',import.meta.url),'utf8');
 const start=source.indexOf('Private Function ELInsertionFileName()'),end=source.indexOf('End Function',start),name=source.slice(start,end);
 assert.match(name,/MathTypeBridgeInsertionFileNameNext/);
 assert.match(name,/unit < 0[\s\S]*?Len\(name\) >= 80/);
 assert.match(name,/Len\(prefix\) \+ 32 \+ 5/);
 assert.match(name,/"0123456789abcdef"/);
 const apply=source.slice(source.indexOf('Private Sub ApplyInsertion('),source.indexOf('Private Sub AdvanceInsertionCursor'));
 assert.match(apply,/If token <> mInsertionToken Or mInsertionToken <= 0 Then GoTo Failed/);
 assert.match(apply,/insertionFileName = ELInsertionFileName\(\)/);
 assert.match(apply,/target\.InsertFile FileName:=directory & "\/\.EquationLab\/" & insertionFileName/);
 assert.doesNotMatch(apply,/ribbon-complete-insert\.docx/);
 assert.match(source,/insertionToken = EquationLabNativeCommand\("MathTypeBridgeTakeInsertionV2"\)/);
});
