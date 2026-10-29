import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabDocumentContext.bas',import.meta.url),'utf8');
const sub=name=>{const start=source.indexOf(name);assert.ok(start>=0);return source.slice(start,source.indexOf('End Sub',start));};

test('Progressive insertion opens before full serialization with an exact retained Range',()=>{
 const begin=sub('Public Sub ELBeginEquationInsertion('),partial=begin.slice(begin.indexOf('If (mInsertionCount > 20'),begin.indexOf('xml = mInsertionDocument.Content.WordOpenXML'));
 assert.match(partial,/MathTypeBridgeInsertionProgressiveSupport/);assert.match(partial,/mInsertionRange\.WordOpenXML/);assert.match(partial,/mInsertionAfter\.WordOpenXML/);assert.match(partial,/ELINS1/);assert.match(partial,/GoTo InsertionPrepared/);
 assert.doesNotMatch(partial,/Content\.WordOpenXML|\.Save\b|InsertFile/);
 const apply=sub('Private Sub ApplyInsertion(');
 assert.match(apply,/KnownDocumentIdentity\(Doc\) <> mInsertionIdentity/);
 assert.match(apply,/ResolveBoundEquation\(Doc, mInsertionAfter, mInsertionAfterIndex \+ 1\)/);
 assert.ok(apply.indexOf('originalAfter.Range.WordOpenXML <> mInsertionAfterXml')<apply.indexOf('mutationAttempted = True'));
 assert.ok(apply.indexOf('mInsertionRange.Start <> mInsertionRange.End')<apply.indexOf('mutationAttempted = True'));
});

test('Insertion enrichment shares the bounded chunk reader without blocking completion or changing Selection',()=>{
 const begin=sub('Private Sub ELBeginInsertionDocumentChunks('),chunk=sub('Private Sub ELContinueDocumentChunks()'),poll=sub('Public Sub ELPollNavigation()');
 assert.match(begin,/Content\.Text <> mInsertionText/);assert.match(begin,/equations.Count <> mInsertionCount/);assert.match(begin,/KnownDocumentIdentity\(mInsertionDocument\) <> mInsertionIdentity/);
 assert.match(chunk,/ELDocumentChunkRequestToken\(\) <> token/);assert.match(chunk,/ELIPART1/);assert.match(chunk,/MathTypeBridgeQueueInsertionDocumentChunk/);assert.match(chunk,/MathTypeBridgeFailInsertionDocumentCapture/);
 assert.doesNotMatch(begin+chunk,/\.Select\b|\.Activate\b|\.Save\b|\.Content\.WordOpenXML/);
 assert.ok(poll.indexOf('ApplyInsertion insertionToken')<poll.indexOf('ELBeginInsertionDocumentChunks insertionDocumentToken'));
 assert.match(sub('Private Sub ClearInsertion()'),/If mChunkInsertion Then ELClearDocumentChunks/);
});
