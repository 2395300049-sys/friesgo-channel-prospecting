import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {request as httpRequest} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {deflateRawSync} from 'node:zlib';
function wordFixture(xml,method=8){
  const name=Buffer.from('word/document.xml'),raw=Buffer.from(xml),body=method===8?deflateRawSync(raw):raw;
  const local=Buffer.alloc(30+name.length);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(method,8);local.writeUInt32LE(body.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);name.copy(local,30);
  const central=Buffer.alloc(46+name.length);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(method,10);central.writeUInt32LE(body.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);name.copy(central,46);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(local.length+body.length,16);return Buffer.concat([local,body,central,end]);
}
const doc=body=>'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'</w:body></w:document>';
const p=text=>'<w:p><w:r><w:t>'+text+'</w:t></w:r></w:p>';
const table=rows=>'<w:tbl>'+rows.map(row=>'<w:tr>'+row.map(cell=>'<w:tc>'+p(cell)+'</w:tc>').join('')+'</w:tr>').join('')+'</w:tbl>';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('本地工作台与操作历史集成验收',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'friesgo-test-'));
  const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const base=`http://127.0.0.1:${port}`;
  let child,log='';
  async function start(){
    child=spawn(process.execPath,[path.join(root,'local/dist/server.mjs')],{cwd:root,env:{...process.env,FRIESGO_PORT:String(port),FRIESGO_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
    for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{log=(log+chunk).slice(-5000);});
    for(let i=0;i<50;i++){try{if((await fetch(base+'/api/health')).ok)return;}catch{}await delay(100);}throw Error('Test server failed to start: '+log);
  }
  async function stop(){if(child&&child.exitCode===null){const closed=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await closed;}}
  t.after(async()=>{await stop();await rm(dir,{recursive:true,force:true});});
  await start();
  const get=async(path='/api/data')=>{const r=await fetch(base+path);assert.equal(r.status,200);return r.json();};
  const post=async(action,data,status=200)=>{const r=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,data})});const result=await r.json();assert.equal(r.status,status,JSON.stringify(result));return result;};
  const history=async filters=>get('/api/history?'+new URLSearchParams(filters));
  const find=async(kind,id)=>(await get())[kind].find(x=>x.id===id);
  const count=async()=>(await history({})).total;
  const sqlite=fn=>{const db=new DatabaseSync(path.join(dir,'friesgo.sqlite'));try{return fn(db);}finally{db.close();}};
  async function uploadWord(bytes,filename='客户.docx',status=200){const r=await fetch(base+'/api/import/word',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-FriesGo-Filename':encodeURIComponent(filename)},body:bytes});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;}
  let account;
  await t.test('无账号初始化与旧日志兼容',async()=>{
    const d=await get();assert.equal(d.accounts.length,24);assert.equal(d.letters.length,24);assert.equal(d.replies.length,13);account=d.accounts.find(x=>x.id==='C02');
    sqlite(db=>db.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?,?)').run('legacy-fixture','state:C02','update','local-owner','{"revision":1}','2026-10-23T16:00:00.000Z'));
    const h=await history({account_id:'C02'});assert.ok(h.items.some(x=>x.legacy&&x.changes.length===0));assert.equal(await count(),3);
  });
  await t.test('前后快照、无变更保存和版本冲突',async()=>{
    const old=account;account=await post('save_account',{...account,city:'验收城市'});
    const h=await history({account_id:'C02',kind:'account'});const event=h.items[0];assert.equal(event.details.before.city,old.city);assert.equal(event.details.after.city,'验收城市');
    const n=await count();await post('save_account',account);assert.equal(await count(),n);await post('save_account',{...old,city:'过期修改'},409);assert.equal(await count(),n);
  });
  await t.test('事务失败不留下成功历史',async()=>{
    const n=await count();sqlite(db=>db.exec("CREATE TRIGGER fail_fixture BEFORE UPDATE ON records WHEN NEW.key='account:C02' AND json_extract(NEW.data,'$.city')='拒绝写入' BEGIN SELECT RAISE(ABORT,'fixture failure'); END"));
    await post('save_account',{...account,city:'拒绝写入'},500);assert.equal(await count(),n);assert.equal((await find('accounts','C02')).city,'验收城市');sqlite(db=>db.exec('DROP TRIGGER fail_fixture'));
  });
  await t.test('任务完成和采购角色历史',async()=>{
    const task=await post('save_task',{account_id:'C02',title:'核对采购部门',due_date:'2026-10-25'});await post('save_task',{...task,status:'done'});
    const h=await history({account_id:'C02',kind:'task',action:'update'});assert.ok(h.items[0].changes.some(c=>c.before==='open'&&c.after==='done'));
    const project=await post('save_project',{name:'测试项目',links:[{account_id:'C02',role:'总包'},{account_id:'C03',role:'机电'}]});await post('save_project',{...project,links:[{account_id:'C03',role:'机电'}]});assert.equal((await history({account_id:'C02',kind:'project'})).total,2);
  });
  await t.test('复制草稿快照不随签名改变',async()=>{
    const settings=(await get()).settings;const first=await post('save_settings',{...settings,name:'First'});await post('record_copy',{letter_id:(await get()).letters.find(l=>l.account_id==='C02').id});
    await post('save_settings',{...first,name:'Second'});const h=await history({account_id:'C02',action:'copy_letter'});assert.ok(h.items[0].details.after.body.includes('First'));assert.ok(!h.items[0].details.after.body.includes('Second'));
  });
  await t.test('研究导入保留人工字段且不重复记账',async()=>{
    const state=await find('states','C02');await post('save_state',{...state,owner:'Local user',status:'停止联系'});
    const input={batch_id:'test-import',source:'测试导入',accounts:[{id:'C02',name:account.name,country:account.country,writing_fact:'测试研究依据',owner:'不得覆盖',status:'已联系'}]};await post('import_research',input);const n=await count();await post('import_research',input);assert.equal(await count(),n);assert.equal((await find('states','C02')).owner,'Local user');assert.equal((await find('states','C02')).status,'停止联系');
  });
  await t.test('筛选、中文搜索和稳定分页',async()=>{
    assert.ok((await history({q:'测试研究依据'})).total>0);
    const seen=[];let cursor;do{const h=await history({limit:2,...(cursor?{cursor}:{})});seen.push(...h.items.map(x=>x.id));cursor=h.next_cursor;}while(cursor);assert.equal(seen.length,new Set(seen).size);assert.equal(seen.length,await count());
    const dates=await history({from:'2026-10-24',to:'2026-10-24'});assert.ok(dates.items.some(x=>x.id==='legacy-fixture'));assert.equal((await fetch(base+'/api/history?from=2026-02-30')).status,400);
  });
  await t.test('备份、筛选导出和真正的 Word 文件',async()=>{
    const b=await get('/api/backup');assert.equal(b.schema_version,3);assert.ok(b.tables.audit_events.length>0);assert.equal((await get('/api/history/export?account_id=C02&kind=project')).history.length,2);
    const r=await fetch(base+'/api/export');assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/wordprocessingml/);const bytes=new Uint8Array(await r.arrayBuffer());assert.equal(bytes[0],80);assert.equal(bytes[1],75);assert.ok(new TextDecoder().decode(bytes).includes('操作历史'));
  });
  await t.test('只允许本机来源',async()=>{
    assert.equal((await fetch(base+'/api/data',{headers:{Origin:'https://untrusted.example'}})).status,403);const status=await new Promise((resolve,reject)=>{const r=httpRequest(base+'/api/data',{headers:{Host:'untrusted.example'}},response=>{response.resume();resolve(response.statusCode);});r.on('error',reject);r.end();});assert.equal(status,403);
  });
  await t.test('完整进程重启保留资料和历史',async()=>{
    const before=await count();await stop();await start();assert.equal(await count(),before);assert.equal((await find('states','C02')).status,'停止联系');assert.equal((await find('accounts','C02')).city,'验收城市');
  });
  await t.test('Word客户表格识别、实体解码及解析不写入',async()=>{
    const n=await count(),before=await get();
    const parsed=await uploadWord(wordFixture(doc(table([['公司名称','国家','邮箱','官网'],['A &amp; B Ltd','波兰','sales@example.invalid','https://example.invalid/'],['Second Company','越南','','']]))));
    assert.equal(parsed.candidates.length,2);assert.equal(parsed.candidates[0].fields.name,'A & B Ltd');assert.equal(parsed.candidates[0].fields.country,'波兰');assert.ok(!('email' in parsed.candidates[1].fields));assert.equal((await get()).accounts.length,before.accounts.length);assert.equal(await count(),n);
  });
  await t.test('带标签的段落、编号标题和原稿联系表',async()=>{
    const heading='<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>客户 02：Khansaheb Group</w:t><w:br/><w:t>阿联酋 · 项目路径</w:t></w:r></w:p>';
    const body=heading+table([['角色（原稿）','官网/原入口','邮箱（待复核）','电话（待复核）'],['建筑总包','https://khansaheb.com','hello@example.invalid','12345']]);
    const parsed=await uploadWord(wordFixture(doc(body),0));assert.equal(parsed.candidates.length,1);assert.equal(parsed.candidates[0].fields.id,'C02');assert.equal(parsed.candidates[0].fields.email,'hello@example.invalid');assert.equal(parsed.candidates[0].fields.role,'建筑总包');
    const plain=await uploadWord(wordFixture(doc(p('公司名称：New Company')+p('国家：土耳其')+p('官网：https://example.invalid/'))));assert.equal(plain.candidates[0].fields.country,'土耳其');
    const missing=await uploadWord(wordFixture(doc(table([['公司名称','邮箱'],['Country Missing','x@example.invalid']]))));assert.deepEqual(missing.candidates[0].missing,['国家或地区']);
  });
  await t.test('本系统Word识别24家和双语草稿，人工跟进状态不参与录入',async()=>{
    const file=new Uint8Array(await (await fetch(base+'/api/export')).arrayBuffer()),n=await count();
    const parsed=await uploadWord(file,'系统工作册.docx');assert.equal(parsed.candidates.length,24);
    assert.equal(parsed.candidates.filter(c=>c.fields.letter).length,24);
    assert.ok(parsed.candidates.every(c=>!('status' in c.fields)&&!('owner' in c.fields)&&!('next_date' in c.fields)));
    assert.equal(await count(),n);
  });
  await t.test('普通Word可提取参考正文，损坏和旧格式明确拒绝',async()=>{
    const plain=await uploadWord(wordFixture(doc(p('客户提供的现场说明，没有可直接识别的公司字段。'))));assert.equal(plain.candidates.length,0);assert.match(plain.text,/现场说明/);
    await uploadWord(Buffer.from('not a zip'),'旧文档.doc',400);await uploadWord(Buffer.from('not a zip'),'损坏.docx',400);
    await uploadWord(wordFixture('<!DOCTYPE x [<!ENTITY a "unsafe">]>'+doc(p('x'))),'声明.docx',400);
    const invalid=wordFixture(doc(p('too large')));const at=invalid.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));invalid.writeUInt32LE(7*1024*1024,at+24);await uploadWord(invalid,'过大.docx',413);
  });
});
