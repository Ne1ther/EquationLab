import test from 'node:test';
import assert from 'node:assert/strict';
import {desktopRequest} from '../src/desktop-rpc.mjs';

test('wordWorkspaceStatus uses the native workspace status endpoint with its strict empty body',async()=>{
 const originalFetch=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{
  calls.push({url,options});
  return {ok:true,json:async()=>({connected:true,revision:7,active:{identity:'word-process:73',name:'draft.docx'},retiredIdentities:[]})};
 };
 try{
  const result=await desktopRequest({action:'wordWorkspaceStatus',payload:{}});
  assert.deepEqual(result,{connected:true,revision:7,active:{identity:'word-process:73',name:'draft.docx'},retiredIdentities:[]});
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'http://127.0.0.1:37952/api/native-document-workspace-status');
  assert.deepEqual(JSON.parse(calls[0].options.body),{});
 }finally{globalThis.fetch=originalFetch;}
});
