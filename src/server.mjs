import http from 'node:http';
import https from 'node:https';
import {readFile,appendFile,mkdir} from 'node:fs/promises';
import {extname,join} from 'node:path';
import {homedir} from 'node:os';
import {isMainModule} from './cli-entry.mjs';
import {APP_VERSION} from './version.mjs';

export async function operation(path,body) {
 const {createDocx,inspectDocx,editDocx,replaceDocxEquation,arrangeDocx,referenceDocx,chapterDocx,numberDocx,flatOpc,fromFlatOpc,hash}=await import('./document.mjs');
 const {equationNumberTargets,equationNumberingContext}=await import('./word-numbering.mjs');
 const {inspectOle,oleLatex,editCharacters,replaceOleLatex}=await import('./native.mjs');
 const {makeNewOle,factoryTypography,MATHTYPE_FACTORY_SOURCE}=await import('./new-formula.mjs');
 const {compareSelection}=await import('./selection.mjs');
 const {patchTypography,TYPOGRAPHY_SPACES,TYPOGRAPHY_EXTRA_SIZES}=await import('./typography-native.mjs');
 const {renderNative}=await import('./font-renderer.mjs');
 const {readEqp,writeEqp}=await import('./eqp.mjs');
 const {nativeSessionOperation}=await import('./word-native-session.mjs');
 if(['ribbon-create','ribbon-number','ribbon-chapter'].includes(path)){
  const {mode,...numberOptions}=body.layout??{};
  const docx=path==='ribbon-number'?await numberDocx(numberOptions):path==='ribbon-chapter'?await chapterDocx({chapter:numberOptions.chapter,section:numberOptions.section,resetEquation:false}):await createDocx([{latex:'x',layout:body.layout}],{fragment:true,initializeContext:false});
  return {docx:docx.toString('base64'),ooxml:await flatOpc(docx)};
 }
 if(path.startsWith('native-'))return nativeSessionOperation(path,body);
 if(path==='eqp-import')return readEqp(body.text);
 if(path==='eqp-export')return {text:writeEqp(body.typography,body.originalText)};
 if(path==='compare-selection')return compareSelection(body.original,body.current);
 if(path==='typography-default')return factoryTypography();
 if(path==='typography-descriptors')return {spaces:TYPOGRAPHY_SPACES,extraSizes:TYPOGRAPHY_EXTRA_SIZES,eqpUnits:['pt','%'],factorySource:MATHTYPE_FACTORY_SOURCE,spacingPreview:'30 项间距已保存在原生数据中，当前预览尚未全部采用这些设置。'};
 if(path==='validate'){const ole=makeNewOle(body.latex,body.typography);return {latex:oleLatex(ole),nativeBytes:inspectOle(ole).native.length,nativeSha256:hash(inspectOle(ole).native),svg:(await renderNative(ole,{raster:false})).svg};}
 if(path==='typography-preview'){const {objects}=await inspectDocx(await fromFlatOpc(body.ooxml));if(objects.length!==1)throw Error('请选择一个原生公式');const updated=body.mode==='characters'?editCharacters(objects[0].ole,body.replacements):replaceOleLatex(objects[0].ole,body.latex),ole=body.typography?patchTypography(updated,body.typography):updated;const p=await renderNative(ole,{raster:false});return {svg:p.svg,faces:p.faces};}
 if(path==='create')return {ooxml:await flatOpc(await createDocx([{latex:body.latex,layout:body.layout,typography:body.typography}],{fragment:true,initializeContext:body.initializeContext??false}))};
 if(path==='reference')return {ooxml:await flatOpc(await referenceDocx(body.bookmarkName,{cachedText:body.cachedText,prefix:body.prefix??'式 '}))};
 if(path==='chapter')return {ooxml:await flatOpc(await chapterDocx(body))};
 if(path==='number')return {ooxml:await flatOpc(await numberDocx(body.layout,body.initializeContext===true))};
 if(['inspect-selection','edit-selection','arrange-selection'].includes(path)) {
  const docx=await fromFlatOpc(body.ooxml),r=await inspectDocx(docx);
  if(path==='inspect-selection')return {objects:r.objects.map(({ole,element,shape,image,partDoc,rels,...x})=>x),numberTargets:equationNumberTargets(r.doc),numberingContext:equationNumberingContext(r.doc)};
  if(path==='arrange-selection')return {ooxml:await flatOpc(await arrangeDocx(docx,{indices:body.indices,layout:body.layout}))};
  if(r.objects.length!==1)throw Error('请只选中一个原生公式');
  const changed=body.mode==='characters'?await editDocx(docx,0,body.replacements,{typography:body.typography}):await replaceDocxEquation(docx,0,body.latex,{typography:body.typography});
  return {ooxml:await flatOpc(changed)};
 }
 throw Error('未知操作');
}

