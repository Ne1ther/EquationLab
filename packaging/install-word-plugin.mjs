// Runs only after the user explicitly chooses Install Word Plugin.
// Ships no certificate or private key. The certificate is local to this user.
import {mkdir, readFile, writeFile, chmod, copyFile, access, realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash, X509Certificate} from 'node:crypto';
import {manageWordService} from './word-service.mjs';

function run(binary, args) {
  try { return execFileSync(binary, args, {encoding:'utf8', maxBuffer:4_000_000, stdio:['ignore','pipe','pipe']}).trim(); }
  catch (error) { throw Error(`${binary.split('/').at(-1)}: ${error.stderr?.toString().trim() || error.message}`); }
}
const exists = path => access(path).then(()=>true,()=>false);
async function validLocalCredentials(certificate,key) {
  try {
    run('/usr/bin/openssl', ['x509','-in',certificate,'-checkend','604800','-noout']);
    const x509 = new X509Certificate(await readFile(certificate));
    const certPublic = run('/usr/bin/openssl',['x509','-in',certificate,'-pubkey','-noout']);
    const keyPublic = run('/usr/bin/openssl',['pkey','-in',key,'-pubout']);
    return !x509.ca && x509.checkHost('localhost',{wildcards:false})==='localhost'
      && x509.checkIP('127.0.0.1')==='127.0.0.1'
      && x509.issuer===x509.subject && x509.verify(x509.publicKey) && certPublic===keyPublic;
  } catch { return false; }
}

export async function installWordPlugin({app, dryRun=false, wefDirectory}={}) {
  if (process.platform!=='darwin') throw Error('Word 插件安装仅适用于 macOS');
  const bundle = await realpath(app || resolve(fileURLToPath(new URL('../../..', import.meta.url))));
  const resources = join(bundle, 'Contents', 'Resources');
  const manifest = join(resources, 'engine', 'addin', 'manifest.xml');
  if (!await exists(manifest)) throw Error('安装包中缺少 Word 加载项清单');
  const manifestText = await readFile(manifest, 'utf8');
  if (!manifestText.includes('https://localhost:37951/')) throw Error('Word 加载项地址不是预期的本机服务');
  const support = join(homedir(), 'Library', 'Application Support', 'Equation Lab');
  const tlsDir = join(support, 'tls');
  const key = join(tlsDir, 'localhost-key.pem');
  const certificate = join(tlsDir, 'localhost-cert.pem');
  const wordDocuments = join(homedir(), 'Library', 'Containers', 'com.microsoft.Word', 'Data', 'Documents');
  const wef = join(wordDocuments, 'wef');
  // NSOpenPanel grants the application access to this precise Word folder;
  // never accept an arbitrary destination supplied to the CLI.
  if (wefDirectory) {
    const selected = await realpath(wefDirectory), documents = await realpath(wordDocuments);
    if (selected !== documents && selected !== join(documents, 'wef')) throw Error('请选择 Word 的 Documents 或 wef 加载项文件夹');
  }
  const destination = join(wef, 'EquationLab.xml');
  const plan = {app:bundle, manifest:destination, certificate, privateKey:key, certificateTrust:'login keychain, SSL policy, hostname=localhost', restartWord:true};
  if (dryRun) return {ok:true, dryRun:true, plan};

  await mkdir(tlsDir, {recursive:true, mode:0o700});
  await chmod(tlsDir, 0o700);
  const reusable = await exists(key) && await exists(certificate) && await validLocalCredentials(certificate,key);
  if (!reusable) {
    // Preserve any previous local credentials, including user-owned credentials.
    const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    if (await exists(key)) { await copyFile(key, `${key}.${stamp}.backup`); await chmod(`${key}.${stamp}.backup`,0o600); }
    if (await exists(certificate)) await copyFile(certificate, `${certificate}.${stamp}.backup`);
    const config = join(tlsDir,'openssl.cnf');
    await writeFile(config, '[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=extensions\n[dn]\nCN=Equation Lab localhost\nO=Equation Lab\n[extensions]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n', {mode:0o600});
    run('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-days','365','-keyout',key,'-out',certificate,'-config',config]);
  }
  await chmod(key,0o600);
  await chmod(certificate,0o644);
  if(!await validLocalCredentials(certificate,key))throw Error('本机 HTTPS 证书校验失败，未安装或信任证书');
  const fingerprint = run('/usr/bin/openssl',['x509','-in',certificate,'-noout','-fingerprint','-sha256']).split('=').at(-1);
  const loginKeychain = join(homedir(),'Library','Keychains','login.keychain-db');
  // macOS may ask the user to authorize this trust change. No system keychain,
  // broad certificate settings, TLS bypass, or Gatekeeper changes are used.
  let alreadyTrusted = false;
  try { run('/usr/bin/security',['verify-cert','-c',certificate,'-p','ssl','-s','localhost']); alreadyTrusted = true; } catch {}
  if (!alreadyTrusted) run('/usr/bin/security',['add-trusted-cert','-r','trustRoot','-p','ssl','-s','localhost','-k',loginKeychain,certificate]);
  try {
    await mkdir(wef,{recursive:true});
    if (await exists(destination)) {
      const current = await readFile(destination);
      if (!current.equals(Buffer.from(manifestText))) await copyFile(destination, `${destination}.${Date.now()}.backup`);
    }
    await writeFile(destination,manifestText,{mode:0o644});
  } catch(error) {
    if(['EPERM','EACCES'].includes(error.code)) {
    const denied=Error('本机 HTTPS 证书已准备好，但尚未获得 Word 加载项目录权限。请重新选择“安装 Word 顶栏与侧栏”，在文件夹选择窗口中确认 Word 的 Documents 文件夹。');
      denied.code='WORD_CONTAINER_ACCESS_DENIED';
      denied.manualInstall={source:manifest,destinationDirectory:wef,filename:'EquationLab.xml'};
      throw denied;
    }
    throw error;
  }
  const background=await manageWordService({app:bundle});
  const state = {version:2,app:bundle,installedAt:new Date().toISOString(),manifest:destination,manifestSha256:createHash('sha256').update(manifestText).digest('hex'),tls:{certificate,privateKey:key,fingerprint},background,restartWord:true};
  await writeFile(join(support,'word-plugin-install.json'),JSON.stringify(state,null,2)+'\n',{mode:0o600});
  return {ok:true,installed:[destination],tls:{certificate,fingerprint},background,restartWord:true};
}

