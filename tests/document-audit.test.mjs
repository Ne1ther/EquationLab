import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DOMParser} from '@xmldom/xmldom';
import {auditDocx,getReferenceTargets} from '../src/document-audit.mjs';
import {inspectDocx,NS} from '../src/document.mjs';
import {buildDocumentCompatibilityCorpus,mutateDocument,appendXml} from './helpers/document-compat-corpus.mjs';

const corpusPromise=buildDocumentCompatibilityCorpus();
const fixture=async id=>(await corpusPromise).cases.find(c=>c.id===id).bytes;

test('audit is read-only, indexes exact saved objects and treats chapter resets as information',async()=>{
 const bytes=await fixture('el-chapters-reset'),original=Buffer.from(bytes),audit=await auditDocx(bytes),doc=await inspectDocx(bytes);
 assert.deepEqual(bytes,original);assert.equal(audit.sourceSha256,createHash('sha256').update(bytes).digest('hex'));
 assert.equal(audit.summary.equations,3);assert.equal(audit.targets.length,3);assert.equal(audit.summary.warnings,0);
 assert.deepEqual(audit.equations.map(e=>e.nativeSha256),doc.objects.map(o=>o.nativeSha256));
 assert.deepEqual(audit.targets.map(t=>t.cachedText),['(1.1)','(1.2)','(2.1)']);
 assert.ok(audit.issues.some(i=>i.code==='explicit-sequence-reset'));assert.ok(audit.issues.every(i=>i.severity==='info'));
 assert.equal(audit.targets[0].referenceIds.length,1);assert.equal(audit.coverage.liveWordPositions,false);
 assert.equal(getReferenceTargets(audit,{query:'2.1'})[0].bookmark,'EL_CORPUS_3');
});

test('nested legacy fields and hidden bookmark names remain distinct from Equation Lab targets',async()=>{
 const audit=await auditDocx(await fixture('legacy-nested-fields'));
 assert.equal(audit.targets.length,3);assert.ok(audit.targets.every(t=>t.family==='mathtype'));
 assert.ok(audit.targets.every(t=>t.bookmark.startsWith('_RefCorpus')));assert.equal(audit.summary.warnings,0);
 assert.equal(audit.references.filter(r=>r.family==='mathtype').length,2);
 assert.equal(audit.targets[0].fieldIds.length,2,'chapter and nested equation sequence both survive the outer macro field');
 assert.deepEqual(audit.equations.map(e=>e.nativeSha256),(await auditDocx(await fixture('el-chapters-reset'))).equations.map(e=>e.nativeSha256));
});

test('broken, locked and unknown numbering are reported without treating Figure sequences as equations',async()=>{
 const audit=await auditDocx(await fixture('broken-locked-manual'));
 assert.equal(audit.issues.filter(i=>i.code==='broken-reference').length,1);
 assert.equal(audit.issues.find(i=>i.code==='broken-reference').bookmark,'EL_MISSING');
 assert.equal(audit.issues.filter(i=>i.code==='locked-numbering-field').length,1);
 assert.equal(audit.issues.find(i=>i.code==='locked-numbering-field').severity,'info');
 assert.equal(audit.targets.find(t=>t.bookmark==='EL_UNKNOWN').family,'unknown');
 assert.ok(!getReferenceTargets(audit).some(t=>t.bookmark==='EL_UNKNOWN'));
 assert.ok(!audit.issues.some(i=>i.value===99));
});

test('references in a footnote resolve against the document-wide bookmark index',async()=>{
 const audit=await auditDocx(await fixture('cross-story-reference'));
 const ref=audit.references.find(r=>r.location.part==='word/footnotes.xml');
 assert.equal(ref.state,'resolved');assert.equal(ref.bookmark,'EL_CORPUS_1');
 assert.equal(audit.targets[0].referenceIds.length,2);assert.equal(audit.summary.warnings,0);
});

test('mixed formats and heading-dependent resets remain explicit, informational unknowns',async()=>{
 const audit=await auditDocx(await fixture('mixed-and-heading-reset'));
 assert.ok(audit.issues.some(i=>i.code==='mixed-number-formats'&&i.severity==='info'));
 const unknown=audit.issues.find(i=>i.code==='unknown-numbering-semantics');
 assert.ok(unknown.switches.includes('\\s'));assert.equal(unknown.severity,'info');
 assert.equal(audit.summary.warnings,0,'legal heading restarts are not asserted to be broken');
});

test('duplicate bookmark identities are ambiguous rather than silently resolved to the first one',async()=>{
 const bytes=await mutateDocument(await fixture('el-chapters-reset'),doc=>{
  const starts=Array.from(doc.getElementsByTagNameNS(NS.w,'bookmarkStart'));starts[1].setAttributeNS(NS.w,'w:name',starts[0].getAttributeNS(NS.w,'name'));
 });
 const audit=await auditDocx(bytes);
 assert.ok(audit.issues.some(i=>i.code==='duplicate-bookmark-name'));
 assert.equal(audit.references.find(r=>r.bookmark==='EL_CORPUS_1').state,'ambiguous');
 assert.equal(audit.references.find(r=>r.bookmark==='EL_CORPUS_1').targetId,null);
 assert.ok(!getReferenceTargets(audit).some(t=>t.bookmark==='EL_CORPUS_1'));
});

