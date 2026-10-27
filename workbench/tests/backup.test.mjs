import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

// Every database and record below is synthetic and lives in a temporary directory.
// This test never reads the operator's database, imports, research or backups.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const plain=value=>JSON.parse(JSON.stringify(value));
const nextDay=()=>new Date(Date.now()+2*86400000).toISOString().slice(0,10);
const ordered=tables=>Object.fromEntries(['records','audit_events','import_batches'].map(table=>[
  table,plain(tables[table]).sort((a,b)=>{
    const key=table==='records'?'key':'id';
    return a[key]<b[key]?-1:a[key]>b[key]?1:0;
  })
]));

async function serverFixture(t,label){
  const dir=await mkdtemp(path.join(tmpdir(),'friesgo-backup-'+label+'-'));
  const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
  const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const base=`http://127.0.0.1:${port}`;
  let child,log='';
  async function start(){
    child=spawn(process.execPath,[path.join(root,'local/dist/server.mjs')],{
      cwd:root,env:{...process.env,FRIESGO_PORT:String(port),FRIESGO_DATA_DIR:dir},stdio:['ignore','pipe','pipe']
    });
    for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{log=(log+chunk).slice(-5000);});
    for(let i=0;i<70;i++){
      try{if((await fetch(base+'/api/health')).ok)return;}catch{}
      await delay(80);
    }
    throw Error('Backup fixture server failed to start: '+log);
  }
  async function stop(){
    if(child&&child.exitCode===null){const closed=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await closed;}
  }
  const sqlite=fn=>{
    const db=new DatabaseSync(path.join(dir,'friesgo.sqlite'));
    try{return fn(db);}finally{db.close();}
  };
  const raw=()=>sqlite(db=>ordered({
    records:db.prepare('SELECT key,kind,data,revision,updated_at FROM records ORDER BY key').all(),
    audit_events:db.prepare('SELECT id,entity_key,action,actor,details,created_at FROM audit_events ORDER BY id').all(),
    import_batches:db.prepare('SELECT id,hash,summary,created_at FROM import_batches ORDER BY id').all()
  }));
  async function get(url='/api/data'){
    const response=await fetch(base+url),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;
  }
  async function post(url,body,status=200){
    const response=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));return result;
  }
  const command=(action,data,status=200)=>post('/api/command',{action,data},status);
  const preview=backup=>post('/api/backup/preview',backup);
  const restore=(backup,expected,status=200)=>post('/api/backup/restore',{backup,expected},status);
  t.after(async()=>{await stop();await rm(dir,{recursive:true,force:true});});
  await start();await get();
  return {get,post,command,preview,restore,sqlite,raw,start,stop};
}

