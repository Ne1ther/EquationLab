import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {auditDocx} from '../src/document-audit.mjs';
import {inspectDocx} from '../src/document.mjs';
import {baseCompatibilityDocument} from './helpers/document-compat-corpus.mjs';

const execute=promisify(execFile);
test('production Swift model consumes publisher deltas, mixed searches and explicit audit associations',{skip:process.platform!=='darwin',timeout:60000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'equationlab-workbench-metadata-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const bytes=await baseCompatibilityDocument(),doc=await inspectDocx(bytes),audit=await auditDocx(bytes);
 for(const object of doc.objects)object.image=null;
 const c=vm.createContext({});vm.runInContext(await readFile(new URL('../desktop/sidebar-state.js',import.meta.url),'utf8'),c);
 const wire=value=>JSON.parse(JSON.stringify(value));
 const publisher=c.createSidebarPublisher(),frames=[wire({objectsDelta:publisher.snapshot(doc).delta,selected:1})];
 doc.objects[1].layout.numberText='(3.28)';publisher.invalidate(doc,[1]);frames.push(wire({objectsDelta:publisher.snapshot(doc).delta}));
 doc.objects[0].layout.numberText='(3.28)';publisher.invalidate(doc,[0]);frames.push(wire({objectsDelta:publisher.snapshot(doc).delta}));
 doc.objects[1].layout.numberText=null;publisher.invalidate(doc,[1]);frames.push(wire({objectsDelta:publisher.snapshot(doc).delta}));
 const target=audit.targets[0],field=target.fieldIds[0];
 const rows=[{targetId:target.id},{fieldId:field},{equationIndex:0},audit.references[0],{location:{part:'word/document.xml',paragraph:0,ordinal:0}},{targetIds:audit.targets.map(x=>x.id)},{targetId:target.id,equationIndex:1},{fieldId:'unknown'},{targetId:'unknown'}];
 const cases=[{report:audit,rows,expected:[0,0,0,0,null,null,null,null,null]}];
 cases.push({report:{...audit,targets:[{...target,equationIndices:[0,1]}]},rows:[{targetId:target.id},{fieldId:field}],expected:[null,null]});
 cases.push({report:{...audit,targets:[target,{...target}]},rows:[{targetId:target.id},{fieldId:field}],expected:[null,null]});
 const sheet=await readFile(new URL('../macos/Views/DocumentToolsSheet.swift',import.meta.url),'utf8');
 const plugin=await readFile(new URL('../macos/Services/WordPluginInstallation.swift',import.meta.url),'utf8');
 const continuation=plugin.slice(plugin.indexOf('    func continueWordPluginInstallationAfterOfficeAccess()'),plugin.indexOf('    private func installUserWordPlugin()'));
 const continuationFixture=`\nfinal class DesktopBridge { var installationRunning=false, wordPluginInstallationPending=false; var calls:[String]=[]; func installWordPlugin(){calls.append("install")}; func verifyWordPlugin(showResult:Bool){calls.append("verify")};\n${continuation}\n}\n`;
 const support=sheet.slice(sheet.indexOf('enum DocumentAuditEquationResolver'),sheet.indexOf('struct DocumentToolsSheet:'))+'\n'+plugin.slice(plugin.indexOf('enum WordPluginInstallationInterruption'),plugin.indexOf('extension DesktopBridge'))+continuationFixture;
 await writeFile(join(directory,'Support.swift'),'import Foundation\n'+support);
 await writeFile(join(directory,'input.json'),JSON.stringify({frames,cases}));
 await writeFile(join(directory,'main.swift'),String.raw`
import Foundation
let input = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))) as! [String: Any]
var state = WorkbenchState(), snapshots: [[String: Any]] = []
for frame in input["frames"] as! [[String: Any]] {
    try state.apply(frame)
    snapshots.append(["selected": state.selected as Any, "numbers": state.objects.map { $0.numberText as Any }, "matches": state.objects.filter { $0.matchesSearch("3.28 sqrt") }.map(\.id), "allNumbers": state.objects.filter { $0.matchesSearch("3.28") }.map(\.id)])
}
let resolved = (input["cases"] as! [[String: Any]]).map { item -> [Any] in
    let report = item["report"] as! [String: Any]
    return (item["rows"] as! [[String: Any]]).map { DocumentAuditEquationResolver.uniqueIndex(for: $0, in: report) as Any }
}
let interruptions = [WordPluginInstallationInterruption.classify(code: "WORD_RUNNING", message: "") == .wordRunning,
    WordPluginInstallationInterruption.classify(code: "WORD_SETTINGS_ACCESS_DENIED", message: "") == .officeAccess,
    WordPluginInstallationInterruption.classify(code: nil, message: "permission denied") == .officeAccess,
    WordPluginInstallationInterruption.classify(code: "COMPONENT_CONFLICT", message: "External component") == nil]
let bridge = DesktopBridge()
bridge.continueWordPluginInstallationAfterOfficeAccess()
bridge.wordPluginInstallationPending = true; bridge.continueWordPluginInstallationAfterOfficeAccess()
bridge.installationRunning = true; bridge.continueWordPluginInstallationAfterOfficeAccess()
let bytes = try JSONSerialization.data(withJSONObject: ["snapshots": snapshots, "resolved": resolved, "interruptions": interruptions, "continuation": bridge.calls])
print(String(data: bytes, encoding: .utf8)!)
`);
 const binary=join(directory,'metadata');await execute('/usr/bin/swiftc',[new URL('../macos/Models/WorkbenchState.swift',import.meta.url).pathname,join(directory,'Support.swift'),join(directory,'main.swift'),'-o',binary],{timeout:30000});
 const {stdout}=await execute(binary,[join(directory,'input.json')],{timeout:5000}),output=JSON.parse(stdout);
 assert.deepEqual(output.snapshots.map(x=>x.selected),[1,1,1,1]);
 assert.deepEqual(output.snapshots.map(x=>x.matches),[[],[1],[1],[]]);
 assert.deepEqual(output.snapshots.map(x=>x.allNumbers),[[],[1],[0,1],[0]]);
 assert.equal(output.snapshots[3].numbers[1],null);
 assert.deepEqual(output.resolved,cases.map(x=>x.expected));assert.deepEqual(output.interruptions,[true,true,true,true]);
 assert.deepEqual(output.continuation,['verify','install'],'ordinary consent only verifies; a pending user request resumes once and concurrent attempts do nothing');
});
