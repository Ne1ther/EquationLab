import {readFile,writeFile,mkdir,mkdtemp,cp,copyFile,chmod,symlink,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const run=(binary,args,options={})=>execFileSync(binary,args,{encoding:'utf8',maxBuffer:8_000_000,...options});

export async function createApplicationZip({app,output,version,adHoc=true}){
  if(!/^\d+\.\d+\.\d+(?:[-.][A-Za-z0-9.-]+)?$/.test(version))throw Error('Invalid release version.');
  const temp=await realpath(await mkdtemp(join(tmpdir(),'equationlab-zip-')));
  try{
    await mkdir(output,{recursive:true});
    run('/usr/bin/codesign',['--verify','--deep','--strict',app]);
    const zip=`Equation-Lab-${version}-macOS-arm64${adHoc?'-preview':''}.zip`,archive=join(temp,zip);
    run('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',app,archive]);
    const extracted=join(temp,'verify');await mkdir(extracted);
    run('/usr/bin/ditto',['-x','-k',archive,extracted]);
    run('/usr/bin/codesign',['--verify','--deep','--strict',join(extracted,'Equation Lab.app')]);
    const zipSha256=createHash('sha256').update(await readFile(archive)).digest('hex');
    await copyFile(archive,join(output,zip));
    return {zip,zipSha256};
  }finally{await rm(temp,{recursive:true,force:true});}
}

export async function createDiskImage({app,output,version,adHoc=true}){
  if(!/^\d+\.\d+\.\d+(?:[-.][A-Za-z0-9.-]+)?$/.test(version))throw Error('Invalid release version.');
  const temp=await realpath(await mkdtemp(join(tmpdir(),'equationlab-dmg-')));
  let mounted=false;
  try{
    await mkdir(output,{recursive:true});
    run('/usr/bin/codesign',['--verify','--deep','--strict',app]);
    const imageRoot=join(temp,'image');await mkdir(imageRoot);
    await cp(app,join(imageRoot,'Equation Lab.app'),{recursive:true,verbatimSymlinks:true});
    run('/usr/bin/codesign',['--verify','--deep','--strict',join(imageRoot,'Equation Lab.app')]);
    await symlink('/Applications',join(imageRoot,'Applications'));
    await copyFile(join(root,'packaging','INSTALL.zh-CN.txt'),join(imageRoot,'安装说明.txt'));
    const dmg=`Equation-Lab-${version}-macOS-arm64${adHoc?'-preview':''}.dmg`;
    const target=join(temp,dmg);
    const modern=spawnSync('/usr/sbin/diskutil',['image','create','from','--help'],{encoding:'utf8'});
    let imageBuilder;
    if(modern.status===0&&modern.stdout.includes('USAGE: diskutil image create from')){
      run('/usr/sbin/diskutil',['image','create','from','--format','UDZO','--volumeName',`Equation Lab ${version}`,imageRoot,target],{stdio:'inherit'});
      imageBuilder='diskutil image create from';
    }else{
      run('/usr/bin/hdiutil',['create','-volname',`Equation Lab ${version}`,'-srcfolder',imageRoot,'-ov','-fs','HFS+','-format','UDZO','-imagekey','zlib-level=9',target],{stdio:'inherit'});
      imageBuilder='hdiutil create';
    }
    run('/usr/bin/hdiutil',['verify',target]);
    const mount=join(temp,'mount');await mkdir(mount);
    let validation;
    try{
      run('/usr/bin/hdiutil',['attach','-readonly','-nobrowse','-mountpoint',mount,target]);mounted=true;
      const mountedApp=join(mount,'Equation Lab.app');
      run('/usr/bin/codesign',['--verify','--deep','--strict',mountedApp]);
      const response=JSON.parse(run(join(mountedApp,'Contents/Resources/runtime/bin/node'),[join(mountedApp,'Contents/Resources/engine/src/desktop-rpc.mjs')],{cwd:mount,input:JSON.stringify({action:'validate',payload:{latex:'\\frac{a+c}{\\sqrt{x^2+y^2}}'}}),env:{PATH:'/usr/bin:/bin',TMPDIR:tmpdir()},timeout:30000}));
      if(!response.ok||!response.data?.svg?.includes('<svg'))throw Error('Read-only DMG engine validation failed.');
      validation={passed:true,nativeBytes:response.data.nativeBytes,characters:response.data.characters};
    }finally{
      if(mounted){run('/usr/bin/hdiutil',['detach',mount]);mounted=false;}
    }
    const dmgSha256=createHash('sha256').update(await readFile(target)).digest('hex');
    await copyFile(target,join(output,dmg));
    return {dmg,dmgSha256,imageBuilder,validation};
  }finally{if(!mounted)await rm(temp,{recursive:true,force:true});}
}

if(process.argv[1]&&await realpath(process.argv[1]).catch(()=>null)===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
  const app=resolve(option('--app',join(root,'dist','Equation Lab.app')));
  const output=resolve(option('--output',join(root,'dist')));
  const report=JSON.parse(await readFile(join(app,'Contents','Resources','release-manifest.json'),'utf8'));
  if(!report.equationlabBundle)throw Error('Not an Equation Lab release bundle.');
  delete report.equationlabBundle;
  const assessment=spawnSync('/usr/sbin/spctl',['--assess','--type','execute','--verbose=2',app],{encoding:'utf8'});
  report.signing.acceptedUnderCurrentSystemPolicy=assessment.status===0;
  report.signing.policyOverrideDetected=/override=security disabled/i.test(assessment.stderr||assessment.stdout||'');
  report.signing.gatekeeperAccepted=assessment.status===0&&!report.signing.policyOverrideDetected;
  report.signing.distributionTrustConfirmed=false;
  report.signing.gatekeeperOutput=(assessment.stderr||assessment.stdout||'').trim().replaceAll(app,'Equation Lab.app');
  const zipArtifact=await createApplicationZip({app,output,version:report.version,adHoc:report.signing.kind==='ad-hoc'});
  const {validation,...artifact}=await createDiskImage({app,output,version:report.version,adHoc:report.signing.kind==='ad-hoc'});
  report.artifacts={app:'Equation Lab.app',...zipArtifact,...artifact};
  report.checks={...report.checks,codesign:true,zipExtractionSignatureVerified:true,dmgVerified:true,dmgReadOnlyEngine:validation};
  await writeFile(join(output,`Equation-Lab-${report.version}-packaging-report.json`),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({ok:true,...artifact}));
}
