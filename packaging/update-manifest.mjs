import {readFile, writeFile, stat} from 'node:fs/promises';
import {createHash, createPublicKey, sign, verify} from 'node:crypto';
import path from 'node:path';

export async function writeUpdateManifest({root, output, packageFile, version, build, minimumMacOS, privateKeyFile}) {
  if (!privateKeyFile) throw Error('Set EQUATIONLAB_UPDATE_PRIVATE_KEY to the local Ed25519 release signing key.');
  const privateKey = await readFile(privateKeyFile);
  const jwk = createPublicKey(privateKey).export({format:'jwk'});
  if(jwk.crv !== 'Ed25519') throw Error('Update signing requires an Ed25519 key.');
  const publicKey = Buffer.from(jwk.x,'base64url').toString('base64');
  const trusted = await readFile(path.join(root,'updater/UpdateTrust.swift'),'utf8');
  if (!trusted.includes(`public static let publicKey = "${publicKey}"`)) throw Error('Signing key does not match the public key shipped in the application.');
  const notes = JSON.parse(await readFile(path.join(root,'packaging/update-notes.json'),'utf8'));
  if(notes.version !== version || !notes.zh || !notes.en || notes.zh.length > 8000 || notes.en.length > 8000) throw Error('Update notes must match the release version and include Chinese and English.');
  const filename=path.basename(packageFile);
  if(filename!==`Equation-Lab-${version}.pkg` || !/^\d+\.\d+\.\d+$/.test(version) || !Number.isSafeInteger(Number(build)) || Number(build)<1) throw Error('Invalid update version, build, or installer name.');
  const bytes=await readFile(path.join(output,filename));
  if(!(await stat(path.join(output,filename))).isFile() || !bytes.length || bytes.length>500*1024*1024) throw Error('Invalid update installer size.');
  const manifest={schema:'equationlab.update.v1',version,build:Number(build),architecture:'arm64',minimumMacOS,filename,size:bytes.length,
    sha256:createHash('sha256').update(bytes).digest('hex'),url:`https://github.com/Ne1ther/EquationLab/releases/download/v${version}/${filename}`,notesZH:notes.zh,notesEN:notes.en};
  const payload=Buffer.from(JSON.stringify(manifest));
  const signature=sign(null,payload,privateKey);
  if(!verify(null,payload,createPublicKey(privateKey),signature))throw Error('Update signature self-check failed.');
  await writeFile(path.join(output,'EquationLab-update.json'),JSON.stringify({schema:'equationlab.signed-update.v1',payload:payload.toString('base64'),signature:signature.toString('base64')},null,2)+'\n');
  await writeFile(path.join(output,'SHA256SUMS.txt'),`${manifest.sha256}  ${filename}\n`);
  return {file:'EquationLab-update.json',algorithm:'Ed25519',packageSha256:manifest.sha256,publicKey};
}
