import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadData,command,AppError} from '../app/store';
import {exportWord} from '../app/word-export';
import {allHistory,readHistory,recordEvent} from '../app/history-store';
import {databasePath,closeDatabase} from './database';
const port=Number(process.env.FRIESGO_PORT||5173);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('本地端口无效');
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'public');
const origins=new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`]);
const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const server=http.createServer(async(req,res)=>{
  const send=(status:number,body:any,type='application/json; charset=utf-8',headers:Record<string,string>={})=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers});res.end(typeof body==='string'||body instanceof Uint8Array?body:JSON.stringify(body));};
  try{
    const origin=`http://${req.headers.host}`;
    if(!origins.has(origin))throw new AppError('只允许本机访问',403);
    if(req.headers.origin&&!origins.has(req.headers.origin)||req.headers['sec-fetch-site']==='cross-site')throw new AppError('请求来源不匹配',403);
    const url=new URL(req.url||'/',origin);
    if(req.method==='GET'&&url.pathname==='/api/health')return send(200,{app:'friesgo-local',mode:'local',version:2,instance:process.env.FRIESGO_INSTANCE||''});
    if(req.method==='GET'&&url.pathname==='/api/data')return send(200,await loadData());
    if(req.method==='GET'&&url.pathname==='/api/history')return send(200,await readHistory(Object.fromEntries(url.searchParams)));
    if(req.method==='GET'&&url.pathname==='/api/history/export'){
      const history=await allHistory(Object.fromEntries(url.searchParams));const bytes=JSON.stringify({exported_at:new Date().toISOString(),history},null,2);
      await recordEvent('export_history','local-owner',{kind:'export',label:'筛选后的操作历史',summary:`导出操作历史 · ${history.length} 条`,filters:Object.fromEntries(url.searchParams)});
      return send(200,bytes,'application/json; charset=utf-8',{'Content-Disposition':'attachment; filename="FriesGo-history.json"'});
    }
    if(req.method==='GET'&&url.pathname==='/api/backup'){
      const data=await loadData(),history=await allHistory();const bytes=JSON.stringify({schema_version:2,exported_at:new Date().toISOString(),...data,history},null,2);
      await recordEvent('export_backup','local-owner',{kind:'export',label:'完整数据备份',summary:`生成 JSON 备份 · ${data.accounts.length} 家客户、${history.length} 条历史`});
      return send(200,bytes,'application/json; charset=utf-8',{'Content-Disposition':'attachment; filename="FriesGo-backup.json"'});
    }
    if(req.method==='GET'&&url.pathname==='/api/export'){
      const data=await loadData(),history=await allHistory();const bytes=exportWord({...data,history});
      await recordEvent('export_word','local-owner',{kind:'export',label:'完整客户工作册',summary:`生成 Word 工作册 · ${data.accounts.length} 家客户、${history.length} 条历史`});
      return send(200,bytes,'application/vnd.openxmlformats-officedocument.wordprocessingml.document',{'Content-Disposition':'attachment; filename="FriesGo-workbook.docx"'});
    }
    if(req.method==='POST'&&url.pathname==='/api/command'){
      if(!req.headers['content-type']?.includes('application/json'))throw new AppError('需要JSON资料',415);
      let size=0;const chunks:Buffer[]=[];
      for await(const part of req){size+=part.length;if(size>1200000)throw new AppError('本批资料过大',413);chunks.push(part);}
      let payload:any;try{payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AppError('JSON格式不正确');}
      if(!payload||typeof payload!=='object')throw new AppError('请求格式不正确');
      return send(200,await command(payload.action,payload.data||{},'local-owner'));
    }
    if(req.method!=='GET'&&req.method!=='HEAD')throw new AppError('接口不存在',404);
    if(url.pathname.startsWith('/api/')||url.pathname==='/mcp'||url.pathname.includes('signin-with-chatgpt'))throw new AppError('接口不存在',404);
    let relative:string;try{relative=decodeURIComponent(url.pathname);}catch{throw new AppError('路径无效');}
    const target=path.resolve(root,'.'+(relative==='/'?'/index.html':relative));
    if(!target.startsWith(root+path.sep))throw new AppError('路径无效',403);
    let bytes:Buffer;try{bytes=await readFile(target);}catch{throw new AppError('页面不存在',404);}
    send(200,req.method==='HEAD'?'':bytes,types[path.extname(target)]||'application/octet-stream',{'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'"});
  }catch(error){send(error instanceof AppError?error.status:500,{error:error instanceof Error?error.message:'操作失败'});}
});
server.listen(port,'127.0.0.1',()=>console.log(`FriesGo 本地工作台：http://127.0.0.1:${port}\n数据库：${databasePath}`));
server.on('error',error=>{console.error(error.message);process.exit(1);});
for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>server.close(()=>{closeDatabase();process.exit(0);}));
