import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

// Generic fixtures only. No operating database, customer dossier or private message is read.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fixture=()=>({
  date:'2025-06-10',
  accounts:[
    {id:'A1',name:'Synthetic Hydronic Supply',city:'测试城市甲',region:'测试地区',role:'设备渠道',segment:'B2B',website:'https://hydronic.example.invalid/',email:'public@hydronic.example.invalid',phone:'+998 90 000 00 01',grade:'C',original_grade:'A',priority_suggestion:'A',fit_fact:'公开水系统业务；采购未确认',source_urls:['https://hydronic.example.invalid/contact','https://hydronic.example.invalid/catalog'],contact_url:'https://hydronic.example.invalid/contact',fit_url:'https://hydronic.example.invalid/catalog',verified_on:'2025-04-12',evidence_stage:'E2公开业务相关',product_fit:'手动平衡阀候选',pool:'补核队列',limitations:'旧来源须复核',custom_marker:'原研究扩展字段',owner:'研究稿中的旧负责人',status:'已报价',next_action:'研究建议，不能覆盖经营动作',follow_up_date:'2025-05-01',communication:'研究参考文字，不是实际客户回复'},
    {id:'A2',name:'Synthetic Heating Contractor',city:'测试城市乙',region:'测试地区',role:'暖通承包商',website:'https://contractor.example.invalid/',grade:'A',original_grade:'B',source_urls:['https://contractor.example.invalid/works'],verified_on:'2025-05-09',fit_fact:'热水系统安装场景，未取得RFQ'}
  ],
  utilities:[{id:'R1',name:'Synthetic Regional Heat Route',region:'测试地区',city:'省级入口，城市待核',website:'https://utility.example.invalid/',email:'public@utility.example.invalid',source_urls:['https://utility.example.invalid/regions'],verified_on:'2025-04-11',grade:'B',group_id:'SYNTHETIC_UTILITY_GROUP',counting_status:'区域路由，独立采购单元未核'}],
  projects:[{id:'P1',name:'Synthetic District Heat Construction Package',account_id:'A1',links:[{account_id:'A1',role:'业主入口'},{account_id:'A2',role:'机电承包'}],cities:['测试城市甲','测试区乙'],region:'测试地区',project_id:'SYNTHETIC-PROJECT',lot:'LOT-TEST-01',budget_uzs:100000,source_url:'https://projects.example.invalid/lot-1',tender_url:'https://projects.example.invalid/lot-1/details',verified_on:'2025-04-10',date:'日期冲突待核',stage:'施工公告，状态待核',procurement_status:'无当前阀门RFQ',limitations:'施工包金额不是阀门金额',account_count:0}],
  region_plans:[['测试地区','测试城市甲','先验证','水系统渠道','未完成全城普查']],
  methods:[{id:'M1',method:'公开工程公告',url:'https://projects.example.invalid/',limit:'工程公告不证明阀门采购'}],
  customs:{query_date:'2025-06-10',currency:'USD',annual:[{period:'2024',year:2024,frequency:'A',reporter_code:860,partner_code:0,flow:'M',hs:'848180',classification:'H6',value_usd:1000,valuation:'CIF',is_reported:false,is_aggregate:true,source_url:'https://trade.example.invalid/annual'}],monthly:[],missingness:['2025月度未取得；不是零进口'],limitations:['宽HS口径不等于平衡阀市场规模']},
  qa:{candidate_records:2,populated_fields:{website:2,source_url:3},utility_routes_separate:1,project_records_separate:1,current_confirmed_valve_rfq:0,verified_natural_person_large_c_buyers:0,coverage_claim:'合成测试资料，非真实企业研究'}
});

