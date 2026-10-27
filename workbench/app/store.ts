import {env} from 'cloudflare:workers';
import seed from './seed.json';
import {AppError} from './errors';
import {auditDetails,auditStatement,historyChanges,recordEvent} from './history-store';
import {previewCountryImport,importCountryResearch,countryAccountTextFields,countryAccountStructuredFields,countryProjectFields,researchField} from './country-store';
import {setFollowup,saveInterest} from './followup-store';
export {AppError} from './errors';
export type Item=Record<string,any>;
const now=()=>new Date().toISOString();
const uuid=()=>crypto.randomUUID();
const db=()=>{if(!env.DB)throw new AppError('数据库尚未连接',503);return env.DB;};
const parse=(r:any)=>({...JSON.parse(r.data),_revision:r.revision,_updated_at:r.updated_at});
const keyOf=(kind:string,id:string)=>`${kind}:${id}`;
const required=(value:any,label:string,max=20000)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new AppError(`${label}不能为空，且不可超过${max}字`);return value.trim();};
const clean=(value:any,max=20000)=>typeof value==='string'?value.trim().slice(0,max):'';
const date=(value:any)=>{if(!value)return '';try{if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw Error();return value;}catch{throw new AppError('请输入有效日期');}};
export function safeUrl(value:any){if(!value)return '';try{const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error();return u.href;}catch{throw new AppError('链接必须是有效的 http 或 https 地址');}}
export async function getRecord(kind:string,id:string){const r=await db().prepare('SELECT * FROM records WHERE key=?').bind(keyOf(kind,id)).first<any>();return r?parse(r):null;}
export async function ensureSeed(){
  if(await db().prepare('SELECT id FROM import_batches WHERE id=?').bind(seed.batch_id).first())return;
  const ts=now();const items:any[]=[];
  const add=(kind:string,id:string,data:any)=>items.push(db().prepare('INSERT OR IGNORE INTO records(key,kind,data,revision,updated_at) VALUES(?,?,?,1,?)').bind(keyOf(kind,id),kind,JSON.stringify(data),ts));
  for(const a of seed.accounts){add('account',a.id,a);add('state',a.id,{id:a.id,account_id:a.id,status:'未联系',owner:'',next_action:a.note,next_date:''});}
  for(const l of seed.letters)add('letter',l.id,l);
  add('settings','main',{id:'main',name:'',position:'Sales Contact',website:'',whatsapp:'',email:'',company:'FriesGo Global'});
  items.push(db().prepare('INSERT OR IGNORE INTO import_batches(id,hash,summary,created_at) VALUES(?,?,?,?)').bind(seed.batch_id,'initial',JSON.stringify({accounts:24,letters:24,source:'已有24家客户工作册',verified_on:'2026-10-24'}),ts));
  await db().batch(items);
}
export async function loadData(){
  await ensureSeed();const rows=await db().prepare('SELECT * FROM records ORDER BY updated_at DESC,key').all<any>();
  const result:Item={accounts:[],states:[],contacts:[],letters:[],activities:[],tasks:[],projects:[],countries:[],routes:[],settings:{},replies:seed.replies,tech:seed.tech,channels:seed.channels,russian:seed.russian};
  const names:Item={account:'accounts',state:'states',contact:'contacts',letter:'letters',activity:'activities',task:'tasks',project:'projects',country:'countries',route:'routes'};
  for(const r of rows.results||[]){if(r.kind==='settings')result.settings=parse(r);else if(names[r.kind])result[names[r.kind]].push(parse(r));}
  result.accounts.sort((a:any,b:any)=>(a.number||99999)-(b.number||99999)||a.name.localeCompare(b.name));
  result.imports=(await db().prepare('SELECT id,summary,created_at FROM import_batches ORDER BY created_at DESC LIMIT 30').all<any>()).results.map(r=>({...r,summary:JSON.parse(r.summary)}));
  return result;
}
async function save(kind:string,id:string,value:Item,actor:string,revision?:number){
  const previous=await getRecord(kind,id);
  if(previous&&revision===undefined)throw new AppError('请刷新数据后再修改',409);
  if(previous&&previous._revision!==revision)throw new AppError('这条记录已被更新，请刷新后重试',409);
  const data:Item={...value,id};delete data._revision;delete data._updated_at;
  if(previous&&!historyChanges(previous,data).length)return previous;
  const ts=now(),key=keyOf(kind,id),action=previous?'update':'create';
  const details=await auditDetails(kind,previous,data,{revision:(previous?previous._revision:0)+1});
  // Both statements run in one transaction. A stale edit writes neither the record nor its history.
  const guard=previous?'EXISTS(SELECT 1 FROM records WHERE key=? AND revision=?)':'NOT EXISTS(SELECT 1 FROM records WHERE key=?)';
  const audit=db().prepare(`INSERT INTO audit_events(id,entity_key,action,actor,details,created_at) SELECT ?,?,?,?,?,? WHERE ${guard}`).bind(uuid(),key,action,actor,JSON.stringify(details),ts,...(previous?[key,revision!]:[key]));
  const mutation=previous?db().prepare('UPDATE records SET data=?,revision=revision+1,updated_at=? WHERE key=? AND revision=?').bind(JSON.stringify(data),ts,key,revision!):db().prepare('INSERT INTO records(key,kind,data,revision,updated_at) VALUES(?,?,?,1,?) ON CONFLICT(key) DO NOTHING').bind(key,kind,JSON.stringify(data),ts);
  const result:any=await db().batch([audit,mutation]);
  if(Number(result[1].meta?.changes??result[1].changes)!==1)throw new AppError('记录已被其他操作更新，请刷新',409);
  return getRecord(kind,id);
}
async function accountExists(id:string){if(!await getRecord('account',id))throw new AppError('客户不存在',404);}
export const stages=['未联系','已联系','人工回复','意向客户','需求确认','待资料','待报价','已报价','样品评估','试单','暂停','停止联系'];
const accountFields=['name','country','city','role','email','phone','url','domain','address','queue','note','writing_fact','writing_source','product_focus','verification','verified_on','planned_date','socials',...countryAccountTextFields,...countryAccountStructuredFields];
function research(input:Item,old:Item={}){
  const a:Item={...old};delete a._revision;delete a._updated_at;
  for(const field of accountFields)if(input[field]!==undefined)a[field]=field==='socials'?input[field]:countryAccountStructuredFields.includes(field)?researchField(input[field],field):clean(input[field]);
  a.name=required(a.name,'公司名称',250);a.country=required(a.country,'国家或地区',100);
  for(const k of ['url','writing_source','contact_url','fit_url'])if(a[k])a[k]=safeUrl(a[k]);
  if(a.grade&&!['S','A','B','C'].includes(a.grade))throw new AppError('研究级别应为S/A/B/C');
  if(a.country_code&&!/^[A-Z]{2}$/.test(a.country_code))throw new AppError('国家代码需要两位大写英文字母');
  if(a.verified_on)date(a.verified_on);if(a.planned_date)date(a.planned_date);
  if(a.socials){if(typeof a.socials!=='object'||Array.isArray(a.socials))throw new AppError('社媒格式错误');const valid:Item={};for(const k of ['whatsapp','linkedin','facebook','instagram','telegram','zalo','wechat'])if(a.socials[k])valid[k]=k==='wechat'?clean(a.socials[k],100):safeUrl(a.socials[k]);a.socials=valid;}
  return a;
}
function domain(a:Item){try{return new URL(a.url||'https://'+a.domain).hostname.replace(/^www\./,'').toLowerCase();}catch{return '';}}
export async function previewImport(input:Item){
  if(!input||!Array.isArray(input.accounts)||input.accounts.length>100)throw new AppError('导入内容需要 accounts 数组，单批最多100家');
  const all=await loadData();const seen=new Set<string>();const changes:any[]=[];
  for(const x of input.accounts){
    if(!x||typeof x!=='object')throw new AppError('客户资料格式错误');
    const candidate=research(x);let existing=x.id?all.accounts.find((a:any)=>a.id===x.id):null;
    if(x.id&&!existing&&all.accounts.some((a:any)=>a.id===x.id))throw new AppError('客户编号冲突');
    const matches=all.accounts.filter((a:any)=>domain(a)&&domain(a)===domain(candidate)&&a.country===candidate.country);
    if(!existing&&matches.length){if(matches.length>1||matches[0].name.toLowerCase()!==candidate.name.toLowerCase())throw new AppError(`${candidate.name} 与已有主体共用域名，请核实后填写明确客户ID`);existing=matches[0];}
    if(existing&&existing.name.toLowerCase()!==candidate.name.toLowerCase())throw new AppError(`${candidate.name} 与客户ID对应名称不一致，请先人工核对主体`);
    const id=existing?.id||clean(x.id,80)||'C-'+uuid();
    if(!/^[\w-]{1,80}$/.test(id)||seen.has(id))throw new AppError('同批存在重复或无效客户ID');seen.add(id);
    const blocked=Object.keys(x).filter(k=>['status','owner','next_action','next_date','reply','stop','states','activities','tasks'].includes(k));
    changes.push({id,name:candidate.name,action:existing?'更新研究资料':'新增客户',ignored_fields:blocked,research:research(x,existing||{}),letter:x.letter||null});
  }
  return {changes,added:changes.filter(x=>x.action==='新增客户').length,updated:changes.filter(x=>x.action!=='新增客户').length};
}
async function fingerprint(value:any){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(x=>x.toString(16).padStart(2,'0')).join('');}
async function previewExcelImport(input:Item){
  if(!Array.isArray(input.accounts)||input.accounts.length>100)throw new AppError('请选择客户资料，单批最多100家');
  const current=await loadData(),seen=new Set<string>(),normalized=(s:string)=>s.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
  const accounts=input.accounts.map((a:Item)=>{if(!a||typeof a!=='object')throw new AppError('客户资料格式错误');const name=required(a.name,'公司名称',250),country=required(a.country,'国家或地区',100),key=normalized(name)+'|'+normalized(country);if(seen.has(key))throw new AppError(`${name} 在选中资料中重复，请合并后再导入`);seen.add(key);if(a.id)return a;const matches=current.accounts.filter((x:Item)=>normalized(x.name)===normalized(name)&&normalized(x.country)===normalized(country));if(matches.length>1)throw new AppError(`${name} 有多个同名主体，请核对客户ID`);return matches.length?{...a,id:matches[0].id,name:matches[0].name}:a;});
  const preview=await previewImport({...input,accounts});const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  for(let i=0;i<preview.changes.length;i++){
    const x=preview.changes[i],raw=input.accounts[i].tracking||{},tracking:Item={},warnings:string[]=[];
    for(const k of ['contact_name','contact_title','contact_channel','reply_summary','status','owner','next_action','linkedin_added'])if(raw[k])tracking[k]=required(raw[k],k,k==='reply_summary'?5000:1000);
    for(const k of ['sent_on','next_date','follow4','follow10','follow20'])if(raw[k])tracking[k]=date(raw[k]);
    if(tracking.sent_on>today)throw new AppError(`${x.name} 的实际发送日在未来，请改为计划日期`);
    if(tracking.status&&!stages.includes(tracking.status))warnings.push('原表阶段不在系统选项中，保留在原表参考记录，不改变当前阶段');
    if(!tracking.contact_name&&(tracking.contact_title||tracking.contact_channel))warnings.push('联系人缺少姓名或部门，仅保存为原表参考记录');
    const before=await getRecord('state',x.id),base=before||{id:x.id,account_id:x.id,status:'未联系',owner:'',next_action:'',next_date:''};
    const after={...base};delete after._revision;delete after._updated_at;
    if(input.apply_state===true){for(const k of ['owner','next_action','next_date'])if(tracking[k])after[k]=tracking[k];if(stages.includes(tracking.status))after.status=tracking.status;}
    if(after.next_date&&!after.next_action)throw new AppError(`${x.name} 的下次动作日期缺少对应动作，请补充后迁入安排`);
    x.tracking=tracking;x.source={filename:clean(input.accounts[i].source?.filename,180),sheet:clean(input.accounts[i].source?.sheet,100),row:clean(String(input.accounts[i].source?.row||''),12),original_id:clean(input.accounts[i].source?.original_id,100)};
    x.before_state=base;x.after_state=after;x.state_changes=historyChanges(base,after);x.warnings=warnings;
    x.account_revision=(await getRecord('account',x.id))?._revision||0;
    const expected=input.accounts[i].expected;if(expected&&(expected.account!==x.account_revision||expected.state!==(before?._revision||0)))throw new AppError(`${x.name} 在预览后已被修改，请重新预览`,409);
  }
  return {...preview,tracking_enabled:input.include_tracking===true,state_enabled:input.apply_state===true};
}
export async function importResearch(input:Item,actor:string,excel=false){
  const digest=await fingerprint(excel?{accounts:input.accounts,include_tracking:input.include_tracking===true,apply_state:input.apply_state===true}:input.accounts);
  const id=clean(input.batch_id,120)||'research-'+digest.slice(0,24);
  const prior=await db().prepare('SELECT * FROM import_batches WHERE id=?').bind(id).first<any>();
  if(prior){if(prior.hash!==digest)throw new AppError('该批次编号已用于不同资料',409);return {...JSON.parse(prior.summary),replayed:true};}
  const preview=excel?await previewExcelImport(input):await previewImport(input);const ts=now();const jobs:any[]=[];let contacts=0,activities=0,stateUpdates=0,letters=0;
  const write=async(kind:string,recordId:string,value:any,source?:Item)=>{
    const previous=await getRecord(kind,recordId);if(previous&&!historyChanges(previous,value).length)return;
    if(previous)jobs.push(db().prepare('UPDATE records SET data=?,revision=CASE WHEN revision=? THEN revision+1 ELSE NULL END,updated_at=? WHERE key=?').bind(JSON.stringify(value),previous._revision,ts,keyOf(kind,recordId)));
    else jobs.push(db().prepare('INSERT INTO records(key,kind,data,revision,updated_at) VALUES(?,?,?,1,?)').bind(keyOf(kind,recordId),kind,JSON.stringify(value),ts));
    jobs.push(auditStatement(keyOf(kind,recordId),previous?'update':'create',actor,await auditDetails(kind,previous,value,{batch_id:id,source:excel?'excel_import':'research_import',source_row:source,revision:(previous?previous._revision:0)+1}),ts));
  };
  for(const x of preview.changes){await write('account',x.id,{...x.research,id:x.id},x.source);
    if(excel){if(x.action==='新增客户'||x.state_changes.length){await write('state',x.id,x.after_state,x.source);if(x.state_changes.length)stateUpdates++;}}
    else if(x.action==='新增客户')jobs.push(db().prepare('INSERT OR IGNORE INTO records(key,kind,data,revision,updated_at) VALUES(?,?,?,1,?)').bind(keyOf('state',x.id),'state',JSON.stringify({id:x.id,account_id:x.id,status:'未联系',owner:'',next_action:'',next_date:''}),ts));
    if(x.letter){const l=validateLetter({...x.letter,account_id:x.id});const lid=excel?'excel-'+(await fingerprint(l)).slice(0,40):'import-'+uuid();if(!excel||!await getRecord('letter',lid)){await write('letter',lid,{...l,id:lid,status:'candidate',created_at:ts, ...(excel?{import_source:x.source}:{})},x.source);letters++;}}
    if(excel&&input.include_tracking===true){
      const tr=x.tracking,source=x.source,all=await loadData();
      if(tr.contact_name){const address=tr.contact_channel||'',email=address.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0]||'',phone=!email?address.slice(0,100):'';
        const value={account_id:x.id,name:tr.contact_name,title:tr.contact_title||'',email,phone,whatsapp:'',linkedin:'',source_url:'',verified_on:'',verification:'Excel 原表迁入，身份及渠道未重新核验',import_source:source};
        const contactId='excel-'+(await fingerprint({account:x.id,name:value.name,email,phone})).slice(0,40);
        if(!all.contacts.some((c:Item)=>c.account_id===x.id&&c.name===value.name&&(email?c.email===email:phone?c.phone===phone:true))&&!await getRecord('contact',contactId)){await write('contact',contactId,{...value,id:contactId},source);contacts++;}
      }
      const addActivity=async(kind:string,occurred:string,summary:string,identity:Item)=>{const activityId='excel-'+(await fingerprint({account:x.id,...identity})).slice(0,40);if(await getRecord('activity',activityId))return;await write('activity',activityId,{id:activityId,account_id:x.id,kind,channel:'Excel历史迁入',summary,occurred_on:occurred,letter_id:'',letter_snapshot:null,created_at:ts,import_source:source,imported_undated:!occurred},source);activities++;};
      if(tr.sent_on)await addActivity('outreach',tr.sent_on,'原表登记首封实际发送日；发送渠道、收件人及当时正文未提供。',{type:'sent',date:tr.sent_on});
      if(tr.reply_summary)await addActivity('note','','原表客户回复摘要（原发生日期、人工/自动回复类型未提供）：\n'+tr.reply_summary,{type:'reply_reference',text:tr.reply_summary});
      const reference:Item={};for(const k of ['follow4','follow10','follow20','linkedin_added'])if(tr[k])reference[k]=tr[k];
      if(!tr.contact_name)for(const k of ['contact_title','contact_channel'])if(tr[k])reference[k]=tr[k];
      if(tr.status&&!stages.includes(tr.status))reference.original_status=tr.status;
      if(Object.keys(reference).length)await addActivity('note','','原表参考信息（跟进日期为计划，不代表已执行）：\n'+JSON.stringify(reference,null,2),{type:'reference',...reference});
    }
  }
  const summary={added:preview.added,updated:preview.updated,batch_id:id,ignored_fields:preview.changes.flatMap(x=>x.ignored_fields),source:clean(input.source,300)||'研究资料导入',...(excel?{contacts,activities,state_updates:stateUpdates,letters}: {})};
  jobs.push(db().prepare('INSERT INTO import_batches(id,hash,summary,created_at) VALUES(?,?,?,?)').bind(id,digest,JSON.stringify(summary),ts));
  jobs.push(auditStatement(id,excel?'excel_import':'research_import',actor,{version:2,kind:'import',label:summary.source,account_ids:preview.changes.map(x=>x.id),accounts:preview.changes.map(x=>({id:x.id,name:x.name})),changes:[],...summary,...(excel?{source_rows:preview.changes.map(x=>({id:x.id,source:x.source,tracking:x.tracking,include_tracking:input.include_tracking===true,apply_state:input.apply_state===true}))}:{}),summary:`${summary.source}：新增 ${summary.added} 家、更新 ${summary.updated} 家客户。`},ts));
  try{await db().batch(jobs);}catch(e){const repeat=await db().prepare('SELECT hash,summary FROM import_batches WHERE id=?').bind(id).first<any>();if(repeat?.hash===digest)return {...JSON.parse(repeat.summary),replayed:true};throw e;}
  return summary;
}
function validateLetter(x:Item){return {account_id:required(x.account_id,'客户ID',80),language:required(x.language,'语言',40),subject:required(x.subject,'外文主题',500),body:required(x.body,'外文正文'),cnsubject:required(x.cnsubject,'中文主题',500),cn:required(x.cn,'中文对照'),evidence:clean(x.evidence),source_url:safeUrl(x.source_url)};}
export async function command(action:string,input:Item,actor:string):Promise<any>{
  await ensureSeed();
  if(action==='set_followup')return setFollowup(input,actor);
  if(action==='save_interest')return saveInterest(input,actor);
  if(action==='record_copy'){
    const l=await getRecord('letter',required(input.letter_id,'开发信版本',100));if(!l)throw new AppError('开发信版本不存在',404);
    const a=await getRecord('account',l.account_id),settings=await getRecord('settings','main');
    const fill=(t:string)=>t.replaceAll('{{姓名}}',settings?.name||'[姓名]').replaceAll('{{官网}}',settings?.website||'[官网]').replaceAll('{{WhatsApp}}',settings?.whatsapp||'[WhatsApp]').replaceAll('[姓名]',settings?.name||'[姓名]').replaceAll('[官网]',settings?.website||'[官网]').replaceAll('[WhatsApp]',settings?.whatsapp||'[WhatsApp]');
    await recordEvent('copy_letter',actor,{kind:'letter',entity_key:'letter:'+l.id,label:l.subject,account_ids:[l.account_id],accounts:[{id:l.account_id,name:a?.name||l.account_id}],summary:'复制开发信 · '+(a?.name||l.account_id),after:{subject:l.subject,body:fill(l.body),cnsubject:l.cnsubject,cn:fill(l.cn),language:l.language},note:'登记复制成功的草稿版本，不代表已发送。'});return {recorded:true};
  }
  if(action==='preview_import')return previewImport(input);
  if(action==='preview_country_import')return previewCountryImport(input);
  if(action==='import_country_research')return importCountryResearch(input,actor);
  if(action==='import_research')return importResearch(input,actor);
  if(action==='preview_excel_import')return previewExcelImport(input);
  if(action==='import_excel')return importResearch(input,actor,true);
  if(action==='save_account'){
    const id=clean(input.id,80)||'C-'+uuid();const old=await getRecord('account',id);const a=research(input,old||{});
    const saved=await save('account',id,{...a,number:old?.number},actor,input._revision);
    if(!old)await save('state',id,{account_id:id,status:'未联系',owner:'',next_action:'',next_date:''},actor);return saved;
  }
  if(action==='save_state'){
    const id=required(input.account_id,'客户ID',80);await accountExists(id);
    if(!stages.includes(input.status))throw new AppError('客户阶段无效');
    const previous=await getRecord('state',id);
    const value={...(previous||{}),account_id:id,status:input.status,owner:clean(input.owner,100),next_action:clean(input.next_action,1000),next_date:date(input.next_date)};
    if(value.next_date&&!value.next_action)throw new AppError('设置日期时也请填写下一步动作');
    return save('state',id,value,actor,input._revision);
  }
  if(action==='save_contact'){
    await accountExists(input.account_id);const id=clean(input.id,80)||uuid();
    return save('contact',id,{account_id:input.account_id,name:required(input.name,'联系人姓名或部门',200),title:clean(input.title,150),email:clean(input.email,250),phone:clean(input.phone,100),whatsapp:safeUrl(input.whatsapp),linkedin:safeUrl(input.linkedin),source_url:safeUrl(input.source_url),verified_on:date(input.verified_on),verification:clean(input.verification,400)},actor,input._revision);
  }
  if(action==='save_activity'){
    await accountExists(input.account_id);const state=await getRecord('state',input.account_id);
    if(input.kind==='outreach'&&state?.status==='停止联系')throw new AppError('客户已停止联系，不能新增对外联系动作');
    if(!['note','outreach','reply','automatic_reply'].includes(input.kind))throw new AppError('记录类型无效');
    const occurred=date(required(input.occurred_on,'实际日期',10));
    if(occurred>new Date(Date.now()+8*3600000).toISOString().slice(0,10))throw new AppError('实际联系日期不能晚于今天，未来动作请添加为任务');
    let snapshot:any=null;
    if(input.letter_id){const letter=await getRecord('letter',input.letter_id);if(!letter||letter.account_id!==input.account_id)throw new AppError('开发信版本与客户不匹配');const s=await getRecord('settings','main');const fill=(text:string)=>text.replaceAll('{{姓名}}',s?.name||'[姓名]').replaceAll('{{官网}}',s?.website||'[官网]').replaceAll('{{WhatsApp}}',s?.whatsapp||'[WhatsApp]').replaceAll('[姓名]',s?.name||'[姓名]').replaceAll('[官网]',s?.website||'[官网]').replaceAll('[WhatsApp]',s?.whatsapp||'[WhatsApp]');snapshot={subject:letter.subject,body:fill(letter.body),cnsubject:letter.cnsubject,cn:fill(letter.cn),language:letter.language};}
    return save('activity',uuid(),{account_id:input.account_id,kind:input.kind,channel:required(input.channel,'渠道',60),summary:required(input.summary,'本次结果',6000),occurred_on:occurred,letter_id:clean(input.letter_id,100),letter_snapshot:snapshot,created_at:now()},actor);
  }
  if(action==='save_task'){
    await accountExists(input.account_id);const state=await getRecord('state',input.account_id);
    if(state?.status==='停止联系')throw new AppError('客户已停止联系，请先核对状态');
    const id=clean(input.id,80)||uuid();
    return save('task',id,{account_id:input.account_id,title:required(input.title,'任务内容',1000),due_date:date(required(input.due_date,'到期日期',10)),status:['open','done','cancelled'].includes(input.status)?input.status:'open'},actor,input._revision);
  }
  if(action==='save_project'){
    const id=clean(input.id,80)||uuid();const links=Array.isArray(input.links)?input.links:[];
    if(new Set(links.map((x:any)=>x.account_id)).size!==links.length)throw new AppError('同一客户请合并参与角色后关联一次');
    for(const link of links){await accountExists(link.account_id);required(link.role,'项目参与角色',150);}
    const p={name:required(input.name,'项目名称',300),country:clean(input.country,100),location:clean(input.location,300),phase:clean(input.phase,80)||'待核实',procurement_status:clean(input.procurement_status,100)||'采购方待核',window_start:date(input.window_start),window_end:date(input.window_end),date_basis:input.date_basis==='已确认'?'已确认':'估计待核',source_url:safeUrl(input.source_url),source_date:date(input.source_date),verified_on:date(input.verified_on),requirements:clean(input.requirements,3000),note:clean(input.note,4000),links:links.map((x:any)=>({account_id:x.account_id,role:clean(x.role,150)}))};
    if(p.window_start&&p.window_end&&p.window_start>p.window_end)throw new AppError('采购窗口结束日期不能早于开始日期');
    if(p.date_basis==='已确认'&&(!p.source_url||!p.verified_on))throw new AppError('确认采购时间需要填写来源和核验日期');
    const previous=await getRecord('project',id),extra:Item={};for(const field of countryProjectFields)if(input[field]!==undefined)extra[field]=researchField(input[field],field);
    return save('project',id,{...(previous||{}),...extra,...p},actor,input._revision);
  }
  if(action==='save_letter'){await accountExists(input.account_id);const l=validateLetter(input);return save('letter',uuid(),{...l,status:'draft',created_at:now()},actor);}
  if(action==='save_settings')return save('settings','main',{name:clean(input.name,150),position:clean(input.position,150),website:safeUrl(input.website),whatsapp:clean(input.whatsapp,100),email:clean(input.email,200),company:'FriesGo Global'},actor,input._revision);
  throw new AppError('操作不存在',404);
}
