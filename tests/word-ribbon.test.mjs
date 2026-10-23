import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import sharp from 'sharp';
import JSZip from 'jszip';
import {validateRibbonAcceptance,validateRibbonTemplateZip} from '../packaging/word-native-installer/artifacts.mjs';

await import('../word-ribbon/command-registry.js');
const registry=globalThis.EquationLabCommands;
const execFileAsync=promisify(execFile);

test('native Word Ribbon registry contains complete, taskpane-free command metadata',async()=>{
 assert.equal(registry.groups.length,5);assert.equal(registry.commands.length,19);
 assert.equal(new Set(registry.commands.map(command=>command.id)).size,registry.commands.length);
 for(const group of registry.groups)for(const id of group.commands)assert.ok(registry.get(id),`${group.id}: ${id}`);
 for(const command of registry.commands){
  assert.deepEqual(Object.keys(command).sort(),['description','icon','id','label']);
  const image=join(fileURLToPath(new URL('../word-ribbon/icons/',import.meta.url)),`${command.icon}-32.png`);
  const metadata=await sharp(image).metadata();assert.equal(metadata.width,32,command.id);assert.equal(metadata.height,32,command.id);assert.equal(metadata.hasAlpha,true,command.id);
 }
 assert.match(await readFile(new URL('../word-ribbon/icons/lucide/LICENSE',import.meta.url),'utf8'),/ISC License/);
});

test('native Word template builder embeds the retained Ribbon ABI and icons without Office.js routes',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'equationlab-native-ribbon-'));
 const input=join(temp,'input.dotm'),output=join(temp,'output.dotm');
 try{
  const fixture=new JSZip();
  fixture.file('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
  fixture.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
  await writeFile(input,await fixture.generateAsync({type:'nodebuffer'}));
  await execFileAsync(process.execPath,[fileURLToPath(new URL('../native-word-probe/automatic-loader/build-ribbon-template.mjs',import.meta.url)),input,output]);
  const outputBytes=await readFile(output),built=await JSZip.loadAsync(outputBytes),xml=await built.file('customUI/customUI.xml').async('string');
  assert.equal((xml.match(/<group /g)||[]).length,5);assert.equal((xml.match(/<button /g)||[]).length,20);
  assert.match(xml,/tag="open-pane"/);assert.doesNotMatch(xml,/Taskpane|TaskPane|appsforoffice|localhost:37951/);
  assert.deepEqual(await validateRibbonTemplateZip(built),{groups:5,buttons:20,iconRelationships:new Set([...registry.commands.map(command=>command.icon),'inline']).size});
  const relationXml=await built.file('customUI/_rels/customUI.xml.rels').async('string');
  const iconNames=[...relationXml.matchAll(/Target="icons\/([^\"]+)"/g)].map(match=>match[1]);
  assert.equal(new Set(iconNames).size,iconNames.length);
  for(const name of iconNames){
   const bytes=await built.file(`customUI/icons/${name}`).async('nodebuffer');
   assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
   assert.equal(bytes.readUInt32BE(16),32);assert.equal(bytes.readUInt32BE(20),32);
  }
  const noRibbon=await JSZip.loadAsync(outputBytes);noRibbon.remove('customUI/customUI.xml');
  await assert.rejects(validateRibbonTemplateZip(noRibbon),/missing customUI part/);
  const brokenCallback=await JSZip.loadAsync(outputBytes),ribbonXml=await brokenCallback.file('customUI/customUI.xml').async('string');
  brokenCallback.file('customUI/customUI.xml',ribbonXml.replace('tag="open-pane" image="inline" onAction="EquationLabRibbon.ELRibbonAction"','tag="open-pane" image="inline" onAction="Missing.Callback"'));
  await assert.rejects(validateRibbonTemplateZip(brokenCallback),/open-pane callback is missing or invalid/);
  const brokenAsset=await JSZip.loadAsync(outputBytes);brokenAsset.remove(`customUI/icons/${iconNames[0]}`);
  await assert.rejects(validateRibbonTemplateZip(brokenAsset),/missing icon asset/);
  const brokenRoot=await JSZip.loadAsync(outputBytes),rootXml=await brokenRoot.file('_rels/.rels').async('string');
  brokenRoot.file('_rels/.rels',rootXml.replace(/<Relationship Id="EquationLabRibbon"[^>]*\/>/,''));
  await assert.rejects(validateRibbonTemplateZip(brokenRoot),/missing internal Office customUI root relationship/);
 }finally{await rm(temp,{recursive:true,force:true});}
});

