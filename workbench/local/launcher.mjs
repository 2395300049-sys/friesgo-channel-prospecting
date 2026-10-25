import {spawn} from 'node:child_process';
import {mkdirSync,openSync,closeSync,readFileSync,writeFileSync,existsSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const root=path.dirname(fileURLToPath(import.meta.url));
const data=process.env.FRIESGO_DATA_DIR||path.resolve(root,'../../data');mkdirSync(data,{recursive:true,mode:0o700});
const stateFile=path.join(data,'service.json'),logFile=path.join(data,'service.log');
const port=5173,url=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function health(){try{const res=await fetch(url+'/api/health',{signal:AbortSignal.timeout(800)});return await res.json();}catch{return null;}}
function state(){try{return JSON.parse(readFileSync(stateFile,'utf8'));}catch{return null;}}
const action=process.argv[2]||'start';
if(action==='stop'){
  const s=state(),h=await health();
  if(!s||h?.app!=='friesgo-local'||h.instance!==s.instance){console.log('本地工作台没有运行，或端口由其他程序使用。');process.exit(0);}
  process.kill(s.pid,'SIGTERM');
  for(let i=0;i<30;i++){if(!(await health())){unlinkSync(stateFile);console.log('已停止；客户资料保留在 data 文件夹。');process.exit(0);}await sleep(100);}
  throw Error('服务仍在退出，请稍后重试。');
}
if(action!=='start')throw Error('只支持 start 或 stop');
const existing=await health(),saved=state();
if(existing&&!(existing.app==='friesgo-local'&&existing.instance===saved?.instance))throw Error('5173端口已被其他服务占用，请先关闭它。');
if(!existing){
  const instance=randomUUID(),fd=openSync(logFile,'a',0o600);
  const child=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,env:{...process.env,FRIESGO_DATA_DIR:data,FRIESGO_PORT:String(port),FRIESGO_INSTANCE:instance},detached:true,stdio:['ignore',fd,fd]});
  closeSync(fd);child.unref();
  let ready=false;
  for(let i=0;i<50;i++){const h=await health();if(h?.app==='friesgo-local'&&h.instance===instance){ready=true;break;}await sleep(100);}
  if(!ready)throw Error('启动失败，请查看 data/service.log。');
  writeFileSync(stateFile,JSON.stringify({pid:child.pid,instance,url}),{mode:0o600});
}
console.log(`FriesGo 本地工作台已运行：${url}\n数据库：${path.join(data,'friesgo.sqlite')}`);
if(process.platform==='darwin'&&!process.argv.includes('--no-open'))spawn('open',[url],{stdio:'ignore'}).unref();
