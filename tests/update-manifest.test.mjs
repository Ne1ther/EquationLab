import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {generateKeyPairSync,createHash,sign,verify} from 'node:crypto';
import {writeUpdateManifest} from '../packaging/update-manifest.mjs';

test('Published update binds package bytes, version, bilingual notes and pinned signing key',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'equationlab-update-test-'));
 try {
  await fs.mkdir(path.join(root,'updater'));await fs.mkdir(path.join(root,'packaging'));
  const {privateKey,publicKey}=generateKeyPairSync('ed25519'),pub=Buffer.from(publicKey.export({format:'jwk'}).x,'base64url').toString('base64');
  const keyFile=path.join(root,'private.pem');await fs.writeFile(keyFile,privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
  await fs.writeFile(path.join(root,'updater/UpdateTrust.swift'),`public static let publicKey = "${pub}"`);
  await fs.writeFile(path.join(root,'packaging/update-notes.json'),JSON.stringify({version:'0.5.8',zh:'更新',en:'Update'}));
  const packageFile='Equation-Lab-0.5.8.pkg',bytes=Buffer.from('installer');await fs.writeFile(path.join(root,packageFile),bytes);
  const args={root,output:root,packageFile,version:'0.5.8',build:'41',minimumMacOS:'14.0',privateKeyFile:keyFile};
  await writeUpdateManifest(args);
  const envelope=JSON.parse(await fs.readFile(path.join(root,'EquationLab-update.json'),'utf8')),payload=Buffer.from(envelope.payload,'base64');
  assert.ok(verify(null,payload,publicKey,Buffer.from(envelope.signature,'base64')));
  const manifest=JSON.parse(payload);assert.equal(manifest.size,bytes.length);assert.equal(manifest.build,41);assert.equal(manifest.notesZH,'更新');
  assert.equal(manifest.sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.ok(!(await fs.readFile(path.join(root,'EquationLab-update.json'),'utf8')).includes('PRIVATE KEY'));
  assert.equal(await fs.readFile(path.join(root,'SHA256SUMS.txt'),'utf8'),`${manifest.sha256}  ${packageFile}\n`);
  assert.ok(!verify(null,Buffer.concat([payload,Buffer.from('tampered')]),publicKey,Buffer.from(envelope.signature,'base64')));
  await assert.rejects(writeUpdateManifest({...args,privateKeyFile:undefined}),/PRIVATE_KEY/);
  const wrong=generateKeyPairSync('ed25519').privateKey;await fs.writeFile(keyFile,wrong.export({type:'pkcs8',format:'pem'}));
  await assert.rejects(writeUpdateManifest(args),/does not match/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