const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.woff2':'font/woff2','.woff':'font/woff','.otf':'font/otf'};
export function localServer({port=37951,tls}={}) {
 let server;
 const trace=event=>{
  if(process.env.EQUATIONLAB_HOST_TRACE!=='1')return;
  const logs=join(process.env.EQUATIONLAB_DATA_DIR||join(homedir(),'Library/Application Support/Equation Lab'),'logs');
  mkdir(logs,{recursive:true,mode:0o700}).then(()=>appendFile(join(logs,'word-host-network.ndjson'),JSON.stringify({time:new Date().toISOString(),...event})+'\n',{mode:0o600})).catch(()=>{});
 };
 const handler=async(req,res)=>{
  try {
   const currentPort=server.address()?.port??port,origin=`${tls?'https':'http'}://localhost:${currentPort}`;
   if(![`localhost:${currentPort}`,`127.0.0.1:${currentPort}`].includes(req.headers.host)){res.writeHead(403);return res.end();}
   if(req.method==='POST') {
    if(req.headers.origin&&req.headers.origin!==origin){res.writeHead(403);return res.end('Origin rejected');}
    if(!req.headers['content-type']?.startsWith('application/json'))throw Error('JSON required');
    const nativeRequest=/^\/api\/native-(open|read|poll|complete|cancel|ack|status)$/.test(req.url);
    if(nativeRequest&&(tls||currentPort!==37952))throw Error('原生编辑服务只在本机 37952 端口提供');
    const limit=nativeRequest?48_000_000:30_000_000;
    let chunks=[],size=0;for await(const c of req){size+=c.length;if(size>limit)throw Error('请求过大');chunks.push(c);}
    const body=JSON.parse(Buffer.concat(chunks).toString());let result;
    if(req.url==='/api/event'){
     const {stage,host,platform,message}=body;
     trace({stage,host,platform,message:typeof message==='string'?message.slice(0,512):undefined});result={ok:true};
    }else result=await operation(req.url.replace(/^\/api\//,''),body);
    if(nativeRequest)trace({stage:'native',operation:req.url,state:result.state||'opened'});
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify(result));
   }
   if(req.method!=='GET'){res.writeHead(405);return res.end();}
   const pathname=new URL(req.url,origin).pathname;
   if(pathname==='/taskpane.html'||pathname==='/taskpane.js'||pathname==='/')trace({stage:'http',pathname,userAgent:req.headers['user-agent']});
   if(pathname==='/api/health'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({app:'Equation Lab',version:APP_VERSION,tls:!!tls}));}
   const files={'/':'addin/taskpane.html','/taskpane.html':'addin/taskpane.html','/taskpane.js':'addin/taskpane.js','/taskpane.css':'addin/taskpane.css','/commands.html':'addin/commands.html','/commands.js':'addin/commands.js','/command-registry.js':'addin/command-registry.js','/word-actions.js':'addin/word-actions.js','/vendor/mathlive.min.js':'node_modules/mathlive/mathlive.min.js'};
   const file=files[pathname]||(/^\/icons\/(editor|document|layout|inline|display|number-right|number-left|edit|symbols|number|reference|refresh|chapter|previous|next|typography|spacing|export|help)-(16|32|80)\.png$/.test(pathname)?'addin'+pathname:null)||(/^\/vendor\/fonts\/[A-Za-z0-9_-]+\.(woff2?|otf)$/.test(pathname)?'node_modules/mathlive/fonts/'+pathname.split('/').at(-1):null);
   if(!file){res.writeHead(404);return res.end();}
   res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
   res.end(await readFile(new URL('../'+file,import.meta.url)));
  }catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
 };
 server=tls?https.createServer(tls,handler):http.createServer(handler);
 if(tls)server.on('tlsClientError',error=>trace({stage:'tls-error',code:error.code,message:error.message}));
 return server;
}

if(await isMainModule(import.meta.url)) {
 const port=Number(process.env.MATHTYPE_BRIDGE_PORT||37951);
 const tls=process.env.EQUATIONLAB_TLS_CERT&&process.env.EQUATIONLAB_TLS_KEY?{cert:await readFile(process.env.EQUATIONLAB_TLS_CERT),key:await readFile(process.env.EQUATIONLAB_TLS_KEY)}:undefined;
 localServer({port,tls}).listen(port,'127.0.0.1',()=>console.log(`Equation Lab local server: ${tls?'https':'http'}://localhost:${port}`));
}