test('tracked references are not reported as broken before Word accepts or rejects the revision',async()=>{
 const bytes=await mutateDocument(await fixture('el-chapters-reset'),doc=>appendXml(doc,'<w:p><w:del w:id="400"><w:fldSimple w:instr="REF EL_REMOVED"><w:r><w:t>old</w:t></w:r></w:fldSimple></w:del></w:p>'));
 const audit=await auditDocx(bytes);assert.equal(audit.references.find(r=>r.bookmark==='EL_REMOVED').state,'review-dependent');
 assert.equal(audit.summary.warnings,0);assert.ok(audit.issues.some(i=>i.code==='tracked-reference'));
});

test('malformed field structure is reported and field instructions are never executed',async()=>{
 const bytes=await mutateDocument(await fixture('el-chapters-reset'),doc=>appendXml(doc,'<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>MACROBUTTON DoNotRunAnything</w:instrText></w:r></w:p>'));
 const audit=await auditDocx(bytes);assert.ok(audit.issues.some(i=>i.code==='unclosed-field'));
 assert.equal(audit.summary.equations,3);assert.equal(audit.coverage.readOnly,true);
});

test('the fixed compatibility corpus is original, repeatable and has no externally supplied documents',async()=>{
 const a=await corpusPromise,b=await buildDocumentCompatibilityCorpus();assert.equal(a.origin,'original-generated');
 assert.deepEqual(a.cases.map(c=>c.id),b.cases.map(c=>c.id));
 for(let i=0;i<a.cases.length;i++)assert.deepEqual(a.cases[i].bytes,b.cases[i].bytes,a.cases[i].id);
});

test('a chapter bookmark enclosing several numbered paragraphs remains a general reference target',async()=>{
 const input=await mutateDocument(await fixture('el-chapters-reset'),doc=>{
  const body=doc.getElementsByTagNameNS(NS.w,'body')[0],start=doc.createElementNS(NS.w,'w:bookmarkStart'),end=doc.createElementNS(NS.w,'w:bookmarkEnd');
  start.setAttributeNS(NS.w,'w:id','1201');start.setAttributeNS(NS.w,'w:name','SyntheticChapter');end.setAttributeNS(NS.w,'w:id','1201');
  body.insertBefore(start,body.firstChild);body.appendChild(end);
  appendXml(doc,'<w:p><w:fldSimple w:instr="REF SyntheticChapter"><w:r><w:t>Chapter reference</w:t></w:r></w:fldSimple></w:p>');
 });
 const audit=await auditDocx(input);
 assert.equal(audit.targets.length,3);assert.ok(audit.targets.every(target=>target.bookmark!=='SyntheticChapter'));
 const reference=audit.references.find(item=>item.bookmark==='SyntheticChapter');assert.equal(reference.state,'resolved');assert.equal(reference.family,'other');assert.equal(reference.targetId,null);
 assert.equal(audit.summary.equationReferences,2);assert.ok(audit.targets.every(target=>target.cachedText.length<=128));
});

async function savedLegacyDisplay({bookmark=false,prefix='(',suffix=''}={}){
 return mutateDocument(await fixture('el-chapters-reset'),doc=>{
  const start=Array.from(doc.getElementsByTagNameNS(NS.w,'bookmarkStart')).find(n=>n.getAttributeNS(NS.w,'name')==='EL_CORPUS_1'),parent=start.parentNode,end=Array.from(doc.getElementsByTagNameNS(NS.w,'bookmarkEnd')).find(n=>n.getAttributeNS(NS.w,'id')===start.getAttributeNS(NS.w,'id'));
  for(let n=start.nextSibling;n&&n!==end;){const next=n.nextSibling;parent.removeChild(n);n=next;}
  const xml=`<root xmlns:w="${NS.w}"><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>MACROBUTTON MTPlaceRef ${prefix}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>SEQ MTEqn \\h</w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:fldSimple w:instr="SEQ MTChap \\c \\* Arabic"><w:r><w:instrText>7</w:instrText></w:r></w:fldSimple><w:r><w:instrText>.</w:instrText></w:r><w:fldSimple w:instr="SEQ MTEqn \\c \\* Arabic"><w:r><w:instrText>4</w:instrText></w:r></w:fldSimple><w:r><w:instrText>)${suffix}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></root>`;
  const fragment=new DOMParser().parseFromString(xml,'application/xml').documentElement;
  for(const node of Array.from(fragment.childNodes))parent.insertBefore(doc.importNode(node,true),end);
  if(!bookmark){parent.removeChild(start);parent.removeChild(end);for(const field of Array.from(doc.getElementsByTagNameNS(NS.w,'fldSimple')))if(/^REF EL_CORPUS_1\b/.test(field.getAttributeNS(NS.w,'instr')))field.parentNode.removeChild(field);}
 });
}

