import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {workDay,validWorkDay,followedAccountIds,followupCSV} from '../app/followup-model.ts';

test('跟进统计使用上海工作日，按客户去重并排除自动回复与撤销',()=>{
  assert.equal(workDay(new Date('2026-10-27T15:59:59Z')),'2026-10-27');
  assert.equal(workDay(new Date('2026-10-27T16:00:00Z')),'2026-10-28');
  assert.equal(validWorkDay('2026-02-30'),false);assert.equal(validWorkDay('2024-02-29'),true);
  const day='2026-10-27',a=(account_id,kind,status,occurred_on=day)=>({account_id,kind,status,occurred_on});
  assert.deepEqual([...followedAccountIds([a('A','followup','done'),a('A','reply'),a('B','automatic_reply'),a('C','note'),a('D','followup','cancelled'),a('E','outreach'),a('F','outreach',undefined,''),a('G','outreach',undefined,'2026-10-26')],day)],['A','E']);
  const csv=followupCSV({accounts:[{id:'A',name:'=HYPERLINK("x")'}],states:[{account_id:'A',next_action:'  +SUM(1,2)'}],activities:[a('A','followup','done')]},day);
  assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));assert.ok(csv.includes('"\'  +SUM(1,2)"'));
});

test('快速跟进与意向安排：幂等、撤销、事务、状态隔离及持久化',async t=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dir=await mkdtemp(path.join(tmpdir(),'friesgo-followup-'));
  const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const base=`http://127.0.0.1:${port}`;let child,log='';
  async function start(){child=spawn(process.execPath,[path.join(root,'local/dist/server.mjs')],{cwd:root,env:{...process.env,FRIESGO_PORT:String(port),FRIESGO_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});for(const s of [child.stdout,child.stderr])s.on('data',b=>{log=(log+b).slice(-3000);});for(let i=0;i<60;i++){try{if((await fetch(base+'/api/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,70));}throw Error(log);}
  async function stop(){if(child&&child.exitCode===null){const closed=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await closed;}}
  t.after(async()=>{await stop();await rm(dir,{recursive:true,force:true});});await start();
  const get=async()=>{const r=await fetch(base+'/api/data');assert.equal(r.status,200);return r.json();};
  const post=async(action,data,status=200)=>{const r=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,data})});const result=await r.json();assert.equal(r.status,status,JSON.stringify(result));return result;};
  const find=async(kind,id)=>(await get())[kind].find(x=>x.id===id);
  const sqlite=fn=>{const db=new DatabaseSync(path.join(dir,'friesgo.sqlite'));try{return fn(db);}finally{db.close();}};
  const persisted=()=>sqlite(db=>({records:db.prepare('SELECT * FROM records ORDER BY key').all(),audit:db.prepare('SELECT * FROM audit_events ORDER BY id').all()}));
  const day=workDay(),tomorrow=new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10);let first;
  for(const id of ['FOLLOWUP_A','FOLLOWUP_B','FOLLOWUP_C'])await post('save_account',{id,name:'Synthetic '+id,country:'测试国',url:'https://example.invalid/'});
  await t.test('重复及并发点击只留一个客户日记录，人工状态不变',async()=>{
    const s=await find('states','FOLLOWUP_A');await post('save_state',{...s,owner:'业务员甲',next_action:'保留原安排',next_date:tomorrow});
    const before=(await get()).states;
    const input={account_id:'FOLLOWUP_A',done:true,occurred_on:day};const [a,b]=await Promise.all([post('set_followup',input),post('set_followup',input)]);assert.equal(a.id,b.id);first=a;
    const old=persisted();await post('set_followup',input);assert.deepEqual(persisted(),old);
    const data=await get();assert.deepEqual(data.states,before);assert.equal(data.activities.filter(x=>x.kind==='followup').length,1);assert.equal(followedAccountIds(data.activities,day).size,1);assert.equal(data.activities[0].channel,'人工标记');
  });
  await t.test('撤销与重新标记不重复，过期版本和未来日期拒绝',async()=>{
    const cancelled=await post('set_followup',{account_id:'FOLLOWUP_A',done:false,occurred_on:day,_revision:first._revision});assert.equal(followedAccountIds((await get()).activities,day).size,0);
    const before=persisted();await post('set_followup',{account_id:'FOLLOWUP_A',done:true,occurred_on:day,_revision:first._revision},409);assert.deepEqual(persisted(),before);
    await post('set_followup',{account_id:'FOLLOWUP_A',done:true,occurred_on:day,_revision:cancelled._revision});assert.equal(followedAccountIds((await get()).activities,day).size,1);
    await post('set_followup',{account_id:'FOLLOWUP_A',done:true,occurred_on:tomorrow},400);await post('set_followup',{account_id:'MISSING',done:true},404);
  });
  await t.test('自动回复不计跟进；实际回复与手动标记按客户去重',async()=>{
    await post('save_activity',{account_id:'FOLLOWUP_B',kind:'automatic_reply',channel:'邮箱',summary:'自动回执',occurred_on:day});assert.equal(followedAccountIds((await get()).activities,day).size,1);
    await post('save_activity',{account_id:'FOLLOWUP_A',kind:'reply',channel:'邮箱',summary:'合成回复',occurred_on:day});assert.equal(followedAccountIds((await get()).activities,day).size,1);
  });
  await t.test('意向与今日跟进同时回滚，不产生半条意向或假回复',async()=>{
    const s=await find('states','FOLLOWUP_C'),input={...s,interest_note:'合成需求摘要',next_action:'核对规格',next_date:tomorrow};
    const before=persisted();sqlite(db=>db.exec("CREATE TRIGGER fail_followup BEFORE INSERT ON records WHEN NEW.kind='activity' AND json_extract(NEW.data,'$.account_id')='FOLLOWUP_C' BEGIN SELECT RAISE(ABORT,'fixture failure'); END"));
    await post('save_interest',input,500);assert.deepEqual(persisted(),before);sqlite(db=>db.exec('DROP TRIGGER fail_followup'));
    const result=await post('save_interest',input);assert.equal(result.status,'意向客户');assert.equal(result.interest_note,'合成需求摘要');assert.equal(result.next_date,tomorrow);assert.equal(followedAccountIds((await get()).activities,day).size,2);
    assert.equal((await get()).activities.filter(a=>a.account_id==='FOLLOWUP_C'&&a.kind==='reply').length,0);
    assert.ok((await get()).activities.find(a=>a.account_id==='FOLLOWUP_C').summary.includes('合成需求摘要'));
    const snapshot=persisted();await post('save_interest',input,409);assert.deepEqual(persisted(),snapshot);
    await post('save_state',{...result,status:'需求确认',next_action:'继续核对'});assert.equal((await find('states','FOLLOWUP_C')).interest_note,'合成需求摘要');
  });
  await t.test('停止联系与错误意向资料不写入，CSV只导出目标日真实名单',async()=>{
    const s=await find('states','FOLLOWUP_B');await post('save_state',{...s,status:'停止联系'});const stopped=await find('states','FOLLOWUP_B'),before=persisted();
    await post('set_followup',{account_id:'FOLLOWUP_B',done:true},400);await post('save_interest',{...stopped,interest_note:'x',next_action:'x',next_date:tomorrow},400);assert.deepEqual(persisted(),before);
    const r=await fetch(base+'/api/followups/export?date='+day);assert.equal(r.status,200);const csv=await r.text();assert.ok(csv.includes('Synthetic FOLLOWUP_A'));assert.ok(csv.includes('Synthetic FOLLOWUP_C'));assert.ok(!csv.includes('Synthetic FOLLOWUP_B'));
    assert.equal((await fetch(base+'/api/followups/export?date=2026-02-30')).status,400);assert.equal((await fetch(base+'/api/followups/export?date='+tomorrow)).status,400);
  });
  await t.test('重启保留完成标记、撤销历史与意向摘要',async()=>{
    const before=await get();await stop();await start();const after=await get();assert.deepEqual(after.activities,before.activities);assert.deepEqual(after.states,before.states);
    assert.ok((await (await fetch(base+'/api/history?account_id=FOLLOWUP_A')).json()).items.some(x=>x.kind==='activity'&&x.changes.some(c=>c.after==='cancelled')));
  });
});
