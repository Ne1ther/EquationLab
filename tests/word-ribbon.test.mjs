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
import {validateRibbonAcceptance,validateRibbonTemplateZip,validateCurrentRibbonArtwork} from '../packaging/word-native-installer/artifacts.mjs';

await import('../word-ribbon/command-registry.js');
const registry=globalThis.EquationLabCommands;
const execFileAsync=promisify(execFile);


test('App insertion uses a verified document or retained range without inserting before commit',async()=>{
 const source=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabDocumentContext.bas',import.meta.url),'utf8');
 const request=source.slice(source.indexOf('Private Sub ApplyWordDocumentRequest('),source.indexOf('Private Function KnownDocumentIdentity'));
 assert.match(request,/ELDREQ3[\s\S]*?Case "numbered-right": insertionKind = "Right"/);
 assert.match(request,/If Not \(Selection.Document Is Doc\) Or Selection.Start <> Selection.End Then GoTo Failed/);
 assert.match(request,/ResolveBoundEquation\(Doc, anchor, targetIndex \+ 1\)/);
 assert.match(request,/paragraphRange\.End >= Doc.Content.End[\s\S]*?needsParagraph = True/);
 assert.match(request,/MathTypeBridgeBeginWordDocumentRequest[\s\S]*?ELStartEquationInsertion insertionKind, insertionPoint, needsParagraph/);
 assert.doesNotMatch(request,/\.InsertFile|\.InsertBefore|\.Delete\b/);
});

test('Word and editor numbering changes retain a document-bound default for subsequent insertions',async()=>{
 const ribbon=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabRibbon.bas',import.meta.url),'utf8');
 const context=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabDocumentContext.bas',import.meta.url),'utf8');
 const procedure=(source,name)=>{const start=source.indexOf(name);assert.notEqual(start,-1);return source.slice(start,source.indexOf(name.includes('Function')?'End Function':'End Sub',start));};
 const insert=procedure(ribbon,'Public Sub ELStartEquationInsertion');
 assert.match(insert,/ELDocumentNumberFormat\(Doc, selectedRange\.Start\)/);
 const number=procedure(ribbon,'Public Sub NumberSelectedEquation');
 const numberCore=procedure(ribbon,'Private Sub NumberSelectedEquationCore');
 assert.match(number,/If Not refreshedDisplayOnly Then\s+UpgradeLegacyNumbering Doc, changed\s+UpdateNumbersForDocument Doc\s+End If\s+SaveSharedNumberFormat Doc, futureFormat\s+NumberingChanged Doc/,'only a successful, exact-target save adopts the editor format');
 assert.equal((number.match(/UpdateNumbersForDocument Doc/g)||[]).length,1);
 assert.doesNotMatch(numberCore,/UpdateNumbersForDocument|NumberingChanged|ELInvalidateDocumentSnapshot/);
 const defaultNumber=procedure(ribbon,'Private Sub SetNumberFormat');
 assert.match(defaultNumber,/SaveSharedNumberFormat Doc, value[\s\S]*ELCommitNumberingTransaction[\s\S]*ELQueueWorkspaceRefresh/);
 assert.doesNotMatch(defaultNumber,/UpdateNumbersForDocument|NumberingChanged|ELInvalidateDocumentSnapshot/);
 const adopt=procedure(ribbon,'Public Sub ELRememberInsertedNumberFormat');
 assert.match(adopt,/inserted\.Document Is Doc/);assert.match(adopt,/bookmark\.Range\.Start >= inserted\.Start And bookmark\.Range\.End <= inserted\.End/);
 assert.match(adopt,/If count = 1 Then SaveSharedNumberFormat Doc/,'never infer an insertion preference from an unrelated bookmark');
 const post=procedure(context,'Private Function ELTryUpdateInsertedNumbers');
 assert.match(post,/ELUpdateNumbersForDocument Doc\s+EquationLabRibbon\.ELRememberInsertedNumberFormat Doc, inserted/);
 assert.match(post,/If numberFormat <> "" Then EquationLabRibbon\.ELAdoptInsertedNumberFormat Doc, numberFormat/);
 const adoptCompleted=procedure(ribbon,'Public Sub ELAdoptInsertedNumberFormat');
 assert.match(adoptCompleted,/ValidateRibbonNumberFormat pattern\s+SaveSharedNumberFormat Doc, pattern/);
 assert.doesNotMatch(adoptCompleted,/ActiveDocument|Selection/);
 const apply=procedure(context,'Private Sub ApplyInsertion');
 assert.ok(apply.indexOf('MathTypeBridgeInsertionNumberingNext')<apply.indexOf('target.InsertFile'),'read the claimed format before Word mutation');
 const format=procedure(ribbon,'Public Function ELDocumentNumberFormat');
 assert.match(format,/PreferenceForDocument\(Doc, "EquationLabNumberFormat", ""\)/);assert.match(format,/If bestCount \* 2 > total/);
 assert.doesNotMatch(format,/ActiveDocument|Selection\./,'a document B format cannot be redirected to document A');
 const save=procedure(ribbon,'Private Sub SavePreferenceForDocument');assert.doesNotMatch(save,/On Error Resume Next|ActiveDocument/);
});

test('live insertion geometry comes from the bound Word range before fragment import',async()=>{
 const ribbon=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabRibbon.bas',import.meta.url),'utf8');
 const context=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabDocumentContext.bas',import.meta.url),'utf8');
 const apply=context.slice(context.indexOf('Private Sub ApplyInsertion'),context.indexOf('Private Sub ELAdvanceInsertionCursor'));
 assert.ok(apply.indexOf('Set target = mInsertionRange.Duplicate')<apply.indexOf('ELReadEquationParagraphGeometry target.Paragraphs(1).Range'));
 assert.ok(apply.indexOf('ELReadEquationParagraphGeometry target.Paragraphs(1).Range')<apply.indexOf('mutationAttempted = True'));
 assert.ok(apply.indexOf('target.InsertFile')<apply.indexOf('ELApplyEquationParagraphGeometry insertedRange.InlineShapes(1).Range.Paragraphs(1).Range'));
 assert.match(ribbon,/If count = 2 And Not \.TextColumns.EvenlySpaced Then Err.Raise/);
 assert.match(ribbon,/columnWidth = \.TextColumns\(1\).Width/);
 assert.match(ribbon,/If \.GutterPos <> wdGutterPosTop Or \.MirrorMargins Then columnWidth = columnWidth - \.Gutter/);
 assert.match(ribbon,/usableWidth = columnWidth - leftIndent - rightIndent/);
 assert.match(ribbon,/paragraph.Information\(wdWithInTable\)/);
 assert.match(apply,/target.InsertFile[^\n]*Range:="EquationLabInsertBody"/,'exclude the source final section mark');
 assert.match(ribbon,/layoutXml = paragraph.Document.Range\(0, 0\).WordOpenXML/);
 assert.doesNotMatch(ribbon,/\.BookFoldPrinting|\.BookFoldRevPrinting|\.TwoPagesOnOne/,'Mac Word rejects these page-setup getters');
 assert.doesNotMatch(apply,/ELReadEquationParagraphGeometry insertedRange/,'fragment section properties never supply destination geometry');
 assert.ok(apply.indexOf('Set inlineFormatting = target.ParagraphFormat.Duplicate')<apply.indexOf('mutationAttempted = True'));
 assert.ok(apply.indexOf('.ParagraphFormat = inlineFormatting')>apply.indexOf('ELTryCleanupInlineInsertion(Doc, start, beforeEnd)'));
});

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

test('Ribbon artwork stays font-independent and within transparent bounds at display sizes',async()=>{
 const icons=new Set([...registry.commands.map(command=>command.icon),'app']);
 assert.notEqual(registry.get('insert-number').icon,registry.get('number-format').icon);
 assert.notEqual(registry.get('help').icon,registry.get('capabilities').icon);
 for(const icon of icons){
  const svg=await readFile(new URL(`../word-ribbon/icons/svg/${icon}.svg`,import.meta.url),'utf8');
  assert.doesNotMatch(svg,/<text\b|font-family|<image\b|href=|<script\b/i,icon);
  for(const size of [16,32,80]){
   const image=sharp(await readFile(new URL(`../word-ribbon/icons/${icon}-${size}.png`,import.meta.url)));
   const meta=await image.metadata();assert.equal(meta.width,size,icon);assert.equal(meta.height,size,icon);assert.equal(meta.hasAlpha,true,icon);
   if(size===16)continue;
   const {data,info}=await image.ensureAlpha().raw().toBuffer({resolveWithObject:true});
   let opaque=0;
   for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const alpha=data[(y*size+x)*info.channels+3];if(alpha)opaque++;
    if(x===0||x===size-1||y===0||y===size-1)assert.equal(alpha,0,`${icon}-${size}: cropped edge`);
   }
   assert.ok(opaque>size,`${icon}-${size}: empty artwork`);
  }
 }
});