test('国家研究导入：证据、跨国身份、经营隔离与原子验收',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'friesgo-country-'));
  const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
  const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const base=`http://127.0.0.1:${port}`;
  let child,log='';
  async function start(){
    child=spawn(process.execPath,[path.join(root,'local/dist/server.mjs')],{cwd:root,env:{...process.env,FRIESGO_PORT:String(port),FRIESGO_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
    for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{log=(log+chunk).slice(-5000);});
    for(let i=0;i<60;i++){try{if((await fetch(base+'/api/health')).ok)return;}catch{}await delay(80);}
    throw Error('Country test server failed to start: '+log);
  }
  async function stop(){if(child&&child.exitCode===null){const closed=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await closed;}}
  t.after(async()=>{await stop();await rm(dir,{recursive:true,force:true});});
  await start();
  const get=async(url='/api/data')=>{const r=await fetch(base+url);assert.equal(r.status,200);return r.json();};
  const post=async(action,data,status=200)=>{const r=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,data})});const result=await r.json();assert.equal(r.status,status,JSON.stringify(result));return result;};
  const find=async(kind,id)=>(await get())[kind].find(x=>x.id===id);
  const historyCount=async()=>(await get('/api/history')).total;
  const sqlite=fn=>{const db=new DatabaseSync(path.join(dir,'friesgo.sqlite'));try{return fn(db);}finally{db.close();}};
  const persisted=()=>sqlite(db=>({records:db.prepare('SELECT key,kind,data,revision,updated_at FROM records ORDER BY key').all(),batches:db.prepare('SELECT * FROM import_batches ORDER BY id').all(),history:db.prepare('SELECT * FROM audit_events ORDER BY id').all()}));
  const input={country_code:'ZZ',country_name:'合成测试国甲',batch_id:'country-fixture-first',portfolio:fixture()};
  let preview,baseline;

  await t.test('预览显示类型与稳定ID，缺少确认凭据不能写入',async()=>{
    baseline=await get();await historyCount();const before=persisted();
    preview=await post('preview_country_import',input);
    assert.deepEqual(persisted(),before);
    assert.equal(preview.summary.accounts.added,2);assert.equal(preview.summary.routes.added,1);assert.equal(preview.summary.projects.added,1);assert.equal(preview.summary.country.added,1);
    assert.equal(typeof preview.expected.fingerprint,'string');assert.ok(preview.expected.fingerprint.length>20);
    assert.ok(preview.changes.some(x=>x.kind==='account'&&x.id==='ZZ-A1'&&x.source_id==='A1'));
    assert.ok(preview.changes.some(x=>x.kind==='route'&&x.id==='ZZ-R1'));
    assert.ok(preview.changes.some(x=>x.kind==='project'&&x.id==='ZZ-P1'));
    await post('import_country_research',input,400);assert.deepEqual(persisted(),before);
  });

  await t.test('中途数据库失败回滚研究、客户、状态、关联、历史和批次',async()=>{
    const before=persisted();
    sqlite(db=>db.exec("CREATE TRIGGER fail_country BEFORE INSERT ON records WHEN NEW.key='route:ZZ-R1' BEGIN SELECT RAISE(ABORT,'synthetic country rollback'); END"));
    try{await post('import_country_research',{...input,expected:preview.expected},500);assert.deepEqual(persisted(),before);}
    finally{sqlite(db=>db.exec('DROP TRIGGER fail_country'));}
  });

  await t.test('确认后保存国家、候选、路由和多角色项目，不制造实际业务',async()=>{
    await post('import_country_research',{...input,expected:preview.expected});
    const data=await get(),a=data.accounts.find(x=>x.id==='ZZ-A1'),country=data.countries.find(x=>x.id==='ZZ');
    assert.equal(data.accounts.length,baseline.accounts.length+2);assert.equal(data.routes.length,(baseline.routes||[]).length+1);assert.equal(data.projects.length,baseline.projects.length+1);assert.equal(data.countries.length,(baseline.countries||[]).length+1);
    assert.equal(a.country_code,'ZZ');assert.equal(a.source_id,'A1');assert.equal(a.url,'https://hydronic.example.invalid/');assert.equal(a.grade,'C');assert.equal(a.original_grade,'A');
    assert.equal(a.verified_on,'2025-04-12');assert.deepEqual(a.source_urls,input.portfolio.accounts[0].source_urls);assert.equal(a.research_raw.custom_marker,'原研究扩展字段');
    assert.equal(country.source_date,'2025-06-10');assert.deepEqual(country.customs,input.portfolio.customs);assert.deepEqual(country.region_plans,input.portfolio.region_plans);assert.deepEqual(country.methods,input.portfolio.methods);assert.deepEqual(country.original_qa,input.portfolio.qa);
    assert.equal(data.routes.find(x=>x.id==='ZZ-R1').group_id,'SYNTHETIC_UTILITY_GROUP');
    const project=data.projects.find(x=>x.id==='ZZ-P1');assert.deepEqual(new Set(project.links.map(x=>x.account_id)),new Set(['ZZ-A1','ZZ-A2']));assert.equal(project.verified_on,'2025-04-10');
    for(const id of ['ZZ-A1','ZZ-A2']){const state=data.states.find(x=>x.account_id===id);assert.equal(state.status,'未联系');assert.equal(state.owner,'');assert.equal(state.next_action,'');assert.equal(state.next_date,'');}
    for(const kind of ['contacts','letters','activities','tasks'])assert.deepEqual(data[kind],baseline[kind],kind+' must remain unchanged');
    for(const a of baseline.accounts)assert.deepEqual(data.accounts.find(x=>x.id===a.id),a,'existing account '+a.id+' must be unchanged');
  });

  await t.test('成功批次重放幂等，同批换内容明确拒绝',async()=>{
    const before=persisted(),n=await historyCount();assert.equal((await post('import_country_research',input)).replayed,true);assert.deepEqual(persisted(),before);assert.equal(await historyCount(),n);
    const changed=structuredClone(input);changed.portfolio.accounts[0].fit_fact='同一批次不同内容';
    await post('import_country_research',{...changed,expected:preview.expected},409);assert.deepEqual(persisted(),before);
  });

  await t.test('普通客户编辑保留新增研究字段和原始证据',async()=>{
    const old=await find('accounts','ZZ-A1');
    const saved=await post('save_account',{id:old.id,name:old.name,country:old.country,city:'人工核对城市',_revision:old._revision});
    assert.equal(saved.city,'人工核对城市');
    for(const k of ['country_code','source_id','grade','original_grade','region','source_urls','product_fit','pool','research_raw'])assert.deepEqual(saved[k],old[k],k+' must survive normal editing');
  });

  await t.test('研究刷新保留业务员安排、停止联系、联系人、原文及草稿',async()=>{
    const s=await find('states','ZZ-A1');await post('save_state',{...s,owner:'本机业务员',status:'停止联系',next_action:'保留人工安排',next_date:'2026-12-01'});
    await post('save_contact',{account_id:'ZZ-A1',name:'合成采购部门',email:'manual@hydronic.example.invalid',source_url:'https://hydronic.example.invalid/contact',verified_on:'2025-04-12'});
    await post('save_activity',{account_id:'ZZ-A1',kind:'note',channel:'内部记录',summary:'人工保留的现场原意',occurred_on:'2025-05-10'});
    await post('save_letter',{account_id:'ZZ-A1',language:'EN',subject:'Synthetic draft',body:'Draft only.',cnsubject:'合成候选稿',cn:'仅为草稿。'});
    const before=await get(),refresh={...input,batch_id:'country-fixture-refresh',portfolio:fixture()};
    refresh.portfolio.accounts[0].fit_fact='本轮补核水系统业务';refresh.portfolio.accounts[0].grade='B';refresh.portfolio.accounts[0].verified_on='2025-05-20';
    refresh.portfolio.accounts[0].owner='不得覆盖';refresh.portfolio.accounts[0].status='已报价';refresh.portfolio.accounts[0].next_action='不得替换人工安排';
    const p=await post('preview_country_import',refresh);await post('import_country_research',{...refresh,expected:p.expected});
    const after=await get();assert.deepEqual(after.states.find(x=>x.account_id==='ZZ-A1'),before.states.find(x=>x.account_id==='ZZ-A1'));
    for(const k of ['contacts','letters','activities','tasks'])assert.deepEqual(after[k],before[k],k+' must not be rewritten by research');
    const a=after.accounts.find(x=>x.id==='ZZ-A1');assert.equal(a.grade,'B');assert.equal(a.verified_on,'2025-05-20');assert.equal(a.research_raw.fit_fact,'本轮补核水系统业务');
  });

  await t.test('预览后人工安排或账户改变，确认凭据失效且不写半批',async()=>{
    const refresh={...input,batch_id:'country-fixture-stale',portfolio:fixture()};refresh.portfolio.accounts[0].fit_fact='等待预览确认';
    const p=await post('preview_country_import',refresh),s=await find('states','ZZ-A1');await post('save_state',{...s,owner:'预览后修改负责人'});
    let before=persisted();await post('import_country_research',{...refresh,expected:p.expected},409);assert.deepEqual(persisted(),before);
    const p2=await post('preview_country_import',refresh),a=await find('accounts','ZZ-A1');await post('save_account',{...a,city:'预览后修改城市'});
    before=persisted();await post('import_country_research',{...refresh,expected:p2.expected},409);assert.deepEqual(persisted(),before);
  });

  await t.test('另一国家复用来源ID不覆盖原国家、原项目或经营记录',async()=>{
    const before=await get(),other={...input,country_code:'ZY',country_name:'合成测试国乙',batch_id:'country-fixture-second',portfolio:fixture()};
    const p=await post('preview_country_import',other);await post('import_country_research',{...other,expected:p.expected});const after=await get();
    assert.equal(after.accounts.length,before.accounts.length+2);assert.equal(after.routes.length,before.routes.length+1);assert.equal(after.projects.length,before.projects.length+1);
    assert.equal(after.accounts.find(x=>x.id==='ZY-A1').source_id,'A1');assert.equal(after.accounts.find(x=>x.id==='ZY-A1').country_code,'ZY');
    assert.deepEqual(new Set(after.projects.find(x=>x.id==='ZY-P1').links.map(x=>x.account_id)),new Set(['ZY-A1','ZY-A2']));
    for(const k of ['accounts','states','routes','projects'])for(const record of before[k])assert.deepEqual(after[k].find(x=>x.id===record.id),record,'other-country import changed '+k+'/'+record.id);
  });

  await t.test('非法来源、重复来源ID与悬空项目引用均原子拒绝',async()=>{
    const valid={...input,country_code:'ZX',country_name:'合成测试国丙',batch_id:'country-fixture-invalid',portfolio:fixture()},p=await post('preview_country_import',valid);
    const variants=[
      x=>{x.portfolio.accounts[1].source_urls=['javascript:alert(1)'];},
      x=>{x.portfolio.accounts[1].website=7;},
      x=>{x.portfolio.accounts.push(structuredClone(x.portfolio.accounts[0]));},
      x=>{x.portfolio.utilities.push(structuredClone(x.portfolio.utilities[0]));},
      x=>{x.portfolio.projects.push(structuredClone(x.portfolio.projects[0]));},
      x=>{x.portfolio.projects[0].account_id='UNKNOWN';x.portfolio.projects[0].links=[{account_id:'UNKNOWN',role:'待核'}];}
    ];
    for(const mutate of variants){const bad=structuredClone(valid);mutate(bad);const before=persisted();await post('preview_country_import',bad,400);await post('import_country_research',{...bad,expected:p.expected},400);assert.deepEqual(persisted(),before);}
  });

  await t.test('完整备份和进程重启保留国家研究、关联与经营历史',async()=>{
    const before=await get(),backup=await get('/api/backup');
    assert.deepEqual(backup.countries,before.countries);assert.deepEqual(backup.routes,before.routes);assert.deepEqual(backup.projects,before.projects);
    assert.equal(backup.countries.find(x=>x.id==='ZZ').customs.annual[0].value_usd,1000);assert.ok(backup.history.length>0);
    const persistedBefore=persisted();await stop();await start();await get();assert.deepEqual(persisted(),persistedBefore);
    assert.equal((await find('states','ZZ-A1')).status,'停止联系');assert.equal((await find('accounts','ZZ-A1')).grade,'B');
  });
});
