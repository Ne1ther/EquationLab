import http from 'node:http';
import {appendFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {isMainModule} from './cli-entry.mjs';
import {APP_VERSION} from './version.mjs';
import {wordDocumentRequests} from './word-document-requests.mjs';

export async function operation(path,body) {
 if(path.startsWith('native-document-'))return wordDocumentRequests.handle(path,body);
 const {createDocx,chapterDocx,numberDocx,flatOpc}=await import('./document.mjs');
 const {nativeSessionOperation}=await import('./word-native-session.mjs');
 if(['ribbon-create','ribbon-number','ribbon-chapter'].includes(path)){
  const {mode,...numberOptions}=body.layout??{};
  const docx=path==='ribbon-number'?await numberDocx({...numberOptions,numberingFamily:'mathtype'}):path==='ribbon-chapter'?await chapterDocx({chapter:numberOptions.chapter,section:numberOptions.section,resetEquation:false,numberingFamily:'mathtype'}):await createDocx([{latex:'x',layout:body.layout}],{fragment:true,initializeContext:false,numberingFamily:'mathtype'});
  return {docx:docx.toString('base64'),ooxml:await flatOpc(docx)};
 }
 if(path.startsWith('native-'))return nativeSessionOperation(path,body);
 throw Error('未知操作');
}

export function localServer({port=37952}={}) {
 let server;
 const trace=event=>{
  if(process.env.EQUATIONLAB_HOST_TRACE!=='1')return;
  const logs=join(process.env.EQUATIONLAB_DATA_DIR||join(homedir(),'Library/Application Support/Equation Lab'),'logs');
  mkdir(logs,{recursive:true,mode:0o700}).then(()=>appendFile(join(logs,'word-host-network.ndjson'),JSON.stringify({time:new Date().toISOString(),...event})+'\n',{mode:0o600})).catch(()=>{});
 };
 const handler=async(req,res)=>{
  try {
   const currentPort=server.address()?.port??port,origin=`http://localhost:${currentPort}`;
   if(![`localhost:${currentPort}`,`127.0.0.1:${currentPort}`].includes(req.headers.host)){res.writeHead(403);return res.end();}
   if(req.method==='POST') {
    if(req.headers.origin&&req.headers.origin!==origin){res.writeHead(403);return res.end('Origin rejected');}
    if(!req.headers['content-type']?.startsWith('application/json'))throw Error('JSON required');
    const nativeRequest=/^\/api\/native-(open|insert-open|read|poll|complete|cancel|ack|status|navigate|enrich|enrich-request|document-request|document-status|document-take|document-finish|document-cancel|document-workspace|document-workspace-status)$/.test(req.url);
    const ribbonRequest=/^\/api\/ribbon-(create|number|chapter)$/.test(req.url);
    if(!nativeRequest&&!ribbonRequest){res.writeHead(404);return res.end();}
    if(currentPort!==37952)throw Error('原生 Word 服务只在本机 37952 端口提供');
    const limit=nativeRequest?48_000_000:30_000_000;
    let chunks=[],size=0;for await(const c of req){size+=c.length;if(size>limit)throw Error('请求过大');chunks.push(c);}
    const body=JSON.parse(Buffer.concat(chunks).toString()),result=await operation(req.url.replace(/^\/api\//,''),body);
    trace({stage:nativeRequest?'native':'ribbon',operation:req.url,state:result.state||'opened'});
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify(result));
   }
   if(req.method!=='GET'){res.writeHead(405);return res.end();}
   const pathname=new URL(req.url,origin).pathname;
   if(pathname==='/api/health'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify({app:'Equation Lab',version:APP_VERSION}));}
   res.writeHead(404);return res.end();
  }catch(e){res.writeHead(e.statusCode||400,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:e.message}));}
 };
 server=http.createServer(handler);
 return server;
}

if(await isMainModule(import.meta.url)) {
 const port=Number(process.env.EQUATIONLAB_NATIVE_PORT||37952);
 localServer({port}).listen(port,'127.0.0.1',()=>console.log(`Equation Lab native Word service: http://localhost:${port}`));
}
