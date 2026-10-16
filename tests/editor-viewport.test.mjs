import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../desktop/editor-viewport.js',import.meta.url),'utf8');
function viewport(){
 let width=100,height=40,font=29,selected=0,mutation;
 const frames=[],events=()=>({handlers:{},addEventListener(name,fn){this.handlers[name]=fn;}});
 const rail={...events(),hidden:true,clientWidth:576,scrollLeft:0,firstElementChild:{style:{}}};
 const content={...events(),clientWidth:600,scrollLeft:0,get scrollWidth(){return Math.max(600,width*font/29);},querySelector:()=>({getBoundingClientRect:()=>({width:width*font/29,height:height*font/29})})};
 const wrap={...events(),clientHeight:250,parentElement:{querySelector:()=>rail}};
 const field={value:'x',closest:()=>wrap,shadowRoot:{querySelector:()=>content},style:{setProperty(_key,value){font=parseFloat(value);}}};
 const context=vm.createContext({window:{},getComputedStyle:()=>({paddingTop:'0',paddingBottom:'0',paddingLeft:'0',paddingRight:'0'}),requestAnimationFrame:fn=>frames.push(fn),ResizeObserver:class{observe(){}},MutationObserver:class{constructor(fn){mutation=fn;}observe(){}},document:{fonts:{ready:Promise.resolve()}}});
 vm.runInContext(source,context);
 const controller=context.window.createEquationViewport(field,{getZoom:()=>selected,onScaleChange(){}});
 function flush(){let count=0;while(frames.length){assert.ok(++count<10,'sizing must settle without a continuous frame loop');frames.shift()();}}
 return {rail,content,controller,field,flush,get zoom(){return controller.effectiveZoom;},render(w,h=40){width=w;height=h;mutation();flush();},select(zoom){selected=zoom;controller.refresh();flush();}};
}

test('Fit sizing responds to MathLive content rendered after the input frame, then restores short formulas',()=>{
 const v=viewport();v.controller.refresh();v.flush();assert.equal(v.zoom,100);
 // The first host input frame saw the old small expression. MathLive's later
 // DOM update must independently trigger a measurement of the new expression.
 v.render(1000);assert.equal(v.zoom,58);assert.equal(v.field.value,'x');
 v.render(100);assert.equal(v.zoom,100);
 v.render(100,500);assert.equal(v.zoom,50,'tall content uses the readable lower bound');
});

test('The frame scrollbar mirrors the formula overflow and caret scrolling in both directions',()=>{
 const v=viewport();v.render(1000);v.select(200);
 assert.equal(v.rail.hidden,false);assert.ok(Math.abs(parseFloat(v.rail.firstElementChild.style.width)-1976)<.01);
 v.rail.scrollLeft=200;v.rail.handlers.scroll();assert.equal(v.content.scrollLeft,200);
 v.content.scrollLeft=500;v.content.handlers.scroll();assert.equal(v.rail.scrollLeft,500);
 v.select(50);assert.equal(v.rail.hidden,true,'no empty scrollbar for content that fits');
});
