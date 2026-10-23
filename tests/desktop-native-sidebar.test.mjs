import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('../desktop/app.js',import.meta.url),'utf8');
const functions=['renderObjects','renderFavorites','syncSidebar'].map(name=>app.split('\n').find(line=>line.startsWith('function '+name+'('))).join('\n');
test('Native sidebar publication builds no hidden DOM and preserves the Word acknowledgement boundary',async()=>{
 let resolve,settled=false;const calls=[];
 const context=vm.createContext({window:{},wordTicket:'ticket',wordNavigating:false,source:{insertion:false},requestWorkbenchSync(){calls.push('workbench');},native:async(action,payload)=>{calls.push({action,payload});await new Promise(done=>{resolve=done;});},document:{createElement(){throw Error('Hidden sidebar must not build DOM');}},$(){throw Error('Hidden sidebar must not access DOM');}});
 vm.runInContext(functions,context);const pending=context.renderObjects().then(()=>{settled=true;});await Promise.resolve();assert.equal(settled,false);resolve();await pending;assert.equal(settled,true);
 const state=calls.find(x=>x.action==='state').payload;assert.equal(state.wordTicket,'ticket');assert.equal(state.wordSession,true);assert.equal(Object.hasOwn(state,'objects'),false);assert.equal(Object.hasOwn(state,'favorites'),false);
});
test('The WebKit document no longer contains a second sidebar',async()=>{
 const html=await readFile(new URL('../desktop/index.html',import.meta.url),'utf8');assert.doesNotMatch(html,/<aside\b|id="(?:objects|favorites|nav-new|nav-open)"/);assert.match(html,/id="add-favorite"/);
});