async function populate(source){
  const input={country_code:'ZZ',country_name:'合成迁移测试国',batch_id:'synthetic-backup-country',portfolio:{
    date:'2025-06-10',
    accounts:[
      {id:'A1',name:'Synthetic Migration Supply',city:'合成城市甲',website:'https://migration-a.example.invalid/',email:'sales@migration-a.example.invalid',grade:'B',source_urls:['https://migration-a.example.invalid/contact'],fit_fact:'仅为迁移合成数据',custom_marker:{text:'原始扩展字段完整保留',nested:[1,{value:'未经格式化的来源值'}]}},
      {id:'A2',name:'Synthetic Migration Engineering',city:'合成城市乙',website:'https://migration-b.example.invalid/',grade:'C'}
    ],
    utilities:[{id:'R1',name:'Synthetic Regional Route',city:'合成城市甲',website:'https://route.example.invalid/',source_urls:['https://route.example.invalid/']}],
    projects:[{id:'P1',name:'Synthetic Hydronic Project',links:[{account_id:'A1',role:'合成业主'},{account_id:'A2',role:'合成工程商'}],source_url:'https://project.example.invalid/',stage:'历史工程；无当前RFQ',verified_on:'2025-06-10'}],
    coverage:[{city:'合成城市甲',search_status:'合成测试，不是真实市场覆盖'}],
    customs:{signals:[],limitations:['仅作迁移完整性测试']},methods:[{method:'合成来源'}],qa:{synthetic:true}
  }};
  const preview=await source.command('preview_country_import',input);
  await source.command('import_country_research',{...input,expected:preview.expected});
  const find=async(kind,id)=>(await source.get())[kind].find(x=>x.id===id);
  const account=await find('accounts','ZZ-A1');
  await source.command('save_account',{...account,city:'合成人工核对城市'});
  await source.command('save_settings',{...(await source.get()).settings,name:'Synthetic Operator',email:'operator@example.invalid',website:'https://supplier.example.invalid/'});
  await source.command('save_contact',{account_id:'ZZ-A1',name:'Synthetic Engineering Department',email:'engineer@migration-a.example.invalid',verified_on:'2025-06-10',source_url:'https://migration-a.example.invalid/contact'});
  const firstLetter=await source.command('save_letter',{account_id:'ZZ-A1',language:'EN',subject:'Synthetic saved version',body:'Synthetic letter from {{姓名}}.',cnsubject:'合成历史草稿',cn:'来自{{姓名}}的合成草稿。'});
  await source.command('save_letter',{account_id:'ZZ-A2',language:'EN',subject:'Other synthetic version',body:'Other account draft.',cnsubject:'另一合成草稿',cn:'另一账户草稿。'});
  await source.command('save_activity',{account_id:'ZZ-A1',kind:'outreach',channel:'合成测试渠道',summary:'合成的历史登记，不代表真实发送。',occurred_on:'2025-06-10',letter_id:firstLetter.id});
  await source.command('save_interest',{...(await find('states','ZZ-A1')),interest_note:'合成意向摘要；含逐行原文\n第二行保持',next_action:'合成下一步安排',next_date:nextDay()});
  await source.command('save_state',{...(await find('states','ZZ-A1')),status:'停止联系',owner:'Synthetic Owner',next_action:'合成停止联系后的内部保留安排',next_date:nextDay()});
  await source.command('save_task',{account_id:'ZZ-A2',title:'合成未完成任务',due_date:nextDay()});
  // More than the UI's 30 recent batches, and enough payload to exceed the old
  // command endpoint's 1.2MB limit without embedding private data in this test.
  source.sqlite(db=>{
    const batch=db.prepare('INSERT INTO import_batches(id,hash,summary,created_at) VALUES(?,?,?,?)');
    const audit=db.prepare('INSERT INTO audit_events(id,entity_key,action,actor,details,created_at) VALUES(?,?,?,?,?,?)');
    for(let i=0;i<35;i++){
      const suffix=String(i).padStart(2,'0'),timestamp=`2025-05-${String(i%28+1).padStart(2,'0')}T12:00:00.000Z`;
      batch.run('synthetic-old-batch-'+suffix,'synthetic-hash-'+suffix,JSON.stringify({source:'synthetic-only',added:0,original_context:'Synthetic migration reference. '.repeat(1600)}),timestamp);
      audit.run('synthetic-legacy-audit-'+suffix,'account:ZZ-A1','update','synthetic-owner',JSON.stringify({revision:1,reference:'合成旧格式历史'+suffix}),timestamp);
    }
    // SQLite BINARY compares UTF-8 bytes; JS UTF-16 puts these suffixes in the
    // opposite order. The exported checksum must still self-preview/restore.
    for(const suffix of ['\uE000','\u{10000}']){
      batch.run('synthetic-unicode-batch-'+suffix,'synthetic-unicode-hash-'+suffix,JSON.stringify({source:'synthetic-only',unicode_order_fixture:true}),'2025-06-01T12:00:00.000Z');
    }
  });
}