test('an unbookmarked MathType number is indexed from its saved display without inventing a reference anchor',async()=>{
 const audit=await auditDocx(await savedLegacyDisplay()),target=audit.targets.find(t=>t.family==='mathtype');
 assert.equal(target.bookmark,null);assert.equal(target.referenceable,false);assert.equal(target.cachedText,'(7.4)');assert.deepEqual(target.equationIndices,[0]);
 assert.equal(target.equationAssociation,'same-paragraph-single');assert.equal(target.fieldIds.length,3);
 assert.equal(getReferenceTargets(audit,{query:'7.4'}).length,0);assert.equal(audit.summary.warnings,0);
 assert.equal(audit.issues.filter(i=>i.code==='number-without-reference-target').length,1);
});

test('a precise bookmark can contain one hidden increment and its repeated visible equation value',async()=>{
 const audit=await auditDocx(await savedLegacyDisplay({bookmark:true})),targets=audit.targets.filter(t=>t.family==='mathtype');
 assert.equal(targets.length,1);assert.equal(targets[0].bookmark,'EL_CORPUS_1');assert.equal(targets[0].cachedText,'(7.4)');assert.equal(targets[0].referenceable,true);
 assert.equal(targets[0].referenceIds.length,1);assert.equal(getReferenceTargets(audit,{query:'7.4'}).length,1);
});

test('a legacy display longer than the bounded number cache is not exposed as a formula title',async()=>{
 const audit=await auditDocx(await savedLegacyDisplay({prefix:'Long synthetic display '.repeat(10)})),target=audit.targets.find(t=>t.family==='mathtype');
 assert.equal(target.cachedText,'');assert.equal(target.referenceable,false);assert.ok(audit.issues.some(i=>i.code==='number-cache-unavailable'));
});

test('an unsupported reset argument does not consume the following hidden-counter switch',async()=>{
 const input=await mutateDocument(await fixture('el-chapters-reset'),doc=>appendXml(doc,'<w:p><w:fldSimple w:instr="SEQ MTEqn \\r \\h"><w:r><w:t/></w:r></w:fldSimple></w:p>'));
 const audit=await auditDocx(input);assert.equal(audit.targets.length,3);assert.ok(audit.issues.some(i=>i.code==='unknown-numbering-semantics'));
 assert.ok(!audit.issues.some(i=>i.code==='number-without-reference-target'));
});

test('legacy display projection excludes known outer formatting switches but leaves unknown switches unresolved',async()=>{
 for(const suffix of [' \\* MERGEFORMAT',' \\* CHARFORMAT',' \\* MERGEFORMAT \\* CHARFORMAT']){
  const audit=await auditDocx(await savedLegacyDisplay({suffix}));assert.equal(audit.targets.find(t=>t.family==='mathtype').cachedText,'(7.4)');
 }
 const unknown=await auditDocx(await savedLegacyDisplay({suffix:' \\unknown'}));assert.equal(unknown.targets.find(t=>t.family==='mathtype').cachedText,'');assert.ok(unknown.issues.some(i=>i.code==='number-cache-unavailable'));
 for(const prefix of ['\\* MERGEFORMAT (','\\* CHARFORMAT (','\\* MERGEFORMAT \\* CHARFORMAT (']){
  const audit=await auditDocx(await savedLegacyDisplay({prefix}));assert.equal(audit.targets.find(t=>t.family==='mathtype').cachedText,'(7.4)');
 }
});

test('an actual saved macro result remains data rather than being rewritten as field syntax',async()=>{
 const bytes=await mutateDocument(await savedLegacyDisplay(),doc=>{
  const instruction=Array.from(doc.getElementsByTagNameNS(NS.w,'instrText')).find(n=>n.textContent.startsWith('MACROBUTTON MTPlaceRef')),p=instruction.parentNode.parentNode;
  const end=Array.from(p.getElementsByTagNameNS(NS.w,'fldChar')).filter(n=>n.getAttributeNS(NS.w,'fldCharType')==='end').at(-1).parentNode;
  const split=doc.createElementNS(NS.w,'w:r'),marker=doc.createElementNS(NS.w,'w:fldChar');marker.setAttributeNS(NS.w,'w:fldCharType','separate');split.appendChild(marker);p.insertBefore(split,end);
  const result=doc.createElementNS(NS.w,'w:r'),text=doc.createElementNS(NS.w,'w:t');text.textContent='\\* MERGEFORMAT saved display';result.appendChild(text);p.insertBefore(result,end);
 });
 const audit=await auditDocx(bytes);assert.equal(audit.targets.find(t=>t.family==='mathtype').cachedText,'\\* MERGEFORMAT saved display');
});