test('native Word template builder embeds the retained Ribbon ABI and icons without Office.js routes',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'equationlab-native-ribbon-'));
 const input=join(temp,'input.dotm'),output=join(temp,'output.dotm');
 try{
  const fixture=new JSZip();
  fixture.file('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
  fixture.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
  fixture.file('word/vbaProject.bin',Buffer.from('retained VBA compilation cache'));
  await writeFile(input,await fixture.generateAsync({type:'nodebuffer'}));
  await execFileAsync(process.execPath,[fileURLToPath(new URL('../native-word-probe/automatic-loader/build-ribbon-template.mjs',import.meta.url)),input,output]);
  const outputBytes=await readFile(output),built=await JSZip.loadAsync(outputBytes),xml=await built.file('customUI/customUI.xml').async('string');
  assert.equal((xml.match(/<group /g)||[]).length,5);assert.equal((xml.match(/<button /g)||[]).length,20);
  assert.match(xml,/tag="open-pane"/);assert.doesNotMatch(xml,/Taskpane|TaskPane|appsforoffice|localhost:37951/);
  assert.deepEqual(await validateRibbonTemplateZip(built),{groups:5,buttons:20,iconRelationships:new Set([...registry.commands.map(command=>command.icon),'app']).size});
  assert.equal((await built.file('word/vbaProject.bin').async('nodebuffer')).toString(),'retained VBA compilation cache');
  const relationXml=await built.file('customUI/_rels/customUI.xml.rels').async('string');
  const iconNames=[...relationXml.matchAll(/Target="icons\/([^\"]+)"/g)].map(match=>match[1]);
  assert.equal(new Set(iconNames).size,iconNames.length);
  const largeImages=new Set([...xml.matchAll(/<button\b[^>]+>/g)].filter(match=>match[0].includes('size="large"')).map(match=>/image="([^"]+)"/.exec(match[0])[1]));
  for(const name of iconNames){
   const bytes=await built.file(`customUI/icons/${name}`).async('nodebuffer');
   assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
   const expected=largeImages.has(name.replace(/\.png$/,''))?80:32;
   assert.equal(bytes.readUInt32BE(16),expected);assert.equal(bytes.readUInt32BE(20),expected);
  }
  const legacy=await JSZip.loadAsync(outputBytes);
  for(const name of largeImages)legacy.file(`customUI/icons/${name}.png`,await readFile(new URL(`../word-ribbon/icons/${name}-32.png`,import.meta.url)));
  assert.deepEqual(await validateRibbonTemplateZip(legacy),await validateRibbonTemplateZip(built),'previously accepted 32 px templates remain valid');
  assert.deepEqual(await validateCurrentRibbonArtwork(built),{current:true,buttons:20});
  await assert.rejects(validateCurrentRibbonArtwork(legacy),/Outdated Word Ribbon artwork/);
  legacy.file('customUI/icons/obsolete.png',Buffer.from('old artwork'));
  const refreshInput=join(temp,'old-artwork.dotm'),refreshed=join(temp,'refreshed.dotm');
  await writeFile(refreshInput,await legacy.generateAsync({type:'nodebuffer'}));
  await execFileAsync(process.execPath,[fileURLToPath(new URL('../native-word-probe/automatic-loader/build-ribbon-template.mjs',import.meta.url)),refreshInput,refreshed]);
  const refreshedZip=await JSZip.loadAsync(await readFile(refreshed));
  assert.deepEqual(await validateCurrentRibbonArtwork(refreshedZip),{current:true,buttons:20});
  assert.equal(refreshedZip.file('customUI/icons/obsolete.png'),null);
  assert.deepEqual(await refreshedZip.file('word/vbaProject.bin').async('nodebuffer'),await built.file('word/vbaProject.bin').async('nodebuffer'));
  const oversizedSmall=await JSZip.loadAsync(outputBytes);
  oversizedSmall.file('customUI/icons/number.png',await readFile(new URL('../word-ribbon/icons/number-80.png',import.meta.url)));
  await assert.rejects(validateRibbonTemplateZip(oversizedSmall),/invalid Ribbon PNG size/);
  const oversizedLarge=await JSZip.loadAsync(outputBytes);
  oversizedLarge.file('customUI/icons/inline.png',await sharp(await readFile(new URL('../word-ribbon/icons/inline-80.png',import.meta.url))).resize(160,160).png().toBuffer());
  await assert.rejects(validateRibbonTemplateZip(oversizedLarge),/invalid Ribbon PNG size/);
  const noRibbon=await JSZip.loadAsync(outputBytes);noRibbon.remove('customUI/customUI.xml');
  await assert.rejects(validateRibbonTemplateZip(noRibbon),/missing customUI part/);
  const brokenCallback=await JSZip.loadAsync(outputBytes),ribbonXml=await brokenCallback.file('customUI/customUI.xml').async('string');
  brokenCallback.file('customUI/customUI.xml',ribbonXml.replace('tag="open-pane" image="app" onAction="EquationLabRibbon.ELRibbonAction"','tag="open-pane" image="app" onAction="Missing.Callback"'));
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
 assert.match(remember,/anchors\.Count <> mEquations\.Count/);assert.match(remember,/RememberDocumentRanges mDocument, mSnapshotToken, anchors/);
 const preflight=procedure('Public Sub ELCaptureEquation');
 assert.match(preflight,/Set candidateRange = shape\.Range[\s\S]*?mEquations\.Add shape\s+anchors\.Add candidateRange\.Duplicate/);
 assert.doesNotMatch(preflight,/ScreenUpdating|ScreenRefresh|\.Select\b|\.Activate\b/);
 const rememberRanges=procedure('Private Sub RememberDocumentRanges');assert.match(rememberRanges,/mBoundRanges\.Add anchors, CStr\(snapshotToken\)/);
 assert.doesNotMatch(remember,/mBoundRanges\.Add mEquations/);
 const capture=procedure('Private Sub ApplyDocumentCaptureRequest');
 assert.match(capture,/mBoundDocuments\(CStr\(snapshot\)\)/);assert.match(capture,/KnownDocumentIdentity\(Doc\) <> identity/);
 assert.match(capture,/For Each candidate In Application.Documents/);assert.match(capture,/mBoundRanges\(CStr\(snapshot\)\)/);
 assert.match(capture,/Set anchor = anchors\(index\)/);assert.match(capture,/ResolveBoundEquation\(Doc, anchor, index\)/);
 assert.match(capture,/If enrichment Then\s+Set shape = ResolveBoundEquation\(Doc, anchor, index, True\)/);
 assert.match(capture,/shape.Range.Document Is Doc/);assert.match(capture,/ELCaptureEquation shape, True/);
 assert.doesNotMatch(capture,/\.Select\b|\.Activate\b|ScreenRefresh/i);
 assert.doesNotMatch(capture,/Set shape = equations\(index\)/);
 const bound=capture.slice(capture.indexOf('If snapshot > 0 Then'),capture.indexOf('    Else'));
 assert.doesNotMatch(bound,/ActiveDocument|\bSelection\b/i);
 assert.match(capture,/Set shape = ExactSelectedEquation\(Selection, Doc\)/);
 assert.match(capture,/MathTypeBridgeDocumentCaptureRequestToken/);
 const resolver=source.slice(source.indexOf('Private Function ResolveBoundEquation'),source.indexOf('End Function',source.indexOf('Private Function ResolveBoundEquation')));
 assert.match(resolver,/anchor\.Document Is Doc/);assert.match(resolver,/anchor\.StoryType <> wdMainTextStory/);
 assert.match(resolver,/anchor\.Start >= anchor\.End/);assert.match(resolver,/startAt = anchor\.Start\s+endAt = anchor\.End/);
 assert.match(resolver,/If readOnlyCapture Then[\s\S]*?If anchor\.InlineShapes\.Count = 1 Then Set span = anchor\.InlineShapes\(1\)\.Range[\s\S]*?startAt = span\.Start\s+endAt = span\.End/);
 assert.match(resolver,/shape\.Range\.Start = startAt And shape\.Range\.End = endAt/);
 assert.match(resolver,/If Not readOnlyCapture Then\s+If shape\.Range\.InlineShapes\.Count <> 1/);assert.match(resolver,/Supported\(shape\)/);assert.match(resolver,/index \+ 1 <> expectedIndex/);
 const save=procedure('Private Sub ApplyBackgroundSave');
 assert.match(save,/mBoundRanges\(CStr\(token\)\)/);assert.match(save,/ResolveBoundEquation\(Doc, anchor, index\)/);
 assert.doesNotMatch(save,/Set shape = equations\(index\)/);
 assert.match(save,/stage = "resolve-equation"[\s\S]*ResolveBoundEquation/);
 assert.match(save,/Set Doc = mBoundDocuments\(CStr\(token\)\)/);
 const dirty=save.indexOf('Doc.Saved = False'),activate=save.indexOf('shape.OLEFormat.Activate');
 assert.ok(dirty>=0&&activate>=0&&save.indexOf('If Not (shape.Range.Document Is Doc) Then GoTo Failed')>=0&&save.indexOf('If Not (shape.Range.Document Is Doc) Then GoTo Failed')<dirty&&save.indexOf('If Not Supported(shape) Then GoTo Failed')>=0&&save.indexOf('If Not Supported(shape) Then GoTo Failed')<dirty&&dirty<activate,'only the bound, verified document is marked dirty before target activation');
 assert.match(save,/On Error GoTo Failed/);
 assert.doesNotMatch(save,/ActiveDocument|\bSelection\b|\bDoc\.Save\b|\.AddOLEObject\b|\.Delete\b/);
 assert.ok(save.indexOf('failureNumber = Err.Number')<save.indexOf('MathTypeBridgeFailBackgroundSave'), 'retain the original error before calling the bridge');
 assert.match(save,/background save unavailable at "; stage; ": "; failureNumber/);
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
 assert.match(selection,/If Not prepareActivation Then\s+If EquationLabNativeCommand\("MathTypeBridgeTransportActive"\) <> 0 Then[\s\S]*?ELClearSelectionCapture\s+Exit Sub/);
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

test('workspace numbering metadata reads only declared settings while numbering commands retain field checks',async()=>{
 const context=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabDocumentContext.bas',import.meta.url),'utf8');
 const ribbon=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabRibbon.bas',import.meta.url),'utf8');
 const get=(source,name,end)=>{const start=source.indexOf(name);assert.ok(start>=0,name);return source.slice(start,source.indexOf(end,start));};
 const publish=get(context,'Private Sub PublishDocumentWorkspace','End Sub');
 const metadata=get(ribbon,'Public Function ELWorkspaceNumberFormat','End Function');
 const valid=get(ribbon,'Private Function ELWorkspaceValidNumberFormat','End Function');
 const preference=get(ribbon,'Private Function PreferenceForDocument','End Function');
 assert.match(publish,/ELWorkspaceNumberFormat\(candidate\)/);assert.doesNotMatch(publish,/ELStoredNumberFormat\(candidate\)/);
 assert.match(metadata,/PreferenceForDocument\(Doc, "EquationLabNumberFormat", ""\)/);
 assert.match(metadata,/Doc\.CustomDocumentProperties\("MTEquationNumber2"\)\.Value/);
 assert.match(metadata,/On Error Resume Next\s+sharedFormat = CStr\(Doc\.CustomDocumentProperties\("MTEquationNumber2"\)\.Value\)\s+Err\.Clear\s+On Error GoTo Missing/);
 assert.match(metadata,/explicitFormat <> "" And sharedFormat <> "" And explicitFormat <> sharedFormat Then Exit Function/);
 assert.match(valid,/On Error GoTo Missing[\s\S]*?If Len\(pattern\) = 0 Then Exit Function[\s\S]*?ValidateRibbonNumberFormat pattern\s+ELWorkspaceValidNumberFormat = pattern\s+Missing:/);
 assert.match(preference,/On Error GoTo Missing[\s\S]*?Doc\.Variables\(key\)\.Value[\s\S]*?Missing:\s+PreferenceForDocument = fallback/);
 for(const part of [publish,metadata,valid,preference])assert.doesNotMatch(part,/HasLegacyNumbering|CollectEquationFields|SharedDefaultFormat|Doc\.Content|\.Fields\b|WordOpenXML|\.Save\b|\.Select\b/);
 const actual=get(ribbon,'Public Function ELDocumentNumberFormat','End Function');
 const shared=get(ribbon,'Private Function SharedDefaultFormat','End Function');
 const legacy=get(ribbon,'Private Function HasLegacyNumbering','End Function');
 assert.match(actual,/SharedDefaultFormat\(Doc\)/);assert.match(shared,/HasLegacyNumbering\(Doc\)/);
 assert.match(legacy,/If fields Is Nothing Then Set fields = SequenceFieldsForDocument\(Doc\)/);
 assert.match(ribbon,/Private Function SequenceFieldsForDocument[\s\S]*?CollectEquationFields Doc\.Content/);
});

test('workspace sidecar carries bounded metadata only and explicit selector is identity bound',async()=>{
 const context=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabDocumentContext.bas',import.meta.url),'utf8');
 const ribbon=await readFile(new URL('../native-word-probe/src/ribbon_commands.mm',import.meta.url),'utf8');
 const native=await readFile(new URL('../native-word-probe/src/word_document_requests.mm',import.meta.url),'utf8');
 const publish=context.slice(context.indexOf('Private Sub PublishDocumentWorkspace'),context.indexOf('End Sub',context.indexOf('Private Sub PublishDocumentWorkspace')));
 assert.match(publish,/ELWORK3[\s\S]*?Application\.Documents\.Count[\s\S]*?EnsureKnownDocumentIdentity\(candidate\)[\s\S]*?candidate\.Name[\s\S]*?candidate\.ReadOnly/);
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
 assert.match(navigate,/equation\.Range\.Start > position And IsEquation\(equation\)/,'Next must choose a later object, including one starting at the current object end');
 assert.match(navigate,/equation\.Range\.Start < position And IsEquation\(equation\)/,'Previous must move before the selected object start');
 assert.match(navigate,/Set Doc = ActiveDocument/);assert.match(navigate,/Set span = Doc\.Range\(cursor, edge\): Set shapes = span\.InlineShapes/);
 assert.match(navigate,/For i = 1 To shapes\.Count[\s\S]*?Exit For/);assert.match(navigate,/For i = shapes\.Count To 1 Step -1[\s\S]*?Exit For/);
 assert.match(navigate,/ELBeginRibbonNavigation/);assert.match(navigate,/If Not chosen Is Nothing Then ELSelectRibbonNavigationTarget chosen/);
 assert.match(navigate,/If oldScreenUpdating Then Application\.ScreenUpdating = True[\s\S]*?Failed:[\s\S]*?If oldScreenUpdating Then Application\.ScreenUpdating = True/);
 const context=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabDocumentContext.bas',import.meta.url),'utf8');
 assert.match(context,/If mRibbonNavigationSelecting Then Exit Sub/);assert.match(context,/mRibbonNavigationSelecting = True\s+target\.Range\.Select\s+mRibbonNavigationSelecting = False/);
 assert.doesNotMatch(navigate,/ActiveWindow|Documents\(|Selection\.Move|InlineShapes\(\d+\)/,'do not add cross-document or positional fallback targeting');
});

test('double-click pre-capture nonce precedes forced ELCTX4 serialization and ELACT2 arming',async()=>{
 const source=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabDocumentContext.bas',import.meta.url),'utf8');
 const capture=source.slice(source.indexOf('Public Sub ELCaptureEquation'),source.indexOf('End Sub',source.indexOf('Public Sub ELCaptureEquation'))).split('\n').map(line=>line.split("'")[0]).join('\n');
 const issue=capture.lastIndexOf('ELIssueDocumentActivationNonce(mDocumentIdentity, selected)');
 const cache=capture.indexOf('If Not prepareActivation And Not forceSnapshot And mSnapshotReady');
 const xml=capture.indexOf('mDocument.Content.WordOpenXML');
 assert.ok(cache>=0&&issue>cache&&issue<xml,'pre-activation cannot take the no-nonce cache and must register its nonce before XML');
 assert.match(capture,/If activationNonce <= 0 Then GoTo Failed/);
 assert.match(capture,/captureRequestToken = activationNonce/);
 assert.match(capture,/If captureRequestToken > 0 Then contextHeader = "ELCTX4"/);
 assert.match(capture,/"ELACT2" & vbLf & CStr\(activationNonce\) & vbLf & CStr\(mDocumentIdentity\) & vbLf & CStr\(mSnapshotToken\) & vbLf & CStr\(selected\)/);
 assert.doesNotMatch(capture,/"ELACT1"/);
 assert.match(capture,/If result = 0 Then SchedulePoll\s+Exit Sub/,'fast capture must start the Word callback even on the first cold open');
 const poll=source.slice(source.indexOf('Private Sub SchedulePoll'),source.indexOf('End Sub',source.indexOf('Private Sub SchedulePoll')));
 const pollCode=poll.split('\n').map(line=>line.split("'")[0]).join('\n');
 assert.match(pollCode,/mPollScheduled = \(EquationLabNativeCommand\("MathTypeBridgeScheduleWordHostPoll"\) = 0\)/,'every request reaches native coalescing even when the old hint is true');
 assert.doesNotMatch(pollCode,/If\s+mPollScheduled\s+Then/i);
 assert.doesNotMatch(pollCode,/Application\.OnTime|mPollScheduled\s*=\s*True/);
 const clear=source.slice(source.indexOf('Public Sub ELClearDocumentContext'),source.indexOf('End Sub',source.indexOf('Public Sub ELClearDocumentContext')));
 assert.match(clear,/MathTypeBridgeTransportActive"\) = 0 And Not mPollScheduled Then[\s\S]*Set mDocument = Nothing/,'binding hint still protects the document');
 const reuse=source.slice(source.indexOf('Private Function CanReusePreparedActivation'),source.indexOf('End Function',source.indexOf('Private Function CanReusePreparedActivation')));
 assert.match(reuse,/Not mSnapshotReady Or Not mSnapshotSaved Or Not Doc\.Saved/);
 assert.match(reuse,/mActivationRange\.Document Is Doc/);assert.match(reuse,/mActivationRange\.StoryType <> wdMainTextStory/);
 assert.match(reuse,/target\.Range\.Start <> mActivationRange\.Start Or target\.Range\.End <> mActivationRange\.End/);
 assert.match(reuse,/mSnapshotGeneration <> EquationLabNativeCommand\("MathTypeBridgeEditGeneration"\)/);
 assert.match(reuse,/mSnapshotEnd <> Doc\.Content\.End Or mSnapshotShapes <> Doc\.InlineShapes\.Count/);
 assert.match(reuse,/mBoundRanges\(CStr\(mSnapshotToken\)\)/);
 assert.match(reuse,/Set anchor = anchors\(mActivationIndex \+ 1\)/);
 assert.match(reuse,/anchor\.Start <> target\.Range\.Start Or anchor\.End <> target\.Range\.End/);
 assert.doesNotMatch(reuse,/ELFindEquationIndex/);
 assert.match(reuse,/elapsed >= 0\.5/);
 assert.match(reuse,/MathTypeBridgePreparedDocumentActivationNonce"\) <> mActivationNonce/);
 const native=await readFile(new URL('../native-word-probe/src/ribbon_commands.mm',import.meta.url),'utf8');
 assert.match(native,/bool validHost\(\)\{return NSThread\.isMainThread&&\[\[NSBundle mainBundle\]\.bundleIdentifier isEqual:@"com\.microsoft\.Word"\]&&MathTypeBridgeMathTypeRegistrationState\(\)==1;\}/);
 assert.match(native,/RIBBON_EXPORT\(MathTypeBridgeScheduleWordHostPoll,\(\[&\]\(\)\{if\(!validHost\(\)\)return -1;EquationLabScheduleWordHostPoll\(\);return 0;\}\)\(\)\)/);
 assert.match(native,/EquationLabCapturePreCapturedDocumentContext\(context\)/);
 assert.match(native,/BOOL fast=context\[@"nonce"\]!=nil/);
 assert.match(native,/EquationLabArmPreCapturedDocumentActivation\(context\)/);
 assert.match(native,/RIBBON_EXPORT\(MathTypeBridgeIssueDocumentActivationNonce/);
 assert.match(native,/RIBBON_EXPORT\(MathTypeBridgePreparedDocumentActivationNonce,validHost\(\)\?preparedDocumentActivationNonce\(\):-1\)/);
 const getter=native.slice(native.indexOf('std::int32_t preparedDocumentActivationNonce'),native.indexOf('\n}',native.indexOf('std::int32_t preparedDocumentActivationNonce')));
 assert.match(getter,/preCaptureWasArmed/);assert.match(getter,/preCaptureWasRejected/);assert.match(getter,/preCaptureExpiry\.timeIntervalSinceNow<=0/);assert.match(getter,/preCaptureCandidate/);
});

test('Word startup initialization uses native guard and acknowledges after events start',async()=>{
 const source=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabEntryPoints.bas',import.meta.url),'utf8');
 const startup=await readFile(new URL('../native-word-probe/automatic-loader/AutoExec.bas',import.meta.url),'utf8');
 assert.match(startup,/Attribute VB_Name = "AutoExec"/);
 const auto=startup.slice(startup.indexOf('Public Sub Main()'),startup.indexOf('End Sub',startup.indexOf('Public Sub Main()')));
 assert.match(auto,/ELConnectNativeAtStartup/);assert.doesNotMatch(auto,/Application\.OnTime|ELInitializeDocumentEvents/);
 assert.doesNotMatch(source,/Sub\s+AutoExec\s*\(/i);
 const init=source.slice(source.indexOf('Public Sub ELInitializeDocumentEvents()'),source.indexOf('End Sub',source.indexOf('Public Sub ELInitializeDocumentEvents()')));
 assert.match(init,/ELStartDocumentEvents[\s\S]*MathTypeBridgeWordHostInitialized/);
});

test('Word insertion postprocessing maps each phase to a safe native outcome',async()=>{
 const source=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabDocumentContext.bas',import.meta.url),'utf8');
 const start=source.indexOf('Private Sub ApplyInsertion');
 const insertion=source.slice(start,source.indexOf('End Sub',start));
 assert.match(insertion,/mutationAttempted = True[\s\S]*?target\.InsertFile[^\r\n]*\r?\n\s*mutationCompleted = True/);
 assert.ok(insertion.indexOf('mutationAttempted = True')<insertion.indexOf('target.InsertBefore vbCr'),'the optional paragraph is inside the uncertain-mutation phase');
 const failed=insertion.slice(insertion.indexOf('Failed:'));
 assert.match(failed,/Failed:\s+failureNumber = Err\.Number\s+failureDescription = Err\.Description[\s\S]*ELTransactionRecoveryMessage/);
 assert.match(failed,/If mutationCompleted Then[\s\S]*?MathTypeBridgeFinishInsertion[\s\S]*?ElseIf mutationAttempted Then[\s\S]*?MathTypeBridgeUncertainInsertion[\s\S]*?Else[\s\S]*?MathTypeBridgeFailInsertion/);
 assert.match(failed,/Word may have inserted the equation\. Check the document; Equation Lab will not automatically repeat this insertion\./);
 assert.match(insertion,/ELInvalidateDocumentSnapshot/);
 assert.match(insertion,/If inlineMode = 0 Then numberUpdateFailed = Not ELTryUpdateInsertedNumbers\(Doc, start, beforeEnd, numberFormat\)/);
 assert.match(insertion,/Selection\.Document Is Doc[\s\S]*advanceCursor = \(Selection\.Range\.StoryType = wdMainTextStory And Selection\.Start = start And Selection\.End = start\)/);
 assert.match(insertion,/hadFragmentBookmark = Doc\.Bookmarks\.Exists\("EquationLabInsertBody"\)[\s\S]*?target\.InsertFile[\s\S]*?mutationCompleted = True[\s\S]*?If hadFragmentBookmark Then Doc\.Bookmarks\.Add Name:="EquationLabInsertBody", Range:=existingFragmentBookmark[\s\S]*?Set insertedRange = Doc\.Range/);
 const cursorStart=source.indexOf('Private Sub ELAdvanceInsertionCursor');
 const cursor=source.slice(cursorStart,source.indexOf('End Sub',cursorStart));
 assert.match(cursor,/If Not \(Selection\.Document Is Doc\) Then Exit Sub/);
 assert.match(cursor,/If Selection\.Start <> inserted\.Start Or Selection\.End > inserted\.End Then Exit Sub/);
 assert.match(cursor,/Selection\.SetRange Start:=inserted\.End, End:=inserted\.End/);
 assert.doesNotMatch(cursor,/\.Select\b|\.Activate\b|OLEFormat/i);
 assert.ok(insertion.indexOf('ELTryUpdateInsertedNumbers(Doc, start, beforeEnd, numberFormat)')<insertion.indexOf('MathTypeBridgeFinishInsertion'));
 assert.match(insertion,/If numberUpdateFailed Then Err\.Raise/);
 assert.equal((insertion.match(/\bClearInsertion\b/g)||[]).length,1,'insertion anchors must be cleared once on every path');
 assert.doesNotMatch(insertion,/\.Select\b|\.Activate\b|(?:Application|Doc)\.Undo/i);
 const cleanup=source.slice(source.indexOf('Private Function ELTryCleanupInlineInsertion'),source.indexOf('End Function',source.indexOf('Private Function ELTryCleanupInlineInsertion')));
 assert.match(cleanup,/On Error GoTo Failed/);assert.match(cleanup,/failureNumber = Err\.Number\s+failureDescription = Err\.Description/);
 assert.match(cleanup,/ELTryCleanupInlineInsertion = True/);
 const numbers=source.slice(source.indexOf('Private Function ELTryUpdateInsertedNumbers'),source.indexOf('End Function',source.indexOf('Private Function ELTryUpdateInsertedNumbers')));
 assert.match(numbers,/For Each field In inserted\.Fields[\s\S]*SEQ EQUATIONLAB[\s\S]*EquationLabRibbon\.ELUpdateNumbersForDocument Doc/);
 assert.match(numbers,/On Error GoTo Failed[\s\S]*ELTryUpdateInsertedNumbers = True/);
 const native=await readFile(new URL('../native-word-probe/src/ribbon_commands.mm',import.meta.url),'utf8');
 assert.match(native,/RIBBON_EXPORT\(MathTypeBridgeUncertainInsertion,\(\[&\]\(\)\{EquationLabFinishWordInsertionUncertain\(\);return 0;\}\)\(\)\)/);
});

test('Ribbon right/left and number route only an exact selected OLE into standalone numbering',async()=>{
 const source=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabRibbon.bas',import.meta.url),'utf8');
 const procedure=name=>{const start=source.indexOf(name);assert.notEqual(start,-1,`${name} exists`);return source.slice(start,source.indexOf('End Sub',start)).split('\n').map(line=>line.split("'")[0]).join('\n');};
 const rightLeft=procedure('Private Sub InsertEquation');
 assert.match(rightLeft,/Set chosen = ELSelectedEquation\(Selection\)/);
 assert.match(rightLeft,/If kind = "Right" Or kind = "Left" Then[\s\S]*?NumberSelectedEquation Doc, chosen, \(kind = "Right"\)/);
 assert.match(rightLeft,/If selectedRange\.Start <> selectedRange\.End Then[\s\S]*?ELStartEquationInsertion kind, selectedRange/,'collapsed cursor retains the shared insertion route');
 assert.match(procedure('Public Sub ELStartEquationInsertion'),/Set Doc = selectedRange.Document[\s\S]*?selectedRange.Select[\s\S]*?SequenceFieldsForDocument\(Doc\)[\s\S]*?NextNumber\(fields\)[\s\S]*?ELBeginEquationInsertion kind, leadingParagraph/);
 assert.doesNotMatch(rightLeft,/InlineShapes\(\d+\)|Selection\.Move|Set chosen = .*InlineShapes/,'selection routing has no arbitrary adjacent-object fallback');
 const number=procedure('Private Sub InsertNumber');
 assert.match(number,/Set chosen = ELSelectedEquation\(Selection\)/);
 assert.match(number,/NumberSelectedEquation Doc, chosen, True/);
 assert.match(number,/If selectedRange\.Start <> selectedRange\.End Then[\s\S]*?InsertPreparedFragment "Number"/);
 const mutate=procedure('Private Sub NumberSelectedEquationCore'),transaction=procedure('Public Sub NumberSelectedEquation');
 for(const guard of [/Doc\.ReadOnly/,/Doc\.TrackRevisions/,/Doc\.ProtectionType <> wdNoProtection/,/StoryType <> wdMainTextStory/,/MathTypeBridgeTransportActive/,/paragraph\.Revisions\.Count/,/paragraph\.InlineShapes\.Count <> 1/,/paragraph\.Editors\.Count/,/paragraph\.Tables\.Count/,/unsupported field/])assert.match(mutate,guard);
 assert.match(source,/field\.Type = wdFieldEmbed[\s\S]*?field\.Result\.InlineShapes\.Count <> 1[\s\S]*?RibbonEmbeddedEquationFieldStart\(field, Doc\)[\s\S]*?Doc\.Range\(fieldStart, field\.Result\.End \+ 1\)/,'the complete OLE EMBED wrapper stays outside all insertion points');
 assert.match(source,/embedded\.Code\.Start - 1 To embedded\.Code\.Start - 2 Step -1[\s\S]*?value <> Chr\$\(19\)/,'EMBED start resolution follows the tested macOS delimiter guard');
 assert.match(source,/If field\.Type = wdFieldEmbed Then GoTo NextValidatedField[\s\S]*?NextValidatedField:/,'the OLE EMBED field is excluded from number-field validation');
 assert.match(source,/ValidateEquationParagraphRemainder Doc, paragraph, oleRange, bookmarkRange/);
 assert.match(mutate,/equation\.Range\.Document Is Doc/);
 assert.match(mutate,/insertion\.FormattedText = oldNumberRange\.FormattedText[\s\S]*?Set copiedRange = insertion\.Duplicate[\s\S]*?oldNumberRange\.Delete/,'copy fields into a retained range before deleting the source');
 assert.match(source,/Doc\.Bookmarks\.Add Name:=bookmarkName, Range:=Doc\.Range\(finalNumberStart/,'normalization restores the same bookmark name');
 assert.match(mutate,/oldNumberRange\.Start >= oleEnd[\s\S]*?oldNumberRange\.End <= oleStart/,'same-side requests are idempotent');
 assert.match(transaction,/ELBeginNumberingTransaction[\s\S]*?NumberSelectedEquationCore[\s\S]*?UpgradeLegacyNumbering[\s\S]*?ELCommitNumberingTransaction[\s\S]*?ELTransactionRecoveryMessage/,'unwrapping, exact OLE layout and shared-number conversion use one undo record');
 assert.ok(mutate.indexOf('ValidateRibbonNumberFormat pattern')<mutate.indexOf('Options.SmartCutPaste = False'),'format is validated before new-number Word changes');
 assert.match(mutate,/RequireCounterContext Doc, pattern, oleStart/,'chapter and section sequence context is checked before mutation');
 assert.match(source,/ELInvalidateDocumentSnapshot/,'successful numbering invalidates the cached document layout');
 assert.match(source,/TabStops\.Add Position:=leftIndent \+ usableWidth \/ 2, Alignment:=wdAlignTabCenter[\s\S]*?TabStops\.Add Position:=leftIndent \+ usableWidth, Alignment:=wdAlignTabRight/,'numbered paragraphs get tab stops relative to the target column margin and preserved indent');
 assert.match(source,/Private Sub NormalizeNumberParagraph[\s\S]*?gapEnd > gapStart[\s\S]*?firstStart > paragraph\.Start[\s\S]*?InsertAfter vbTab[\s\S]*?InsertBefore vbTab/,'normalize all layout whitespace to prevent repeated side-switch drift');
 assert.match(source,/Case "C"[\s\S]*?Case "S"[\s\S]*?Case "E"/);
 assert.match(source,/Case "1": fmt = "ARABIC"[\s\S]*?Case "A": fmt = "ALPHABETIC"[\s\S]*?Case "a": fmt = "alphabetic"[\s\S]*?Case "I": fmt = "ROMAN"[\s\S]*?Case "i": fmt = "roman"/);
 assert.match(source,/Type:=wdFieldSequence, Text:=sequence & " " & command & " \\\* " & fmt/,'new numbering uses native Word SEQ fields with the shared format switches');
 assert.match(source,/oldShowHidden = Doc\.Bookmarks\.ShowHidden[\s\S]*?Doc\.Bookmarks\.ShowHidden = True[\s\S]*?For Each numberBookmark In Doc\.Bookmarks[\s\S]*?Doc\.Bookmarks\.ShowHidden = oldShowHidden/,'hidden cross-reference bookmarks are included in the preflight');
 assert.match(source,/If bookmarkVisibilityChanged Then Doc\.Bookmarks\.ShowHidden = oldShowHidden/,'bookmark visibility is restored when a preflight rejects');
 assert.match(source,/Options\.SmartCutPaste = False[\s\S]*?Options\.SmartCutPaste = oldSmartCutPaste[\s\S]*?If smartCutPasteChanged Then Options\.SmartCutPaste = oldSmartCutPaste/,'SmartCutPaste is restored on success and failure');
 assert.match(source,/\.Text <> originalNumberText Or \.Fields\.Count <> originalNumberFields/,'bookmark drift aborts and rolls back the range operation');
 assert.match(mutate,/originalLength = oldNumberRange\.End - oldNumberRange\.Start[\s\S]*?Set oldNumberRange = Doc\.Range\(copiedRange\.End, copiedRange\.End \+ originalLength\)[\s\S]*?oldNumberRange\.Text <> originalNumber Or oldNumberRange\.Fields\.Count <> originalFields[\s\S]*?oldNumberRange\.Delete/,'reacquire and verify the old field range after Word expands retained ranges');
 assert.match(source,/Len\("\\\* MERGEFORMAT"\)/,'Word formatting switch is accepted');
 assert.match(source,/cursor = field\.Result\.End \+ 1/,'literals and following fields are inserted outside the field end delimiter');
 assert.match(source,/Case "C": sequence = "ELChapter": command = "\\c"[\s\S]*?Case "S": sequence = "ELSection": command = "\\c"[\s\S]*?Case Else: sequence = "EquationLab": command = "\\n"/);
 assert.match(source,/If IsEquationReference\(field, Doc\) And Not field\.Locked Then field\.Update/,'reference fields are refreshed through the shared document-bound updater');
});

test('Word insertion preview reads sequence resets before the insertion position',async()=>{
 const source=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabRibbon.bas',import.meta.url),'utf8');
 const start=source.indexOf('Private Function SequenceBeforePosition');
 assert.notEqual(start,-1);
 const sequence=source.slice(start,source.indexOf('End Function',start));
 assert.match(sequence,/field\.Code\.Start < beforePosition/);
 assert.match(sequence,/parts\(i\) = "\\R"/);
 assert.match(sequence,/parts\(i\) = "\\C"/);
 assert.match(sequence,/If resetFound Then[\s\S]*value = resetValue[\s\S]*ElseIf Not repeatCurrent Then[\s\S]*value = value \+ 1/);
 assert.match(source,/CurrentCounter\("ELChapter", Preference\("EquationLabChapter", "1"\)\)/);
 const insertion=source.slice(source.indexOf('Public Sub ELStartEquationInsertion'),source.indexOf('Private Function IsEquation'));
 assert.equal((insertion.match(/SequenceFieldsForDocument\(Doc\)/g)||[]).length,1);
 assert.match(insertion,/SequenceBeforePosition\(Doc, selectedRange.Start, "ELChapter", hasChapter, fields\)[\s\S]*SequenceBeforePosition\(Doc, selectedRange.Start, "ELSection", hasSection, fields\)/);
});

test('Legacy MathType numbering visits nested code fields and preserves macrobuttons and hidden reference names',async()=>{
 const source=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabRibbon.bas',import.meta.url),'utf8');
 const collect=source.slice(source.indexOf('Private Sub CollectEquationFields'),source.indexOf('Private Function IsEquationReference'));
 assert.match(collect,/CollectEquationFields field\.Code, fields, seen/);assert.match(collect,/CollectEquationFields field\.Result, fields, seen/);assert.match(collect,/field\.Type <> wdFieldEmbed/);assert.match(collect,/seen\.Add field, key/);assert.doesNotMatch(collect,/field\.Update|Selection|ActiveDocument/);
 const update=source.slice(source.indexOf('Private Sub UpdateNumbersForDocument'),source.indexOf('Private Sub InsertPreparedFragment'));
 const entry=source.slice(source.indexOf('Public Sub UpdateNumbers()'),source.indexOf('Private Sub OpenNumberingSettings'));
 assert.match(entry,/Set Doc = ActiveDocument[\s\S]*ELBeginNumberingTransaction[\s\S]*ELUpgradeNumberingForInterop Doc\s+UpdateNumbersForDocument Doc\s+NumberingChanged Doc\s+ELInvalidateDocumentSnapshot[\s\S]*ELCommitNumberingTransaction/);assert.doesNotMatch(entry,/\.Fields|\.Update/);
 assert.match(source,/"MTEQN", "MTCHAP", "MTSEC"/);assert.match(update,/Doc\.Bookmarks\.ShowHidden = True/);assert.equal((update.match(/Doc\.Bookmarks\.ShowHidden = showHidden/g)||[]).length,2);assert.match(update,/IsEquationSequence\(field\).*field\.Update[\s\S]*IsEquationReference\(field, Doc\).*field\.Update/);assert.doesNotMatch(update,/\.Delete|\.Unlink|Selection|ActiveDocument|MTPlaceRef.*\.Update/);
 const reference=source.slice(source.indexOf('Private Function IsEquationReference'),source.indexOf('Private Sub UpdateNumbersForDocument'));
 for(const guard of [/target\.Paragraphs\.Count <> 1/,/target\.Tables\.Count <> 0/,/target\.InlineShapes\.Count <> 0/,/target\.Characters\.Count > 256/])assert.match(reference,guard,'a whole table or prose bookmark must not qualify just because it contains a formula');
});

test('chapter boundary repair is confined to untracked owned reset fields and preserves Word state',async()=>{
 const source=await readFile('native-word-probe/automatic-loader/EquationLabRibbon.bas','utf8');
 const repair=source.slice(source.indexOf('Private Function HiddenContextReset'),source.indexOf('Private Sub UpdateNumbersForDocument'));
 assert.match(repair,/marker\.Tables\.Count <> 0 Or marker\.InlineShapes\.Count <> 0 Or marker\.Bookmarks\.Count <> 0 Or marker\.Revisions\.Count <> 0/);
 assert.match(repair,/marker\.Paragraphs\(1\)\.Range\.End <= marker\.End/,'a visible boundary must not be replaced again');
 assert.match(repair,/pkg:package/);assert.doesNotMatch(repair,/\.WordOpenXML|\.Select\b|TextRetrievalMode/);
 assert.match(repair,/marker\.InsertXML repaired\s+changed = True/,'a rejected insert must not undo an earlier user edit');
 assert.match(repair,/If trackingChanged Then Doc\.TrackRevisions = oldTracking/g);
 assert.match(repair,/Doc\.Content\.End <> beforeLength Or Doc\.Fields\.Count <> beforeFields Or Doc\.InlineShapes\.Count <> beforeObjects Then Doc\.Undo/);
 const update=source.slice(source.indexOf('Private Sub UpdateNumbersForDocument'),source.indexOf('Private Sub InsertPreparedFragment'));
 assert.ok(update.indexOf('NormalizeContextParagraphMarks Doc')<update.indexOf('CollectEquationFields Doc.Content'));
});

test('large unsaved enrichment yields between bound main-story ranges and pauses for foreground Word',async()=>{
 const source=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabDocumentContext.bas',import.meta.url),'utf8');
 const block=(name,end='End Sub')=>{const start=source.indexOf(name);assert.ok(start>=0,name);return source.slice(start,source.indexOf(end,start)).split('\n').map(line=>line.split("'")[0]).join('\n');};
 const chunk=block('Private Sub ELContinueDocumentChunks()');
 const meta=block('Private Function ELChunkDocumentMetadataMatches()','End Function');
 const nextEnd=block('Private Function ELNextDocumentChunkEnd(','End Function');
 assert.match(chunk,/ELDocumentChunkRequestToken\(\) <> token/);
 assert.match(chunk,/If Not ELChunkDocumentMetadataMatches\(\) Then GoTo Failed/);
 assert.match(meta,/ELIsDocumentOpen\(mChunkDocument\)/);
 assert.match(meta,/KnownDocumentIdentity\(mChunkDocument\) <> mChunkIdentity/);
 assert.match(meta,/mChunkDocument\.Content\.End <> mChunkEnd Or mChunkDocument\.InlineShapes\.Count <> mChunkShapeCount/);
 assert.match(meta,/MathTypeBridgeEditGeneration"\) <> mChunkGeneration/);
 assert.match(meta,/ELNumberingRevision\(mChunkDocument\) <> mChunkNumberingRevision/);
 assert.match(meta,/mChunkDocument\.Saved <> mChunkSaved Or mChunkDocument\.FullName <> mChunkFullName/);
 assert.match(chunk,/MathTypeBridgeCanReadDocumentChunk"\) = 0 Then\s+mChunkNeedsFullTextCheck = True\s+SchedulePoll\s+Exit Sub/);
 assert.ok(chunk.indexOf('MathTypeBridgeCanReadDocumentChunk')<chunk.indexOf('mChunkDocument.Content.Text <> mChunkText'));
 assert.match(chunk,/chunkText = span\.Text/);
 assert.match(chunk,/Mid\$\(mChunkText, mChunkTextOffset, chunkLen\) = chunkText/);
 assert.match(chunk,/If final = 1 Then[\s\S]*?If Not ELChunkDocumentMetadataMatches\(\) Then GoTo Failed[\s\S]*?If mChunkDocument\.Content\.Text <> mChunkText Then GoTo Failed/);
 assert.match(nextEnd,/Const CHUNK_PART_BUDGET As Long = 64/);
 assert.match(nextEnd,/Const CHUNK_MIN_CHARS As Long = 7500/);
 assert.match(nextEnd,/Const CHUNK_BYTE_BUDGET As Long = 100663296/);
 assert.match(nextEnd,/remainingParts = CHUNK_PART_BUDGET - partIndex/);
 assert.match(nextEnd,/If remainingParts <= 1 Then[\s\S]*?ELNextDocumentChunkEnd = chunkEnd/);
 assert.match(nextEnd,/stepSize = \(remaining \+ remainingParts - 1\) \\ remainingParts/);
 assert.match(nextEnd,/span\.Paragraphs\.Last\.Range\.Start/);
 assert.match(chunk,/last = ELNextDocumentChunkEnd\(mChunkDocument, mChunkStart, mChunkEnd, mChunkPart, mChunkXmlBytes\)/);
 assert.match(chunk,/xml = span\.WordOpenXML/);
 assert.match(chunk,/MathTypeBridgeQueueDocumentChunk/);
 assert.doesNotMatch(chunk+meta+nextEnd,/DoEvents|\.Select\b|ActiveDocument|\.Save\b|\.Content\.WordOpenXML/);
 assert.match(source,/If mChunkToken = requestToken Then Exit Sub/);
});

test('mixed background save relocates post-activation targets only via proven same-object bounds, never ordinal fallback',async()=>{
 const source=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabDocumentContext.bas',import.meta.url),'utf8');
 const block=(name,end='End Sub')=>{const start=source.indexOf(name);assert.ok(start>=0,name);return source.slice(start,source.indexOf(end,start)).split('\n').map(line=>line.split("'")[0]).join('\n');};
 const save=block('Private Sub ApplyBackgroundSave(');
 const resolve=block('Private Function ResolvePostActivationBackgroundEquation(','End Function');
 const fieldFor=block('Private Function EmbeddedEquationFieldForShape(','End Function');
 const within=block('Private Function RangeWithinEmbeddedEquationEnvelope(','End Function');
 assert.ok(save.indexOf('Set liveShape = shape')<save.indexOf('shape.OLEFormat.Activate'));
 assert.ok(save.indexOf('Set preField = EmbeddedEquationFieldForShape(Doc, shape)')<save.indexOf('shape.OLEFormat.Activate'));
 assert.ok(save.indexOf('preShapeCount = Doc.InlineShapes.Count')<save.indexOf('shape.OLEFormat.Activate'));
 assert.ok(save.indexOf('shape.OLEFormat.Activate')<save.indexOf('ResolvePostActivationBackgroundEquation(Doc, anchor, liveShape, preField, index, preShapeCount)'));
 assert.doesNotMatch(save+resolve,/ELNumberedSaveEquation|ActiveDocument|\bSelection\b|\.Select\b/);
 assert.match(resolve,/Set resolved = ResolveBoundEquation\(Doc, anchor, expectedIndex\)/);
 assert.match(resolve,/If Doc\.InlineShapes\.Count <> expectedShapeCount Then Exit Function/);
 assert.match(resolve,/If anchor\.Paragraphs\.Count = 1 And anchor\.InlineShapes\.Count = 1 Then[\s\S]*?RangeWithinEmbeddedEquationEnvelope\(Doc, anchor, candidate, embedded\)[\s\S]*?ResolveBoundEquation\(Doc, candidate\.Range, expectedIndex\)/);
 assert.match(resolve,/If Not liveShape Is Nothing And Not preField Is Nothing Then[\s\S]*?RangeWithinEmbeddedEquationEnvelope\(Doc, anchor, liveShape, preField\)[\s\S]*?ResolveBoundEquation\(Doc, liveShape\.Range, expectedIndex\)/);
 assert.match(fieldFor,/embedded\.Type = wdFieldEmbed[\s\S]*?embedded\.Result\.InlineShapes\.Count = 1[\s\S]*?EmbeddedEquationFieldStart\(embedded, Doc\)/);
 assert.match(within,/embedded\.Type <> wdFieldEmbed[\s\S]*?embedded\.Result\.InlineShapes\.Count <> 1[\s\S]*?span\.Start >= fieldStart And span\.End <= fieldEnd/);
});

test('saved snapshot reuse checks native file identity and an exact live anchor before a fresh nonce',async()=>{
 const source=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabDocumentContext.bas',import.meta.url),'utf8');
 const start=source.indexOf('Private Function ELReusableSavedEquationIndex'),helper=source.slice(start,source.indexOf('End Function',start));
 assert.match(helper,/Not mSnapshotAnchorSorted Or mSnapshotToken <= 0/);
 assert.match(helper,/mBoundDocuments\(CStr\(mSnapshotToken\)\)/);assert.match(helper,/mBoundRanges\(CStr\(mSnapshotToken\)\)/);
 assert.match(helper,/anchors\.Count <> mEquations\.Count/);
 assert.ok(helper.indexOf('MathTypeBridgeSavedDocumentCaptureReusable')<helper.indexOf('Do While low <= high'));
 assert.match(helper,/anchor\.Document Is bound/);assert.match(helper,/anchor\.StoryType <> wdMainTextStory/);assert.match(helper,/anchor\.End <> target\.End/);
 const begin=source.indexOf('Public Sub ELCaptureEquation'),capture=source.slice(begin,source.indexOf('End Sub',begin));
 const reusable=capture.indexOf('selected = ELReusableSavedEquationIndex'),issue=capture.indexOf('ELIssueDocumentActivationNonce',reusable),reuse=capture.indexOf('MathTypeBridgeReuseSavedDocumentCapture',issue),fresh=capture.indexOf('BuildSnapshot:');
 assert.ok(reusable>=0&&reusable<issue&&issue<reuse&&reuse<fresh);
 assert.match(capture.slice(reusable,reuse),/"ELREUSE1" & vbLf & CStr\(activationNonce\)[\s\S]*?CStr\(mSnapshotToken\)[\s\S]*?CStr\(selected\)/);
 assert.match(capture.slice(reuse,fresh),/If result = 0 Then[\s\S]*?GoTo Captured[\s\S]*?ELClearActivationAnchor\s+activationNonce = 0/);
 assert.match(capture,/If candidateStart <= previousStart Then anchorsSorted = False/);
});

test('shared number replacement resolves the real end delimiter and preserves the physical equation paragraph',async()=>{
 const source=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabRibbon.bas',import.meta.url),'utf8');
 const envelope=source.slice(source.indexOf('Private Function NumberEnvelope('),source.indexOf('Private Sub SaveSharedNumberFormat'));
 assert.match(envelope,/NumberEnvelopeEnd\(Doc, found\)/);assert.match(envelope,/character\.Text = Chr\$\(21\)/);
 assert.match(envelope,/IncludeHiddenText = True/);assert.match(envelope,/IncludeFieldCodes = True/);
 assert.doesNotMatch(envelope,/Doc\.Range\(found\.Code\.Start - 1, found\.Result\.End \+ 1\)/,'an empty macro result must never consume the following paragraph mark');
 const replace=source.slice(source.indexOf('Private Sub ReplaceNumberXML'),source.indexOf('Private Function NumberEnvelope('));
 assert.match(replace,/PhysicalNumberingParagraph\(Doc, target\)/);
 assert.match(replace,/Doc\.Paragraphs\.Count = beforeParagraphs \+ 1/);
 assert.match(replace,/inserted\.Start = paragraph\.Start And inserted\.End = paragraph\.End - 1 And paragraph\.InlineShapes\.Count = 0/);
 assert.match(replace,/Doc\.Range\(paragraph\.End - 1, paragraph\.End\)\.Text = vbCr/);
 assert.match(replace,/paragraph\.Style = style: paragraph\.ParagraphFormat = formatting/);
 assert.match(replace,/If Not displayOnlyFields Is Nothing Then[\s\S]*?If field.Type = wdFieldRef Then[\s\S]*?ReferenceNamesNumber\(field, Doc, name, aliases, enclosingNames\) Then references.Add field/);
 assert.match(replace,/NumberIncrementReset\(Doc, Doc.Bookmarks\(name\)\) <> equationReset[\s\S]*?For Each field In Doc.Bookmarks\(name\).Range.Fields[\s\S]*?For Each field In references[\s\S]*?If Not field.Locked Then field.Update/);
 assert.match(replace,/StrComp\(referenceName, CStr\(aliasName\), vbTextCompare\)/);
 assert.match(replace,/StrComp\(referenceName, CStr\(enclosingName\), vbTextCompare\)[\s\S]*?ReferenceNamesNumber = IsEquationReference\(field, Doc\)/);
 assert.doesNotMatch(replace,/CollectEquationFields|UpdateNumbersForDocument/,'format-only replacement reuses the collected fields and refreshes exact references only');
 assert.equal((replace.match(/Options\.SmartCutPaste = oldSmartCutPaste/g)||[]).length,2);
});

test('unreferenced MathType numbers receive only a bounded display anchor inside the existing undo transaction',async()=>{
 const vba=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabRibbon.bas',import.meta.url),'utf8');
 const ensure=vba.slice(vba.indexOf('Private Sub EnsureSharedNumberBookmark'),vba.indexOf('Public Sub ELUpgradeNumberingForInterop'));
 assert.match(ensure,/Set span = Doc\.Range\(NumberEnvelopeEnd\(Doc, increment\), outer\.Code\.End\)/);
 assert.match(ensure,/ValidateSharedNumberEnvelope Doc, outer, span/);assert.match(ensure,/NumberRangeFormat\(Doc, span\)/);
 assert.match(ensure,/bookmark\.Range\.Start < span\.End And bookmark\.Range\.End > span\.Start/);
 assert.match(ensure,/changed = True\s+Doc\.Bookmarks\.Add Name:=name, Range:=span/);
 assert.doesNotMatch(ensure,/\.Delete|InsertXML|InsertFile|\.Select|ActiveDocument|Selection/);
 const unwrap=vba.slice(vba.indexOf('Private Function UpdateOrUnwrapSelectedSharedNumber'),vba.indexOf('Private Function PendingSharedNumberSpan'));
 assert.match(unwrap,/EnsureSharedNumberBookmark Doc, equation, changed/);
 assert.match(unwrap,/patternOverride <> "" And Not contextChanged[\s\S]*SharedNumberOnRequestedSide[\s\S]*ReplaceNumberXML Doc, envelope, pattern, target.Name, chapter, section, equationNumber, replaceInPlace, changed, equationReset/);
 assert.match(unwrap,/If requireExisting Or Not HasLegacyNumbering\(Doc, fields\) Then Set displayOnlyFields = fields[\s\S]*?refreshedDisplayOnly = Not displayOnlyFields Is Nothing/);
 assert.match(unwrap,/ValidateEquationParagraphRemainder Doc, paragraph, oleRange, envelope/);
 assert.doesNotMatch(unwrap,/\.InsertXML|NormalizeNumberParagraph|\bSelection\b/);
 const upgrade=vba.slice(vba.indexOf('Public Sub ELUpgradeNumberingForInterop'),vba.indexOf('Private Function ValidDisplaySequence'));
 assert.ok(upgrade.indexOf('ELBeginNumberingTransaction')<upgrade.indexOf('EnsureSharedNumberBookmark'));
 assert.match(upgrade,/ELTransactionRecoveryMessage/);
 const reference=vba.slice(vba.indexOf('Private Sub InsertReference()'),vba.indexOf("' Shared by the Ribbon"));
 assert.doesNotMatch(reference,/ELUpgradeNumberingForInterop Doc/);
 assert.ok(reference.indexOf('ChooseReference(')<reference.indexOf('ELBeginNumberingTransaction'));
 assert.ok(reference.indexOf('ELBeginNumberingTransaction')<reference.indexOf('EnsureSharedNumberBookmark Doc, equation, changed'));
});

test('Word verifies the existing numbering revision before the exact owner verb and again before any numbering write',async()=>{
 const [host,ribbon]=await Promise.all([
  readFile(new URL('../native-word-probe/automatic-loader/EquationLabDocumentContext.bas',import.meta.url),'utf8'),
  readFile(new URL('../native-word-probe/automatic-loader/EquationLabRibbon.bas',import.meta.url),'utf8')
 ]);
 const save=host.slice(host.indexOf('Private Sub ApplyBackgroundSave('),host.indexOf('Private Sub ELRememberNumberedSave('));
 assert.match(save,/ELNumberingRevision\(Doc\) <> existingRevision Then GoTo Failed[\s\S]*?shape\.OLEFormat\.Activate[\s\S]*?ELNumberingRevision\(Doc\) <> existingRevision Then GoTo Failed[\s\S]*?NumberSelectedEquation[^\n]*\(existingRevision >= 0\)/);
 assert.match(save,/If existingRevision < 0 Then Doc\.Saved = False/);
 const update=ribbon.slice(ribbon.indexOf('Private Function UpdateOrUnwrapSelectedSharedNumber('),ribbon.indexOf('Private Function SharedNumberOnRequestedSide('));
 assert.match(update,/If Not requireExisting Then EnsureSharedNumberBookmark/);
 assert.match(update,/If requireExisting And Not replaceInPlace Then Exit Function[\s\S]*?ReplaceNumberXML/);
});

test('reference picker text handles truncated UTF-16 without altering valid pairs',async()=>{
 const vba=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabRibbon.bas',import.meta.url),'utf8');
 const text=vba.slice(vba.indexOf('Private Function ReferenceDisplayText'),vba.indexOf('Private Function ChooseReference'));
 assert.match(text,/unit >= &HD800& And unit <= &HDBFF&/);
 assert.match(text,/following >= &HDC00& And following <= &HDFFF&[\s\S]*?Mid\$\(value, i, 2\)/);
 assert.match(text,/ElseIf unit >= &HDC00& And unit <= &HDFFF& Then\s+safe = safe & " "/);
 const picker=vba.slice(vba.indexOf('Private Sub InsertReference()'),vba.indexOf("' Shared by the Ribbon"));
 assert.match(picker,/ReferenceDisplayText\(Right\$\(context\.Text, 180\)\)/);
});
