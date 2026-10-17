import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readArtifacts} from './installer.mjs';

const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const xml=text=>String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const run=(binary,args)=>execFileSync(binary,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:4000000});
export async function buildAutomaticPackage({app,artifacts,output,version,kind='full',signIdentity=process.env.EQUATIONLAB_INSTALLER_SIGN_IDENTITY}={}){
 if(!['full','word','remove'].includes(kind))throw Error('Unknown package type.');
 if(!/^\d+\.\d+\.\d+$/.test(version??''))throw Error('Package version required.');
 const accepted=await readArtifacts(artifacts);if(accepted.manifest.binding!=='startup-adjacent')throw Error('Automatic package requires the portable adjacent loader.');
 const temporary=await fs.mkdtemp(path.join(tmpdir(),'equationlab-auto-pkg-'));
 try{
  const scripts=path.join(temporary,'scripts'),modules=path.join(scripts,'word-native-installer'),resources=path.join(temporary,'resources');
  await fs.mkdir(modules,{recursive:true});await fs.mkdir(resources);
  for(const file of ['installer.mjs','automatic-install.mjs'])await fs.copyFile(path.join(source,'word-native-installer',file),path.join(modules,file));
  await fs.copyFile(path.join(source,'word-service.mjs'),path.join(scripts,'word-service.mjs'));
  await fs.cp(accepted.root,path.join(scripts,'artifacts'),{recursive:true,preserveTimestamps:true});
  await fs.copyFile(path.join(app,'Contents/Resources/runtime/bin/node'),path.join(scripts,'node'));await fs.chmod(path.join(scripts,'node'),0o755);
  run('/usr/bin/codesign',['--verify','--strict',path.join(scripts,'node')]);
  const removing=kind==='remove',flag=removing?' --remove':'';
  const entry='"$script_directory/node" "$script_directory/word-native-installer/automatic-install.mjs"'+flag;
  const preinstall=`#!/bin/sh\nset -eu\nscript_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nif [ "$(/usr/bin/uname -m)" != arm64 ]; then echo 'Equation Lab 需要 Apple Silicon Mac。' >&2; exit 1; fi\nif /usr/bin/pgrep -x 'Microsoft Word' >/dev/null; then echo '请先保存文档并退出 Microsoft Word，然后重试安装。' >&2; exit 1; fi\n${kind==='full'?"if /usr/bin/pgrep -x EquationLab >/dev/null; then echo '请先退出 Equation Lab，然后重试安装。' >&2; exit 1; fi\n":""}${entry} --check\n`;
  const postinstall=`#!/bin/sh\nset -eu\nscript_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\n${entry}\n`;
  for(const [name,text]of [['preinstall',preinstall],['postinstall',postinstall]]){await fs.writeFile(path.join(scripts,name),text,{mode:0o755});run('/bin/sh',['-n',path.join(scripts,name)]);}
  const component=path.join(temporary,'component.pkg'),identifier='app.equationlab.'+({full:'mac',word:'word-plugin',remove:'word-plugin.remove'}[kind]);
  const payloadArgs=[];
  if(kind==='full'){
   const payload=path.join(temporary,'payload');await fs.mkdir(path.join(payload,'Applications'),{recursive:true});
   const payloadApp=path.join(payload,'Applications/Equation Lab.app');
   // Resolving relative links here changes the sealed bundle and can bind the
   // installer to the build machine. Preserve each original link verbatim.
   await fs.cp(app,payloadApp,{recursive:true,preserveTimestamps:true,dereference:false,verbatimSymlinks:true});
   run('/usr/bin/codesign',['--verify','--deep','--strict',payloadApp]);
   const properties=path.join(temporary,'components.plist');run('/usr/bin/pkgbuild',['--analyze','--root',payload,properties]);
   const plist=JSON.parse(run('/usr/bin/plutil',['-convert','json','-o','-',properties]));
   for(const entry of plist){entry.BundleIsRelocatable=false;entry.BundleOverwriteAction='upgrade';}
   const json=path.join(temporary,'components.json');await fs.writeFile(json,JSON.stringify(plist));run('/usr/bin/plutil',['-convert','xml1','-o',properties,json]);
   payloadArgs.push('--root',payload,'--component-plist',properties,'--install-location','/','--ownership','recommended');
  }else payloadArgs.push('--nopayload');
  run('/usr/bin/pkgbuild',[...payloadArgs,'--identifier',identifier,'--version',version,'--scripts',scripts,component]);
  const title=removing?'Equation Lab Word 插件卸载':kind==='full'?'Equation Lab':'Equation Lab Word 插件';
  const introduction=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{font:14px -apple-system;padding:16px;color:#252525;line-height:1.7}h1{font-size:24px}li{margin:8px 0}</style><h1>${title}</h1><p>${removing?'将移除本安装器管理的 Word 顶栏组件和后台服务，保留 Equation Lab App 和个人公式。':'安装完成后，重新打开 Word 并新建或打开一篇文档，即可看到 Equation Lab 顶栏。安装器会自动放置全部组件，无需选择插件目录。'}</p><ul><li>请先保存文档并退出 Microsoft Word。${kind==='full'?'同时退出 Equation Lab。':''}</li><li>适用于 Apple Silicon Mac 和桌面版 Microsoft Word。</li><li>${kind==='full'?'App 安装到“应用程序”，Word 插件安装到当前登录用户的启动目录。':'用于已安装 Equation Lab 的当前 macOS 登录用户。'}</li></ul></html>`;
  await fs.writeFile(path.join(resources,'welcome.html'),introduction);
  await fs.writeFile(path.join(resources,'conclusion.html'),`<!doctype html><meta charset="utf-8"><style>body{font:15px -apple-system;padding:20px;line-height:1.7}</style><p>${removing?'Word 插件已卸载。':'安装完成。打开 Microsoft Word，新建或打开一篇文档，在顶部点击 Equation Lab 即可开始。'}</p><p>以后可在 Equation Lab App 的“Office 插件”入口安装、修复或卸载。</p>`);
  const distribution=path.join(temporary,'Distribution.xml');
  // Let Installer explain the running-app requirement before privileged scripts
  // start. Keep preinstall's process check as protection against a later launch.
  const mustClose=`<pkg-ref id="${identifier}"><must-close><app id="com.microsoft.Word"/>${kind==='full'?'<app id="app.equationlab.mac"/>':''}</must-close></pkg-ref>`;
  await fs.writeFile(distribution,`<?xml version="1.0" encoding="utf-8"?><installer-gui-script minSpecVersion="2"><title>${xml(title)}</title><welcome file="welcome.html" mime-type="text/html"/><conclusion file="conclusion.html" mime-type="text/html"/><options customize="never" require-scripts="true" hostArchitectures="arm64"/><domains enable_localSystem="true" enable_currentUserHome="false" enable_anywhere="false"/><allowed-os-versions><os-version min="14.0"/></allowed-os-versions><choices-outline><line choice="default"/></choices-outline><choice id="default" visible="false" title="${xml(title)}"><pkg-ref id="${identifier}"/></choice><pkg-ref id="${identifier}" version="${version}" onConclusion="none">component.pkg</pkg-ref>${mustClose}</installer-gui-script>`);
  const filename=kind==='full'?`Equation-Lab-${version}.pkg`:removing?'EquationLab-Word-Uninstall.pkg':'EquationLab-Word-Plugin.pkg',target=path.join(output,filename);
  await fs.mkdir(output,{recursive:true});try{await fs.lstat(target);throw Error('Refusing to overwrite frozen package: '+target);}catch(error){if(error.code!=='ENOENT')throw error;}
  run('/usr/bin/productbuild',['--distribution',distribution,'--package-path',temporary,'--resources',resources,...(signIdentity?['--sign',signIdentity]:[]),target]);
  const expanded=path.join(temporary,'expanded');run('/usr/sbin/pkgutil',[kind==='full'?'--expand-full':'--expand',target,expanded]);
  const observed=await fs.readFile(path.join(expanded,'Distribution'),'utf8');if(!observed.includes('customize="never"')||observed.includes('enable_anywhere="true"'))throw Error('Package unexpectedly exposes installation customization.');
  if(kind==='full')run('/usr/bin/codesign',['--verify','--deep','--strict',path.join(expanded,'component.pkg/Payload/Applications/Equation Lab.app')]);
  return {file:filename,kind,automaticWordInstall:!removing,signed:!!signIdentity,notarized:false,templateBuildId:accepted.manifest.template.buildId};
 }finally{await fs.rm(temporary,{recursive:true,force:true});}
}

// The bundled app creates a Word-only installer when requested instead of
// embedding two compressed copies of its own Node runtime in every app.
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>20000)throw Error('Package request too large.');}
  const request=JSON.parse(input);
  if(!['word','remove'].includes(request.kind))throw Error('Only Word component packages can be prepared by the app.');
  const result=await buildAutomaticPackage({...request,signIdentity:undefined});
  process.stdout.write(JSON.stringify({ok:true,...result}));
 }catch(error){process.stdout.write(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}
}
