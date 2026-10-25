import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {deflateRawSync,crc32} from 'node:zlib';
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function zip(parts){
  const locals=[],centrals=[];let offset=0,size=0;
  for(const [key,text] of Object.entries(parts)){
    const name=Buffer.from(key),raw=Buffer.from(text),body=deflateRawSync(raw),crc=crc32(raw),local=Buffer.alloc(30+name.length),central=Buffer.alloc(46+name.length);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(body.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);name.copy(local,30);
    central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(body.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);name.copy(central,46);
    locals.push(local,body);centrals.push(central);offset+=local.length+body.length;size+=central.length;
  }
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(centrals.length,8);end.writeUInt16LE(centrals.length,10);end.writeUInt32LE(size,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,...centrals,end]);
}
const col=n=>n<26?String.fromCharCode(65+n):'A'+String.fromCharCode(65+n-26);
function fixture(sheets,options={}){
  const names=Object.keys(sheets),parts={
    'xl/workbook.xml':`<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="${options.date1904?1:0}"/><sheets>${names.map((n,i)=>`<sheet name="${escape(n)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':`<Relationships>${names.map((_,i)=>`<Relationship Id="rId${i+1}" Target="worksheets/sheet${i+1}.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>`).join('')}</Relationships>`,
    'xl/sharedStrings.xml':'<sst><si><r><t>Shared </t></r><r><t>&amp; Co</t></r></si></sst>'
  };
  for(const [i,name] of names.entries())parts[`xl/worksheets/sheet${i+1}.xml`]='<worksheet><sheetData>'+sheets[name].map((r,row)=>`<row r="${row+1}">`+r.map((value,j)=>{if(value===null||value==='')return '';const ref=col(j)+(row+1);if(typeof value==='object')return `<c r="${ref}" t="${value.type||'n'}">${value.f?'<f>'+escape(value.f)+'</f>':''}${value.v!==undefined?'<v>'+escape(value.v)+'</v>':''}</c>`;return `<c r="${ref}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`;}).join('')+'</row>').join('')+'</sheetData></worksheet>';
  return options.parts?{...parts,...options.parts}:zip(parts);
}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('Excel导入：解析、业务边界、历史及原子写入',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'friesgo-excel-')),socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
  const base=`http://127.0.0.1:${port}`,child=spawn(process.execPath,[path.join(root,'local/dist/server.mjs')],{cwd:root,env:{...process.env,FRIESGO_PORT:String(port),FRIESGO_DATA_DIR:dir},stdio:'ignore'});
  t.after(async()=>{if(child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await done;}await rm(dir,{recursive:true,force:true});});
  for(let i=0;i<60;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,80));}
  const get=async()=>{const r=await fetch(base+'/api/data');assert.equal(r.status,200);return r.json();};
  const history=async()=>{const r=await fetch(base+'/api/history');return r.json();};
  const post=async(action,data,status=200)=>{const r=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,data})});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;};
  const upload=async(bytes,query={},status=200,name='客户.xlsx')=>{const r=await fetch(base+'/api/import/excel?'+new URLSearchParams(query),{method:'POST',headers:{'X-FriesGo-Filename':encodeURIComponent(name)},body:bytes});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;};
  const sqlite=fn=>{const db=new DatabaseSync(path.join(dir,'friesgo.sqlite'));try{return fn(db);}finally{db.close();}};
  let parsed;
  await t.test('自动选择客户表、稀疏列、共享文字、公式缺值及模板旧稿',async()=>{
    const data=await get(),n=(await history()).total;
    parsed=await upload(fixture({'使用说明':[['请填写客户表']],'客户总表':[['ID','公司','国家','城市','官网','首封计划日','首封实际发送日','当前阶段','邮件版本'],['99',{type:'s',v:0},'波兰',null,'example.invalid',{f:'TODAY()'},null,'未联系','EN-A']],'模板':[['版本','语言','主题(原文)','正文(原文)','主题(中文)','正文(中文)'],['EN-A','EN','For {{公司}}','Hello {{公司}}\\n{{姓名}}','致{{公司}}','你好{{公司}}\\n{{姓名}}']]}));
    assert.equal(parsed.sheet,'客户总表');assert.equal(parsed.candidates.length,1);const c=parsed.candidates[0];assert.equal(c.fields.name,'Shared & Co');assert.equal(c.fields.url,'https://example.invalid/');assert.ok(!c.fields.planned_date);assert.ok(!c.fields.id);assert.equal(c.source.row,2);assert.equal(c.source.original_id,'99');assert.equal(c.fields.letter.body,'Hello Shared & Co\n{{姓名}}');assert.match(c.warnings.join(' '),/F2/);assert.match(c.warnings.join(' '),/候选旧稿/);assert.equal((await get()).accounts.length,data.accounts.length);assert.equal((await history()).total,n);
  });
  await t.test('保存值日期与1904日期系统，不执行公式',async()=>{
    const d=await upload(fixture({'客户总表':[['公司','国家','首封计划日','首封实际发送日','下次动作日期'],['Dates','中国',{type:'n',v:1},{f:'TODAY()',v:2},{type:'d',v:'2026-10-25T00:00:00Z'}]]}));
    assert.equal(d.candidates[0].fields.planned_date,'1900-01-01');assert.equal(d.candidates[0].tracking.sent_on,'1900-01-02');assert.equal(d.candidates[0].tracking.next_date,'2026-10-25');
    const d1904=await upload(fixture({'客户总表':[['公司','国家','首封计划日'],['Dates','中国',{v:0}]]},{date1904:true}));assert.equal(d1904.candidates[0].fields.planned_date,'1904-01-01');
  });
  await t.test('选择工作表、调整表头与列映射',async()=>{
    const bytes=fixture({'客户总表':[['公司','国家'],['Default','中国']],'我的客户':[['客户清单'],['企业名称','所在地'],['Mapped','越南']]});
    const d=await upload(bytes,{sheet:'我的客户',header_row:'2',mapping:JSON.stringify({A:'name',B:'country'})});assert.equal(d.candidates[0].fields.name,'Mapped');assert.equal(d.candidates[0].source.row,3);
    await upload(bytes,{mapping:JSON.stringify({A:'name',B:'name'})},400);
  });
  await t.test('读取单元格官网超链接，不访问链接或执行公式',async()=>{
    const parts=fixture({'客户总表':[['公司','国家','官网'],['Linked Company','波兰','访问官网']]},{parts:{}});
    parts['xl/worksheets/sheet1.xml']=parts['xl/worksheets/sheet1.xml'].replace('</worksheet>','<hyperlinks><hyperlink ref="C2" r:id="site"/></hyperlinks></worksheet>');
    parts['xl/worksheets/_rels/sheet1.xml.rels']='<Relationships><Relationship Id="site" TargetMode="External" Target="https://website.example.invalid/about"/></Relationships>';
    const d=await upload(zip(parts));assert.equal(d.candidates[0].fields.url,'https://website.example.invalid/about');
  });
  await t.test('计划与未联系不变成实际联系；候选稿去重',async()=>{
    const c=parsed.candidates[0],input={batch_id:'excel-first',source:'测试Excel',include_tracking:true,accounts:[{...c.fields,tracking:c.tracking,source:c.source}]};
    const n=(await get()).activities.length;const result=await post('import_excel',input);assert.equal(result.added,1);assert.equal(result.letters,1);assert.equal(result.activities,0);assert.equal((await get()).activities.length,n);
    const after=await get(),a=after.accounts.find(a=>a.name===c.fields.name);assert.equal(after.states.find(s=>s.account_id===a.id).status,'未联系');assert.equal((await post('import_excel',input)).replayed,true);
    await post('import_excel',{...input,batch_id:'excel-copy'});assert.equal((await get()).letters.filter(l=>l.account_id===a.id).length,1);
  });
  await t.test('保留已有安排，真实日期与无日期回复分别迁入',async()=>{
    const data=await get(),a=data.accounts.find(a=>a.id==='C02'),s=data.states.find(s=>s.id==='C02');await post('save_state',{...s,status:'停止联系',owner:'Owner',next_action:'保留安排',next_date:'2026-11-10'});
    const c=(await upload(fixture({'客户总表':[['公司','国家','首封实际发送日','客户回复摘要','当前阶段','下次动作','下次动作日期','对口联系人姓名','职位','联系人邮箱/WhatsApp'],[a.name,a.country,'2026-10-20','请联系采购部','已联系','旧表安排','2026-11-01','Example Person','Engineer','person@example.invalid']]}))).candidates[0];
    assert.equal(c.fields.id,a.id);const input={batch_id:'excel-history',include_tracking:true,accounts:[{...c.fields,tracking:c.tracking,source:c.source}]};const result=await post('import_excel',input);assert.equal(result.contacts,1);assert.equal(result.activities,2);const after=await get();assert.equal(after.states.find(s=>s.id===a.id).status,'停止联系');assert.equal(after.states.find(s=>s.id===a.id).next_action,'保留安排');
    const acts=after.activities.filter(x=>x.account_id===a.id);assert.equal(acts.find(x=>x.kind==='outreach').occurred_on,'2026-10-20');assert.equal(acts.find(x=>x.kind==='outreach').letter_snapshot,null);assert.equal(acts.find(x=>x.kind==='note').occurred_on,'');assert.equal(acts.find(x=>x.kind==='note').imported_undated,true);assert.equal(acts.filter(x=>x.kind==='reply').length,0);
    await post('import_excel',{...input,batch_id:'excel-history-copy'});assert.equal((await get()).activities.filter(x=>x.account_id===a.id).length,2);assert.equal((await get()).contacts.filter(x=>x.account_id===a.id).length,1);
    const events=(await history()).items.filter(e=>e.action==='excel_import');assert.ok(events.some(e=>e.details.source_rows[0].source.row==='2'));
  });
  await t.test('明确选择迁入安排，空值保留；关闭历史迁入',async()=>{
    const d=await get(),a=d.accounts.find(a=>a.id==='C02');const input={batch_id:'excel-state',apply_state:true,include_tracking:false,accounts:[{id:a.id,name:a.name,country:a.country,tracking:{status:'已联系',next_action:'核实原表安排',owner:'',reply_summary:'不迁入这条回复'}}]};
    const p=await post('preview_excel_import',input);assert.ok(p.changes[0].state_changes.some(c=>c.field==='status'));assert.equal(p.changes[0].after_state.owner,'Owner');await post('import_excel',input);const after=await get();assert.equal(after.states.find(s=>s.id===a.id).status,'已联系');assert.equal(after.states.find(s=>s.id===a.id).owner,'Owner');assert.equal(after.activities.filter(x=>x.account_id===a.id).length,2);
    const fresh=await post('import_excel',{batch_id:'excel-new-state',apply_state:true,accounts:[{name:'New with state',country:'波兰',tracking:{status:'待资料',next_action:'补资料',next_date:'2026-11-01'}}]});assert.equal(fresh.added,1);const n=(await get()).accounts.find(a=>a.name==='New with state');assert.equal((await get()).states.find(s=>s.id===n.id).status,'待资料');
    const second=await post('import_excel',{batch_id:'excel-same-name-no-domain',accounts:[{name:'New with state',country:'波兰'}]});assert.equal(second.added,0);assert.equal((await get()).accounts.filter(a=>a.name==='New with state').length,1);
    await post('preview_excel_import',{accounts:[{name:'Duplicate',country:'波兰'},{name:'Duplicate',country:'波兰'}]},400);
  });
  await t.test('预览后修改需重新检查、未知阶段不升级、未来实际日期拒绝',async()=>{
    const d=await get(),a=d.accounts.find(a=>a.id==='C02'),s=d.states.find(s=>s.id==='C02');const item={id:a.id,name:a.name,country:a.country,tracking:{status:'有意向'}};
    const p=await post('preview_excel_import',{accounts:[item],apply_state:true});assert.equal(p.changes[0].after_state.status,s.status);assert.ok(p.changes[0].warnings.length);
    await post('save_state',{...s,owner:'Changed after preview'});await post('import_excel',{accounts:[{...item,expected:{account:a._revision,state:s._revision}}]},409);
    await post('preview_excel_import',{accounts:[{...item,tracking:{sent_on:'2999-01-01'}}]},400);
  });
  await t.test('同批写入失败回滚客户、信件、联系人、历史及批次',async()=>{
    const before=await get(),h=(await history()).total;sqlite(db=>db.exec("CREATE TRIGGER fail_excel BEFORE INSERT ON records WHEN json_extract(NEW.data,'$.name')='Blocked Excel' BEGIN SELECT RAISE(ABORT,'test rollback'); END"));
    await post('import_excel',{batch_id:'excel-rollback',include_tracking:true,accounts:[{name:'Rollback First',country:'中国',tracking:{contact_name:'Rollback Contact',sent_on:'2026-10-20'}},{name:'Blocked Excel',country:'中国'}]},500);
    assert.equal((await get()).accounts.length,before.accounts.length);assert.equal((await get()).contacts.length,before.contacts.length);assert.equal((await history()).total,h);assert.ok(!(await get()).imports.find(b=>b.id==='excel-rollback'));sqlite(db=>db.exec('DROP TRIGGER fail_excel'));
  });
  await t.test('损坏、旧格式、超限、XML声明及外部工作表明确拒绝',async()=>{
    await upload(Buffer.from('not zip'),{},400,'旧.xls');await upload(Buffer.from('not zip'),{},400);
    const bytes=fixture({'客户总表':[['公司','国家'],['Safe','中国']]});const broken=Buffer.from(bytes),at=broken.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));broken.writeUInt32LE(7*1024*1024,at+24);await upload(broken,{},413);
    const badCrc=Buffer.from(bytes);badCrc.writeUInt32LE(0,at+16);await upload(badCrc,{},400);
    await upload(zip(fixture({'客户总表':[['公司','国家']]},{parts:{'xl/sharedStrings.xml':'<!DOCTYPE x [<!ENTITY a "unsafe">]><sst/>'}})),{},400);
    await upload(zip(fixture({'客户总表':[['公司','国家']]},{parts:{'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" TargetMode="External" Target="https://example.invalid"/></Relationships>'}})),{},400);
  });
});