test('artifact freezing requires a real Word Ribbon visibility receipt',()=>{
 assert.throws(()=>validateRibbonAcceptance({}),/real Word confirmation/);
 assert.throws(()=>validateRibbonAcceptance({ribbonVerified:false}),/real Word confirmation/);
 assert.equal(validateRibbonAcceptance({ribbonVerified:true}),undefined);
});

test('requested capture uses retained anchors or an exact first selection without activation or periodic XML',async()=>{
 const source=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabDocumentContext.bas',import.meta.url),'utf8');
 const procedure=name=>source.slice(source.indexOf(name),source.indexOf('End Sub',source.indexOf(name))).split('\n').map(line=>line.split("'")[0]).join('\n');
 const remember=procedure('Private Sub RememberSnapshot');
 assert.match(remember,/shape\.Range\.Duplicate/);assert.match(remember,/anchors\.Add anchor/);assert.match(remember,/RememberDocumentRanges mDocument, mSnapshotToken, anchors/);
 const rememberRanges=procedure('Private Sub RememberDocumentRanges');assert.match(rememberRanges,/mBoundRanges\.Add anchors, CStr\(snapshotToken\)/);
 assert.doesNotMatch(remember,/mBoundRanges\.Add mEquations/);
 const capture=procedure('Private Sub ApplyDocumentCaptureRequest');
 assert.match(capture,/mBoundDocuments\(CStr\(snapshot\)\)/);assert.match(capture,/KnownDocumentIdentity\(Doc\) <> identity/);
 assert.match(capture,/For Each candidate In Application.Documents/);assert.match(capture,/mBoundRanges\(CStr\(snapshot\)\)/);
 assert.match(capture,/Set anchor = anchors\(index\)/);assert.match(capture,/ResolveBoundEquation\(Doc, anchor, index\)/);
 assert.match(capture,/shape.Range.Document Is Doc/);assert.match(capture,/ELCaptureEquation shape, True/);
 assert.doesNotMatch(capture,/\.Select\b|\.Activate\b|ScreenRefresh/i);
 assert.doesNotMatch(capture,/Set shape = equations\(index\)/);
 const bound=capture.slice(capture.indexOf('If snapshot > 0 Then'),capture.indexOf('    Else'));
 assert.doesNotMatch(bound,/ActiveDocument|\bSelection\b/i);
 assert.match(capture,/Set shape = ExactSelectedEquation\(Selection, Doc\)/);
 assert.match(capture,/MathTypeBridgeDocumentCaptureRequestToken/);
 const resolver=source.slice(source.indexOf('Private Function ResolveBoundEquation'),source.indexOf('End Function',source.indexOf('Private Function ResolveBoundEquation')));
 assert.match(resolver,/anchor\.Document Is Doc/);assert.match(resolver,/anchor\.StoryType <> wdMainTextStory/);
 assert.match(resolver,/anchor\.Start >= anchor\.End/);assert.match(resolver,/shape\.Range\.Start = anchor\.Start And shape\.Range\.End = anchor\.End/);
 assert.match(resolver,/shape\.Range\.InlineShapes\.Count <> 1/);assert.match(resolver,/Supported\(shape\)/);assert.match(resolver,/index \+ 1 <> expectedIndex/);
 const save=procedure('Private Sub ApplyBackgroundSave');
 assert.match(save,/mBoundRanges\(CStr\(token\)\)/);assert.match(save,/ResolveBoundEquation\(Doc, anchor, index\)/);
 assert.doesNotMatch(save,/Set shape = equations\(index\)/);
 const poll=procedure('Public Sub ELPollNavigation');
 assert.ok(poll.indexOf('MathTypeBridgeTakeDocumentCaptureRequest')<poll.indexOf('MathTypeBridgeTransportActive'));
 assert.doesNotMatch(poll,/WordOpenXML/);
 const watch=procedure('Public Sub ELWatchNativeSession');assert.match(watch,/MathTypeBridgeCaptureWatch/);assert.doesNotMatch(watch,/WordOpenXML|\.Range|\.InlineShapes/);
 const close=procedure('Public Sub ELCloseDocumentContext');assert.match(close,/mBoundDocuments.Remove i/);assert.match(close,/mBoundRanges.Remove i/);assert.match(close,/mKnownDocuments.Remove i/);assert.match(close,/ELClearDocumentContext/);
 const events=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabWordEvents.cls',import.meta.url),'utf8');
 assert.match(events,/Host_DocumentBeforeClose[\s\S]*?ELQueueWorkspaceRefresh/);
 const selectionChange=events.slice(events.indexOf('Private Sub Host_WindowSelectionChange'),events.indexOf('End Sub',events.indexOf('Private Sub Host_WindowSelectionChange')));
 assert.match(selectionChange,/MathTypeBridgeTransportActive"\) = 0 Then[\s\S]*?ELCaptureSelection Sel, True[\s\S]*?Else[\s\S]*?ELCaptureSelection Sel\s+End If/);
});

test('ordinary selection clearing preserves legacy anchors while exact target and lifecycle changes clear them',async()=>{
 const source=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabDocumentContext.bas',import.meta.url),'utf8');
 const procedure=name=>source.slice(source.indexOf(name),source.indexOf('End Sub',source.indexOf(name))).split('\n').map(line=>line.split("'")[0]).join('\n');
 const selection=procedure('Public Sub ELCaptureSelection');
 const reentry=selection.slice(selection.indexOf('If mCapturing Then'),selection.indexOf('    End If',selection.indexOf('If mCapturing Then')));
 const missing=selection.slice(selection.lastIndexOf('Missing:'));
 assert.match(reentry,/ELClearSelectionCaptureDuringCapture/);assert.doesNotMatch(reentry,/ELClearActivationAnchor/);
 assert.match(missing,/ELClearSelectionCapture/);assert.doesNotMatch(missing,/ELClearActivationAnchor/);
 assert.match(selection,/If Not SameActivationTarget\(shape, selected\.Document\) Then ELClearActivationAnchor/);
 assert.match(selection,/Set shape = ELSelectedEquation\(selected\)/);
 assert.match(selection,/ELCaptureEquation shape, False, True, 0, prepareActivation/);
 const equation=procedure('Public Sub ELCaptureEquation');assert.match(equation,/If prepareActivation Then\s+ELClearActivationAnchor/);
 const observe=procedure('Public Sub ELObserveDocument');assert.match(observe,/ElseIf Not Doc Is mDocument Then\s+ELClearDocumentContext/);
 const close=procedure('Public Sub ELCloseDocumentContext');assert.match(close,/If mActivationDocument Is Doc Then ELClearActivationAnchor/);
 assert.match(source,/result = EquationLabNativeCommand\("MathTypeBridgePrepareDocumentActivation"\)/);
});

test('Word workspace reconciliation retires only absent documents after close events return',async()=>{
 const source=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabDocumentContext.bas',import.meta.url),'utf8');
 const events=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabWordEvents.cls',import.meta.url),'utf8');
 const procedure=(text,name)=>text.slice(text.indexOf(name),text.indexOf('End Sub',text.indexOf(name))).split('\n').map(line=>line.split("'")[0]).join('\n');
 const reconcile=procedure(source,'Public Sub ELReconcileKnownDocuments');
 assert.match(reconcile,/If mReconcilingDocuments Then Exit Sub/);
 assert.match(reconcile,/mReconcilingDocuments = True[\s\S]*?mReconcilingDocuments = False/);
 assert.match(reconcile,/documentCount = Application\.Documents\.Count/);
 assert.match(reconcile,/For i = mKnownDocuments\.Count To 1 Step -1[\s\S]*?If Not ELIsDocumentOpen\(Doc\) Then ELCloseDocumentContext Doc/);
 assert.match(reconcile,/If Not mWorkspaceClearPublished Then[\s\S]*?MathTypeBridgeClearWordWorkspace[\s\S]*?mWorkspaceClearPublished = True/);
 assert.doesNotMatch(reconcile,/Selection|WordOpenXML|\.Windows/i);
 const isOpen=procedure(source,'Private Function ELIsDocumentOpen');
 assert.match(isOpen,/For Each candidate In Application\.Documents/);assert.match(isOpen,/If candidate Is Doc Then/);
 assert.doesNotMatch(isOpen,/Selection|WordOpenXML|\.Windows/i);
 assert.match(source,/Documents remain open while any of their windows remain/,'document membership must be based on Application.Documents, not a single Window');
 const observe=procedure(source,'Public Sub ELObserveDocument');
 assert.ok(observe.indexOf('ELReconcileKnownDocuments')<observe.indexOf('If mDocument Is Nothing'));
 assert.match(observe,/If Not ELIsDocumentOpen\(Doc\) Then Exit Sub/);
 const report=procedure(source,'Public Sub ELReportActiveDocument');
 assert.match(report,/If Application\.Documents\.Count > 0 Then[\s\S]*?ELObserveDocument ActiveDocument[\s\S]*?Else[\s\S]*?ELReconcileKnownDocuments/);
 const activeWorkspace=procedure(source,'Private Sub ELReconcileActiveDocumentWorkspace');
 assert.match(reconcile,/If Application\.Documents\.Count > 0 Then ELReconcileActiveDocumentWorkspace/);
 assert.match(activeWorkspace,/Set Doc = ActiveDocument[\s\S]*?EnsureKnownDocumentIdentity\(Doc\)[\s\S]*?PublishDocumentWorkspace Doc, identity/);
 assert.doesNotMatch(activeWorkspace,/ELObserveDocument|ELCapture|ELClearDocumentContext|ELInvalidateDocumentSnapshot|ELClearActivationAnchor|Set mDocument|Set mEquations|WordOpenXML|Selection|\.Select\b|\.Activate\b/i,'periodic metadata refresh must not replace capture identity or source anchors');
 const ensureStart=source.indexOf('Private Function EnsureKnownDocumentIdentity');
 const ensureIdentity=source.slice(ensureStart,source.indexOf('End Function',ensureStart));
 assert.match(ensureIdentity,/If Doc Is mKnownDocuments\(i\) Then[\s\S]*?CLng\(mKnownDocumentIds\(i\)\)/);
 assert.match(ensureIdentity,/MathTypeBridgeNewDocumentToken[\s\S]*?mKnownDocuments\.Add Doc[\s\S]*?mKnownDocumentIds\.Add identity/);
 const publishWorkspace=procedure(source,'Private Sub PublishDocumentWorkspace');
 assert.match(publishWorkspace,/CStr\(identity\)/);assert.match(publishWorkspace,/mPublishedIdentity = identity/);
 const poll=procedure(source,'Public Sub ELPollNavigation');
 assert.ok(poll.indexOf('ELReconcileKnownDocuments')<poll.indexOf('MathTypeBridgeTakeInsertion'),'native pump reconciles before handling queued document work');
 assert.match(poll,/MathTypeBridgeTakeInsertion[\s\S]*?If mWorkspaceRefreshRecheck Then[\s\S]*?MathTypeBridgeQueueWorkspaceRefresh/,'one bounded follow-up pass covers Word close timing after the first deferred callback');
 const queue=procedure(source,'Public Sub ELQueueWorkspaceRefresh');assert.match(queue,/mWorkspaceRefreshRecheck = True[\s\S]*?MathTypeBridgeQueueWorkspaceRefresh/);
 const deactivate=procedure(events,'Private Sub Host_WindowDeactivate');assert.match(deactivate,/ELQueueWorkspaceRefresh/);
 const beforeClose=procedure(events,'Private Sub Host_DocumentBeforeClose');
 assert.match(beforeClose,/ELQueueWorkspaceRefresh/);assert.doesNotMatch(beforeClose,/ELCloseDocumentContext/);
 assert.match(events,/cancelled close stays in Application\.Documents/);
 const close=procedure(source,'Public Sub ELCloseDocumentContext');
 assert.match(close,/If Not mDocument Is Nothing Then[\s\S]*?If Doc Is mDocument Then[\s\S]*?ELClearDocumentContext/,'retiring a background document must preserve another document context');
 assert.match(close,/preserveOtherActivation = ELHasPreparedActivationForOtherDocument\(Doc\)[\s\S]*?If preserveOtherActivation Then ELRestoreActivationAnchorAfterIdentityClose/);
 const preserve=source.slice(source.indexOf('Private Function ELHasPreparedActivationForOtherDocument'),source.indexOf('End Function',source.indexOf('Private Function ELHasPreparedActivationForOtherDocument')));
 assert.match(preserve,/mActivationDocument Is mDocument/);assert.match(preserve,/MathTypeBridgePreparedDocumentActivationNonce/);
 const restore=procedure(source,'Private Sub ELRestoreActivationAnchorAfterIdentityClose');
 assert.match(restore,/Not \(mActivationDocument Is ActiveDocument\)/);
 assert.match(restore,/"ELACT1"[\s\S]*?MathTypeBridgePrepareDocumentActivation/);
 assert.doesNotMatch(restore,/Selection|WordOpenXML|\.Select\b|\.Activate\b/i);
});

test('workspace sidecar carries bounded metadata only and explicit selector is identity bound',async()=>{
 const context=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabDocumentContext.bas',import.meta.url),'utf8');
 const ribbon=await readFile(new URL('../native-word-probe/src/ribbon_commands.mm',import.meta.url),'utf8');
 const native=await readFile(new URL('../native-word-probe/src/word_document_requests.mm',import.meta.url),'utf8');
 const publish=context.slice(context.indexOf('Private Sub PublishDocumentWorkspace'),context.indexOf('End Sub',context.indexOf('Private Sub PublishDocumentWorkspace')));
 assert.match(publish,/ELWORK2[\s\S]*?Application\.Documents\.Count[\s\S]*?EnsureKnownDocumentIdentity\(candidate\)[\s\S]*?candidate\.Name[\s\S]*?candidate\.ReadOnly/);
 assert.doesNotMatch(publish,/WordOpenXML|InlineShapes|Selection|\.Activate|\.Select/);
 assert.match(ribbon,/ELWORK1[\s\S]*?ELWORK2/,'native sidecar parser retains ELWORK1 compatibility and ELWORK2 catalog support');
 assert.match(ribbon,/count>128[\s\S]*?name\.length>512[\s\S]*?publishWordWorkspace\(active,documents\)/);
 assert.match(ribbon,/ELDREQ2[\s\S]*?documentIdentity[\s\S]*?document-process-mismatch/);
 assert.match(native,/MaximumReplyBytes=512\*1024/);
 assert.match(native,/workspaceDocuments/);
 const request=context.slice(context.indexOf('Private Sub ApplyWordDocumentRequest'),context.indexOf('End Sub',context.indexOf('Private Sub ApplyWordDocumentRequest')));
 assert.match(request,/fields\(3\) = "2"[\s\S]*?KnownDocumentIdentity\(candidate\)[\s\S]*?For Each candidate In Application\.Documents[\s\S]*?Doc\.ReadOnly[\s\S]*?Doc\.Activate[\s\S]*?ELFirstSupportedEquation/);
 assert.doesNotMatch(request,/Application\.Activate|ScreenUpdating|Range\.Select/);
});

test('blue text selection, Ribbon edit and double-click share one exact target and one activation',async()=>{
 const source=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabDocumentContext.bas',import.meta.url),'utf8');
 const ribbon=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabRibbon.bas',import.meta.url),'utf8');
 const events=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabWordEvents.cls',import.meta.url),'utf8');
 const block=(text,name,end='End Sub')=>text.slice(text.indexOf(name),text.indexOf(end,text.indexOf(name))).split('\n').map(line=>line.split("'")[0]).join('\n');
 const resolver=block(source,'Private Function ExactSelectedEquation','End Function');
 assert.match(resolver,/Doc Is ActiveDocument/);assert.match(resolver,/selected\.Range\.StoryType <> wdMainTextStory/);
 assert.equal((resolver.match(/selected\.Range\.End <= shape\.Range\.End/g)||[]).length,2,'both collection paths reject selection extending into adjacent text');
 assert.match(resolver,/embedded\.Type = wdFieldEmbed/);
 assert.match(resolver,/embedded\.Result\.InlineShapes\.Count = 1/);
 assert.match(resolver,/fieldStart = EmbeddedEquationFieldStart\(embedded, Doc\)/);
 assert.match(resolver,/position >= fieldStart/);
 assert.match(resolver,/selected\.Range\.End <= embedded\.Result\.End \+ 1/);
 assert.match(source,/EditableEquation = Supported\(shape\) Or shape\.OLEFormat\.ProgID = "DSEquations"/);
 const fieldStart=block(source,'Private Function EmbeddedEquationFieldStart','End Function');
 assert.match(fieldStart,/EmbeddedEquationFieldStart = -1/);
 assert.match(fieldStart,/text = Doc\.Range\(position, position \+ 1\)\.Text/);
 assert.match(fieldStart,/If Len\(text\) > 0 And text <> Chr\$\(19\) Then Exit For/);
 const edit=block(ribbon,'Private Sub EditEquation');
 assert.match(edit,/ELSelectedEquation\(Selection\)/);assert.match(edit,/ELOpenEquation chosen/);
 assert.doesNotMatch(edit,/Paragraphs|\.Select\b|\.Activate\b/);
 const open=block(ribbon,'Private Sub OpenDocumentEditor');
 assert.match(open,/ELSelectedEquation\(Selection\)/);assert.match(open,/ELOpenEquation chosen/);
 const double=block(events,'Private Sub Host_WindowBeforeDoubleClick');
 assert.match(double,/ELSelectedEquation\(Sel\)/);
 assert.match(double,/If Not target Is Nothing Then\s+[^]*?Cancel = True\s+[^]*?ELOpenEquation target\s+End If/);
 const activation=block(source,'Public Sub ELOpenEquation');
 assert.equal((activation.match(/\.OLEFormat\.Activate/g)||[]).length,1);
 assert.match(activation,/If mOpeningEquation Then Exit Sub/);assert.match(activation,/CanReusePreparedActivation/);
 assert.match(activation,/MathTypeBridgeTransportActive/);assert.match(activation,/MathTypeBridgeDocumentCaptureAllowed/);
 assert.match(activation,/Failed:[^]*?mOpeningEquation = False[^]*?Err\.Raise/);
 assert.doesNotMatch(activation,/\.Select\b|Selection\.|ScreenUpdating/);
 const capture=block(source,'Public Sub ELCaptureSelection');
 assert.ok(capture.indexOf('If mOpeningEquation Then Exit Sub')<capture.indexOf('ELClearSelectionCaptureDuringCapture'));
});

test('Ribbon Next and Previous step past the exact selected embedded equation range',async()=>{
 const ribbon=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabRibbon.bas',import.meta.url),'utf8');
 const start=ribbon.indexOf('Private Sub NavigateEquation');
 const navigate=ribbon.slice(start,ribbon.indexOf('End Sub',start)).split('\n').map(line=>line.split("'")[0]).join('\n');
 assert.match(navigate,/Set current = ELSelectedEquation\(Selection\)/,'use the shared exact supported-object resolver');
 assert.match(navigate,/position = Selection\.Start\s+If Not current Is Nothing Then position = current\.Range\.Start/,'use the exact object start so an expanded field cannot select itself again');
 assert.doesNotMatch(navigate,/position = current\.Range\.End/,'using End with a strict comparison would skip an immediately adjacent equation');
 assert.match(navigate,/If equation\.Range\.Start > position Then/,'Next must choose a later object, including one starting at the current object end');
 assert.match(navigate,/If equation\.Range\.Start < position Then/,'Previous must move before the selected object start');
 assert.match(navigate,/For Each equation In ActiveDocument\.InlineShapes/,'navigation remains in the active document');
 assert.match(navigate,/If Not chosen Is Nothing Then chosen\.Range\.Select/);
 assert.doesNotMatch(navigate,/ActiveWindow|Documents\(|Selection\.Move|InlineShapes\(\d+\)/,'do not add cross-document or positional fallback targeting');
});

test('double-click pre-capture nonce precedes forced ELCTX4 serialization and ELACT2 arming',async()=>{
 const source=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabDocumentContext.bas',import.meta.url),'utf8');
 const capture=source.slice(source.indexOf('Public Sub ELCaptureEquation'),source.indexOf('End Sub',source.indexOf('Public Sub ELCaptureEquation'))).split('\n').map(line=>line.split("'")[0]).join('\n');
 const issue=capture.indexOf('ELIssueDocumentActivationNonce(mDocumentIdentity, selected)');
 const cache=capture.indexOf('If Not forceSnapshot And mSnapshotReady');
 const xml=capture.indexOf('mDocument.Content.WordOpenXML');
 assert.ok(issue>=0&&issue<cache&&issue<xml,'nonce must be registered before the full XML read');
 assert.match(capture,/If activationNonce <= 0 Then GoTo Failed/);
 assert.match(capture,/captureRequestToken = activationNonce/);
 assert.match(capture,/If captureRequestToken > 0 Then contextHeader = "ELCTX4"/);
 assert.match(capture,/"ELACT2" & vbLf & CStr\(activationNonce\) & vbLf & CStr\(mDocumentIdentity\) & vbLf & CStr\(mSnapshotToken\) & vbLf & CStr\(selected\)/);
 assert.doesNotMatch(capture,/"ELACT1"/);
 assert.match(capture,/If result = 0 Then SchedulePoll\s+Exit Sub/,'fast capture must start the Word callback even on the first cold open');
 const poll=source.slice(source.indexOf('Private Sub SchedulePoll'),source.indexOf('End Sub',source.indexOf('Private Sub SchedulePoll')));
 assert.ok(poll.indexOf('Application.OnTime')<poll.indexOf('mPollScheduled = True'),'a rejected OnTime call must not leave the scheduled flag stuck');
 const reuse=source.slice(source.indexOf('Private Function CanReusePreparedActivation'),source.indexOf('End Function',source.indexOf('Private Function CanReusePreparedActivation')));
 assert.match(reuse,/Not mSnapshotReady Or Not mSnapshotSaved Or Not Doc\.Saved/);
 assert.match(reuse,/mActivationRange\.Document Is Doc/);assert.match(reuse,/mActivationRange\.StoryType <> wdMainTextStory/);
 assert.match(reuse,/target\.Range\.Start <> mActivationRange\.Start Or target\.Range\.End <> mActivationRange\.End/);
 assert.match(reuse,/mSnapshotGeneration <> EquationLabNativeCommand\("MathTypeBridgeEditGeneration"\)/);
 assert.match(reuse,/mSnapshotEnd <> Doc\.Content\.End Or mSnapshotShapes <> Doc\.InlineShapes\.Count/);
 assert.match(reuse,/ELFindEquationIndex\(target\) <> mActivationIndex/);
 assert.match(reuse,/elapsed >= 0\.5/);
 assert.match(reuse,/MathTypeBridgePreparedDocumentActivationNonce"\) <> mActivationNonce/);
 const native=await readFile(new URL('../native-word-probe/src/ribbon_commands.mm',import.meta.url),'utf8');
 assert.match(native,/EquationLabCapturePreCapturedDocumentContext\(context\)/);
 assert.match(native,/BOOL fast=context\[@"nonce"\]!=nil/);
 assert.match(native,/EquationLabArmPreCapturedDocumentActivation\(context\)/);
 assert.match(native,/RIBBON_EXPORT\(MathTypeBridgeIssueDocumentActivationNonce/);
 assert.match(native,/RIBBON_EXPORT\(MathTypeBridgePreparedDocumentActivationNonce,validHost\(\)\?preparedDocumentActivationNonce\(\):-1\)/);
 const getter=native.slice(native.indexOf('std::int32_t preparedDocumentActivationNonce'),native.indexOf('\n}',native.indexOf('std::int32_t preparedDocumentActivationNonce')));
 assert.match(getter,/preCaptureWasArmed/);assert.match(getter,/preCaptureWasRejected/);assert.match(getter,/preCaptureExpiry\.timeIntervalSinceNow<=0/);assert.match(getter,/preCaptureCandidate/);
});

test('Word insertion postprocessing maps each phase to a safe native outcome',async()=>{
 const source=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabDocumentContext.bas',import.meta.url),'utf8');
 const start=source.indexOf('Private Sub ApplyInsertion');
 const insertion=source.slice(start,source.indexOf('End Sub',start));
 assert.match(insertion,/mutationAttempted = True\r?\n\s*target\.InsertFile[^\r\n]*\r?\n\s*mutationCompleted = True/);
 const failed=insertion.slice(insertion.indexOf('Failed:'));
 assert.match(failed,/Failed:\s+failureNumber = Err\.Number\s+failureDescription = Err\.Description\s+On Error Resume Next/);
 assert.match(failed,/If mutationCompleted Then[\s\S]*?MathTypeBridgeFinishInsertion[\s\S]*?ElseIf mutationAttempted Then[\s\S]*?MathTypeBridgeUncertainInsertion[\s\S]*?Else[\s\S]*?MathTypeBridgeFailInsertion/);
 assert.match(failed,/Word may have inserted the equation\. Check the document; Equation Lab will not automatically repeat this insertion\./);
 assert.match(insertion,/ELInvalidateDocumentSnapshot/);
 assert.equal((insertion.match(/\bClearInsertion\b/g)||[]).length,1,'insertion anchors must be cleared once on every path');
 assert.doesNotMatch(insertion,/\.Select\b|\.Activate\b|Application\.Undo/i);
 const cleanup=source.slice(source.indexOf('Private Function ELTryCleanupInlineInsertion'),source.indexOf('End Function',source.indexOf('Private Function ELTryCleanupInlineInsertion')));
 assert.match(cleanup,/On Error GoTo Failed/);assert.match(cleanup,/failureNumber = Err\.Number\s+failureDescription = Err\.Description/);
 assert.match(cleanup,/ELTryCleanupInlineInsertion = True/);
 const native=await readFile(new URL('../native-word-probe/src/ribbon_commands.mm',import.meta.url),'utf8');
 assert.match(native,/RIBBON_EXPORT\(MathTypeBridgeUncertainInsertion,\(\[&\]\(\)\{EquationLabFinishWordInsertionUncertain\(\);return 0;\}\)\(\)\)/);
});