test('单JSON完整迁移：raw三表、预览门槛、损坏拒绝、原子恢复与重启',async t=>{
  const source=await serverFixture(t,'source'),target=await serverFixture(t,'target');
  await populate(source);
  let backup,secondBackup,firstPreview;

  await t.test('schema3导出包含三表每个原字段、35个旧批次及完整静态参考资料',async()=>{
    backup=await source.get('/api/backup');
    assert.equal(backup.schema_version,3);assert.equal(backup.format,'friesgo-full-backup');
    assert.match(backup.checksum,/^[a-f0-9]{64}$/);assert.ok(Number.isFinite(Date.parse(backup.exported_at)));
    assert.deepEqual(Object.keys(backup.tables).sort(),['audit_events','import_batches','records']);
    assert.deepEqual(ordered(backup.tables),source.raw(),'导出后raw快照包括本次导出审计且逐字段一致');
    assert.equal(backup.tables.import_batches.filter(x=>x.id.startsWith('synthetic-old-batch-')).length,35);
    for(const suffix of ['\uE000','\u{10000}'])assert.ok(backup.tables.import_batches.some(x=>x.id==='synthetic-unicode-batch-'+suffix));
    assert.ok(backup.tables.import_batches.length>30);assert.ok((await source.get()).imports.length<=30);
    assert.ok(Buffer.byteLength(JSON.stringify(backup),'utf8')>1200000,'完整备份不受旧command上传大小限制');
    const view=await source.get();
    for(const key of ['replies','tech','channels','russian'])assert.deepEqual(backup.resources[key],view[key]);
    const records=backup.tables.records.map(x=>({row:x,value:JSON.parse(x.data)}));
    for(const kind of ['country','route','project','contact','letter','activity','task','settings'])assert.ok(records.some(x=>x.row.kind===kind),kind+' must survive raw export');
    assert.ok(records.some(x=>x.row.kind==='account'&&x.row.revision>1));
    assert.ok(records.some(x=>x.row.kind==='activity'&&x.value.letter_snapshot?.body.includes('Synthetic Operator')));
    assert.ok(records.some(x=>x.row.kind==='state'&&x.value.status==='停止联系'&&x.value.interest_note.includes('\n')));
  });

  await t.test('新种子目标预览只读，明确显示可迁入与双指纹',async()=>{
    const before=target.raw();firstPreview=await target.preview(backup);
    assert.deepEqual(target.raw(),before);assert.equal(firstPreview.target.can_restore,true);assert.ok(firstPreview.target.reason);
    assert.equal(firstPreview.summary.records,backup.tables.records.length);
    assert.equal(firstPreview.summary.import_batches,backup.tables.import_batches.length);
    assert.equal(firstPreview.summary.history,backup.tables.audit_events.length);
    for(const key of ['backup_hash','target_hash'])assert.match(firstPreview.expected[key],/^[a-f0-9]{64}$/);
    assert.equal(firstPreview.expected.backup_hash,backup.checksum);
  });

  await t.test('已有经营改动的目标拒绝覆盖，三表保持原样',async()=>{
    const account=(await source.get()).accounts.find(x=>x.id==='ZZ-A1');
    await source.command('save_account',{...account,city:'导出后新的合成改动'});
    const before=source.raw(),preview=await source.preview(backup);
    assert.equal(preview.target.can_restore,false);assert.ok(preview.target.reason);assert.deepEqual(source.raw(),before);
    await source.restore(backup,preview.expected,409);assert.deepEqual(source.raw(),before);
  });

  await t.test('有效字段被篡改而checksum未更新时拒绝，预览和恢复均不写入',async()=>{
    const bad=structuredClone(backup),row=bad.tables.records.find(x=>x.key==='account:ZZ-A1');
    row.data=JSON.stringify({...JSON.parse(row.data),city:'改动但未重新导出的合成城市'});
    const before=target.raw();
    assert.match((await target.post('/api/backup/preview',bad,400)).error,/校验/);
    await target.restore(bad,firstPreview.expected,400);assert.deepEqual(target.raw(),before);
  });

  await t.test('重复、损坏、悬空关联、缺少关键记录和不兼容版本逐类拒绝',async()=>{
    const edit=(x,key,change)=>{const row=x.tables.records.find(r=>r.key===key);row.data=JSON.stringify(change(JSON.parse(row.data)));};
    const variants=[
      ['重复records',x=>x.tables.records.push(structuredClone(x.tables.records[0])),/重复/],
      ['重复audit',x=>x.tables.audit_events.push(structuredClone(x.tables.audit_events[0])),/重复/],
      ['重复batch',x=>x.tables.import_batches.push(structuredClone(x.tables.import_batches[0])),/重复/],
      ['损坏JSON',x=>{x.tables.records[0].data='{broken';},/JSON损坏/],
      ['编号不一致',x=>edit(x,'account:ZZ-A1',v=>({...v,id:'DIFFERENT'})),/编号不一致/],
      ['悬空项目',x=>edit(x,'project:ZZ-P1',v=>({...v,links:[{account_id:'MISSING',role:'合成'}]})),/项目关联.*不存在/],
      ['悬空客户',x=>edit(x,'state:ZZ-A1',v=>({...v,account_id:'MISSING'})),/悬空客户引用/],
      ['错误开发信归属',x=>{
        const letter=x.tables.records.find(r=>r.kind==='letter'&&JSON.parse(r.data).account_id==='ZZ-A2');
        const activity=x.tables.records.find(r=>r.kind==='activity'&&JSON.parse(r.data).letter_id);
        activity.data=JSON.stringify({...JSON.parse(activity.data),letter_id:JSON.parse(letter.data).id});
      },/沟通记录与开发信不匹配/],
      ['缺state',x=>{x.tables.records=x.tables.records.filter(r=>r.key!=='state:ZZ-A1');},/缺少客户阶段/],
      ['缺settings',x=>{x.tables.records=x.tables.records.filter(r=>r.key!=='settings:main');},/工作台设置/],
      ['缺seed批次',x=>{x.tables.import_batches=x.tables.import_batches.filter(r=>r.hash!=='initial');},/初始批次/],
      ['参考资料不兼容',x=>{x.resources.replies=[];},/参考资料版本不匹配/],
      ['旧schema',x=>{x.schema_version=2;},/新版完整迁移备份/]
    ];
    for(const [label,mutate,message] of variants){
      const bad=structuredClone(backup);mutate(bad);const before=target.raw();
      const result=await target.post('/api/backup/preview',bad,400);assert.match(result.error,message,label);
      await target.restore(bad,firstPreview.expected,400);assert.deepEqual(target.raw(),before,label+' must not write');
    }
  });

  await t.test('缺少确认指纹或换另一合法备份不能复用旧预览',async()=>{
    let before=target.raw();await target.restore(backup,undefined,409);assert.deepEqual(target.raw(),before);
    secondBackup=await source.get('/api/backup');assert.deepEqual(ordered(secondBackup.tables),source.raw());
    assert.notEqual(secondBackup.checksum,backup.checksum);
    before=target.raw();await target.restore(secondBackup,firstPreview.expected,409);assert.deepEqual(target.raw(),before);
  });

  await t.test('目标仍是种子数据，但预览后元数据改变也使目标指纹失效',async()=>{
    const preview=await target.preview(secondBackup),row=target.raw().records.find(x=>x.key==='settings:main');
    target.sqlite(db=>db.prepare('UPDATE records SET updated_at=? WHERE key=?').run('2001-01-01T00:00:00.000Z',row.key));
    try{
      const changed=target.raw(),fresh=await target.preview(secondBackup);
      assert.equal(fresh.target.can_restore,true,'仅变更updated_at仍符合种子目标条件');
      assert.notEqual(fresh.expected.target_hash,preview.expected.target_hash);
      await target.restore(secondBackup,preview.expected,409);assert.deepEqual(target.raw(),changed);
    }finally{target.sqlite(db=>db.prepare('UPDATE records SET updated_at=? WHERE key=?').run(row.updated_at,row.key));}
  });

  await t.test('恢复中途数据库异常使删除、插入、审计和批次全部回滚',async()=>{
    const preview=await target.preview(secondBackup),before=target.raw();
    target.sqlite(db=>db.exec("CREATE TRIGGER synthetic_restore_failure BEFORE INSERT ON records WHEN NEW.key='account:ZZ-A2' BEGIN SELECT RAISE(ABORT,'synthetic restore rollback'); END"));
    try{await target.restore(secondBackup,preview.expected,500);assert.deepEqual(target.raw(),before);}
    finally{target.sqlite(db=>db.exec('DROP TRIGGER synthetic_restore_failure'));}
  });

  await t.test('新电脑全量恢复与进程重启逐字段一致，不追加伪造沟通或恢复审计',async()=>{
    const preview=await target.preview(secondBackup),result=await target.restore(secondBackup,preview.expected);
    assert.equal(result.restored,true);assert.equal(result.replayed,false);
    assert.deepEqual(target.raw(),ordered(secondBackup.tables));
    const restored=await target.get();
    assert.equal(restored.accounts.length,26);assert.equal(restored.states.find(x=>x.account_id==='ZZ-A1').status,'停止联系');
    assert.equal(restored.states.find(x=>x.account_id==='ZZ-A1').owner,'Synthetic Owner');
    assert.equal(restored.countries.find(x=>x.id==='ZZ').customs.limitations[0],'仅作迁移完整性测试');
    assert.equal(restored.routes.find(x=>x.id==='ZZ-R1').name,'Synthetic Regional Route');
    assert.deepEqual(new Set(restored.projects.find(x=>x.id==='ZZ-P1').links.map(x=>x.account_id)),new Set(['ZZ-A1','ZZ-A2']));
    await target.stop();await target.start();await target.get();
    assert.deepEqual(target.raw(),ordered(secondBackup.tables));
    const current=await target.preview(secondBackup);assert.equal(current.target.can_restore,false);
    const before=target.raw(),replay=await target.restore(secondBackup,preview.expected);
    assert.equal(replay.replayed,true);assert.deepEqual(target.raw(),before,'重复成功请求只能幂等返回');
  });
});