export async function uninstallWordTaskPane(){
 const support=join(homedir(),'Library/Application Support/Equation Lab'),record=join(support,'word-plugin-install.json');
 const state=JSON.parse(await readFile(record,'utf8'));
 const destination=join(homedir(),'Library/Containers/com.microsoft.Word/Data/Documents/wef/EquationLab.xml');
 if(state.manifest!==destination)throw Error('加载项安装路径不匹配，未移除');
 const current=await readFile(destination);
 if(createHash('sha256').update(current).digest('hex')!==state.manifestSha256)throw Error('加载项清单已被外部修改，未移除');
 await manageWordService({action:'remove'});
 const {unlink}=await import('node:fs/promises');await unlink(destination);await unlink(record);
 return {ok:true,removed:[destination],certificateRetained:true};
}

if (process.argv[1] && await realpath(process.argv[1]).catch(()=>undefined)===fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); const appIndex=args.indexOf('--app'), directoryIndex=args.indexOf('--wef-directory');
  try { process.stdout.write(JSON.stringify(args.includes('--remove')?await uninstallWordTaskPane():await installWordPlugin({app:appIndex<0?undefined:args[appIndex+1],wefDirectory:directoryIndex<0?undefined:args[directoryIndex+1],dryRun:args.includes('--dry-run')}))+'\n'); }
  catch(error) { process.stdout.write(JSON.stringify({ok:false,error:error.message,...(error.code?{code:error.code}:{}),...(error.manualInstall?{manualInstall:error.manualInstall}:{})})+'\n'); process.exitCode=1; }
}
