import {env} from 'cloudflare:workers';
import {AppError} from './errors';
import {auditDetails,auditStatement,historyChanges} from './history-store';

type Item=Record<string,any>;
type Kind='account'|'route'|'project'|'country';
type Row={key:string,kind:string,data:string,revision:number,updated_at:string};
type Change={kind:Kind,id:string,source_id:string,name:string,action:'add'|'update'|'unchanged',fields:string[],revision:number,value:Item,before:Item|null};
const db=()=>{if(!env.DB)throw new AppError('数据库尚未连接',503);return env.DB;};
const text=(v:any,max=20000)=>typeof v==='string'?v.trim().slice(0,max):'';
const required=(v:any,label:string,max=20000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new AppError(`${label}不能为空，且不可超过${max}字`);return v.trim();};
const object=(v:any,label:string):Item=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new AppError(`${label}需要是对象`);return v;};
const key=(kind:string,id:string)=>`${kind}:${id}`;
const cleanRecord=(v:Item)=>Object.fromEntries(Object.entries(v).filter(([k])=>!k.startsWith('_')));
const parse=(r:Row):Item=>({...JSON.parse(r.data),_revision:r.revision,_updated_at:r.updated_at});
const normalized=(v:any)=>text(v,500).normalize('NFKC').replace(/\s+/g,'').toLowerCase();
const stable=(v:any):string=>v===null?'null':Array.isArray(v)?'['+v.map(stable).join(',')+']':typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
const hash=async(v:any)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stable(v))))).map(x=>x.toString(16).padStart(2,'0')).join('');
function httpUrl(v:any,label='来源链接'){
  if(v===undefined||v===null||v==='')return '';
  if(typeof v!=='string'||v.length>6000)throw new AppError(`${label}格式不正确`);
  try{const u=new URL(v);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error();return u.href;}catch{throw new AppError(`${label}必须是有效的 http 或 https 地址`);}
}
function validDate(v:any,label:string){
  if(!v)return '';
  if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw new AppError(`${label}需要有效的 YYYY-MM-DD 日期`);
  return v;
}
function validateJson(v:any,path='资料',depth=0):void{
  if(depth>24)throw new AppError(`${path}嵌套层次过深`);
  if(v===null||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))return;
  if(typeof v==='string'){if(v.length>60000)throw new AppError(`${path}单个字段过长`);return;}
  if(Array.isArray(v)){if(v.length>5000)throw new AppError(`${path}数组过长`);v.forEach((x,i)=>validateJson(x,`${path}[${i}]`,depth+1));return;}
  if(v&&typeof v==='object'){
    for(const [k,x]of Object.entries(v)){
      if(['__proto__','prototype','constructor'].includes(k))throw new AppError(`${path}含不支持的字段名`);
      if((k==='website'||k==='url'||k.endsWith('_url'))&&typeof x==='string'&&x!=='')httpUrl(x,`${path}.${k}`);
      if(k==='source_urls'||k.endsWith('_source_urls')){if(!Array.isArray(x))throw new AppError(`${path}.${k}需要链接数组`);x.forEach((u,i)=>httpUrl(u,`${path}.${k}[${i}]`));}
      validateJson(x,`${path}.${k}`,depth+1);
    }return;
  }
  throw new AppError(`${path}包含不支持的数据类型`);
}
/** Structured optional research fields also survive ordinary account/project edits. */
export function researchField(value:any,field:string){validateJson({[field]:value});return structuredClone(value);}
export const countryAccountTextFields=['source_id','country_code','region','original_city','original_region','grade','original_grade','pool','segment','type','contact_route','contact_level','fit_fact','first_question_zh','function_to_ask','procurement_status','contact_url','fit_url','evidence_quality','evidence_stage','customer_evidence_stage','product_scope','product_fit','large_c_route','limitations','signal_date','messaging','group_id','counting_status','normalized_domain','normalized_company_name','normalization_confidence','unresolved_fields'];
export const countryAccountStructuredFields=['source_urls','contact_routes','evidence','locations','service_regions','research_raw','research_recommendations'];
export const countryProjectFields=['source_id','country_code','region','city','cities','cities_text','project_id','lot','parent_project_id','budget_uzs','tender_url','stage','source_stage','date','source_date_note','procurement_path','contact','source_grade','verified_fact','valve_relevance_inference','limitations','additional_source_urls','source_urls','owner','route_ids','account_link_note','research_raw','research_recommendations'];
function projectBasics(raw:Item){
  const canonical=['待核实','前期规划','招标','已授标','施工中','已完成','取消'];
  const source_stage=text(raw.stage||raw.phase,2000);
  let phase=canonical.includes(raw.phase)?raw.phase:'待核实';
  if(!canonical.includes(raw.phase)){
    if(/^(已开始工程|已开工|施工中|正在施工|官方现场消息称已开始工程)/.test(source_stage))phase='施工中';
    else if(/^(Early Market Engagement|早期市场沟通|前期规划)/i.test(source_stage))phase='前期规划';
  }
  return {phase,source_stage,source_date_note:text(raw.date,2000),procurement_status:text(raw.procurement_status,500)||'公开项目信息；当前阀门RFQ未核',date_basis:raw.date_basis==='已确认'?'已确认':'估计待核',window_start:validDate(raw.window_start,'采购窗口开始'),window_end:validDate(raw.window_end,'采购窗口结束'),requirements:text(raw.requirements||raw.valve_relevance_inference,6000),note:text(raw.note||raw.limitations,6000)};
}

function sourceId(raw:Item,code:string,label:string){
  let id=required(raw.source_id||raw.id,`${label}来源ID`,80);if(id.startsWith(code+'-'))id=id.slice(code.length+1);
  if(!/^[\w-]{1,64}$/.test(id))throw new AppError(`${label}来源ID只能使用字母、数字、下划线或连字符，最长64字`);
  return {source_id:id,id:code+'-'+id};
}
const operatorFields=['status','owner','next_action','next_date','follow_up_date','reply','stop','states','activities','tasks','contacts','letters','communication'];
const knownAccountFields=new Set(['id','name','country','city','role','email','phone','url','website','domain','address','queue','note','writing_fact','writing_source','product_focus','verification','verified_on','verified_at','verification_date','socials',...countryAccountTextFields,...countryAccountStructuredFields,...operatorFields]);
function accountValue(raw:Item,code:string,country:string,kind:'account'|'route',warnings:string[],preserved:Item[],extra:Item[]):Item{
  const ids=sourceId(raw,code,kind==='account'?'客户':'区域入口');
  const value:Item={...ids,name:required(raw.name,'企业或入口名称',300),country_code:code,country,country_name:country};
  for(const f of countryAccountTextFields)if(raw[f]!==undefined)value[f]=text(raw[f]);
  for(const f of countryAccountStructuredFields)if(raw[f]!==undefined)value[f]=researchField(raw[f],f);
  for(const f of ['city','role','email','phone','address','queue','note','verification'])if(raw[f]!==undefined)value[f]=text(raw[f]);
  value.id=ids.id;value.source_id=ids.source_id;value.country_code=code;
  value.url=httpUrl(raw.website||raw.url||'','企业官网');
  value.domain=text(raw.domain||raw.normalized_domain,300);
  value.grade=['S','A','B','C'].includes(raw.grade)?raw.grade:'C';
  if(raw.grade!==undefined&&!['S','A','B','C'].includes(raw.grade))throw new AppError(`${value.name}的最终研究级别应为S/A/B/C`);
  if(raw.grade===undefined)warnings.push(`${value.name}没有最终grade，暂列C；未采用priority_suggestion代替最终分级。`);
  value.contact_url=httpUrl(raw.contact_url||'');value.fit_url=httpUrl(raw.fit_url||'');
  value.source_urls=Array.isArray(raw.source_urls)?raw.source_urls.map((u:any)=>httpUrl(u)):[];
  value.writing_fact=text(raw.writing_fact||raw.fit_fact);
  value.writing_source=httpUrl(raw.writing_source||raw.fit_url||value.source_urls[0]||'');
  value.product_focus=text(raw.product_focus||raw.product_fit||raw.product_scope);
  value.verified_on=validDate(raw.verified_on||raw.verified_at||raw.verification_date||'','内容核验日期');
  value.contact_route=text(raw.contact_route||raw.contact_level||raw.function_to_ask);
  if(raw.socials){object(raw.socials,'社媒入口');value.socials={};for(const [s,u]of Object.entries(raw.socials)){value.socials[s]=s==='wechat'?text(u,300):httpUrl(u,`社媒${s}`);}}
  const recommendations:Item={};for(const f of operatorFields)if(raw[f]!==undefined)recommendations[f]=structuredClone(raw[f]);
  value.research_recommendations={...(value.research_recommendations||{}),...recommendations};
  value.research_raw=structuredClone(raw);
  const blocked=operatorFields.filter(f=>raw[f]!==undefined);if(blocked.length)preserved.push({kind,id:ids.id,fields:blocked,note:'仅保留为研究参考，不迁入经营状态或沟通记录'});
  const extras=Object.keys(raw).filter(f=>!knownAccountFields.has(f));if(extras.length)extra.push({kind,id:ids.id,fields:extras,storage:'research_raw'});
  return value;
}

async function planCountryImport(input:Item){
  object(input,'导入请求');const portfolio=object(input.portfolio,'portfolio');
  const country_code=required(input.country_code,'国家代码',2).toUpperCase();if(!/^[A-Z]{2}$/.test(country_code))throw new AppError('国家代码需要两位英文字母，例如UZ');
  const country_name=required(input.country_name,'国家名称',100);
  if(new TextEncoder().encode(JSON.stringify(input)).byteLength>1150000)throw new AppError('本批研究资料请控制在1.15MB以内',413);
  validateJson(portfolio,'portfolio');
  for(const field of ['region_plans','coverage','methods'])if(portfolio[field]!==undefined&&!Array.isArray(portfolio[field]))throw new AppError(`${field}需要数组`);
  for(const field of ['customs','qa','original_qa'])if(portfolio[field]!==undefined)object(portfolio[field],field);
  for(const field of ['date','source_date'])if(portfolio[field]!==undefined&&typeof portfolio[field]!=='string')throw new AppError(`${field}需要原研究日期文字`);
  const arrays=(field:string,max=500)=>{const v=portfolio[field]??[];if(!Array.isArray(v)||v.length>max)throw new AppError(`${field}需要数组，单批最多${max}条`);return v as Item[];};
  const accounts=arrays('accounts'),utilities=arrays('utilities'),routes=arrays('routes'),projects=arrays('projects');
  if(utilities.length&&routes.length)throw new AppError('utilities与routes请仅提供一种入口数组，避免重复导入');
  const routeInputs=utilities.length?utilities:routes;
  if(accounts.length+routeInputs.length+projects.length>1000)throw new AppError('单批客户、入口及项目合计最多1000条');
  const digest=await hash({country_code,country_name,portfolio});
  const batch_id=input.batch_id===undefined?`country-${country_code}-${digest.slice(0,24)}`:required(input.batch_id,'批次编号',120);
  const rows=(await db().prepare('SELECT * FROM records ORDER BY key').all<Row>()).results||[];
  const rowMap=new Map(rows.map(r=>[r.key,r])),records=new Map(rows.map(r=>[r.key,parse(r)]));
  const warnings:string[]=[],operator_fields_preserved:Item[]=[],retained_extra_fields:Item[]=[],changes:Change[]=[];
  const mapping:Item={accounts:{},routes:{},projects:{}};
  const snapshots=new Map<string,Row|null>();
  const track=(k:string)=>{if(!snapshots.has(k))snapshots.set(k,rowMap.get(k)||null);};
  const add=(kind:Kind,value:Item)=>{
    const k=key(kind,value.id);track(k);const before=records.get(k)||null;
    const merged=before?{...cleanRecord(before),...value}:value;
    const fields=historyChanges(before,merged).map(x=>x.field);
    const action=before?(fields.length?'update':'unchanged'):'add';
    changes.push({kind,id:value.id,source_id:value.source_id||country_code,name:value.name||country_name,action,fields,revision:before?._revision||0,value:merged,before});
  };
  const seen=new Set<string>(),names=new Set<string>();
  for(const raw of accounts){
    object(raw,'客户资料');const value=accountValue(raw,country_code,country_name,'account',warnings,operator_fields_preserved,retained_extra_fields);
    if(seen.has(value.id))throw new AppError(`来源ID重复：${value.source_id}`);seen.add(value.id);
    const name=normalized(value.name);if(names.has(name))throw new AppError(`同批存在重复企业名称：${value.name}`);names.add(name);
    const conflicts=rows.filter(r=>r.kind==='account').map(parse).filter(a=>a.id!==value.id&&(a.country_code===country_code||normalized(a.country)===normalized(country_name))&&normalized(a.name)===name);
    if(conflicts.length)throw new AppError(`${value.name}与已有客户${conflicts.map(x=>x.id).join('、')}重名，请核实稳定来源ID后再导入`,409);
    mapping.accounts[value.source_id]=value.id;add('account',value);
    track(key('state',value.id));
    if(!records.has(key('account',value.id))&&records.has(key('state',value.id)))throw new AppError(`${value.id}已有孤立经营状态，请先核对编号`,409);
  }
  for(const raw of routeInputs){object(raw,'区域入口');const value=accountValue(raw,country_code,country_name,'route',warnings,operator_fields_preserved,retained_extra_fields);if(seen.has(value.id))throw new AppError(`来源ID重复：${value.source_id}`);seen.add(value.id);mapping.routes[value.source_id]=value.id;add('route',value);}
  const resolveLink=(ref:any,label:string)=>{
    const id=required(ref,label,80);const mapped=mapping.accounts[id]||id;
    const actual=mapping.accounts[id.startsWith(country_code+'-')?id.slice(country_code.length+1):id]||mapped;
    if(!changes.some(c=>c.kind==='account'&&c.id===actual)&&!records.has(key('account',actual)))throw new AppError(`${label}引用了不存在的客户：${id}`);
    track(key('account',actual));return actual;
  };
  const projectIds=new Set<string>();
  for(const raw of projects){
    object(raw,'项目资料');const ids=sourceId(raw,country_code,'项目');if(projectIds.has(ids.id))throw new AppError(`项目来源ID重复：${ids.source_id}`);projectIds.add(ids.id);mapping.projects[ids.source_id]=ids.id;
    const links:Item[]=[];const linkIds=new Set<string>();
    const pushLink=(ref:any,role:any)=>{const account_id=resolveLink(ref,'项目参与客户');if(linkIds.has(account_id))throw new AppError(`${ids.source_id}重复关联同一客户，请合并参与角色`);linkIds.add(account_id);links.push({account_id,role:required(role||'项目相关单位，采购角色待核','项目参与角色',150)});};
    if(raw.links!==undefined&&!Array.isArray(raw.links))throw new AppError('项目links需要数组');
    for(const link of raw.links||[]){object(link,'项目关联');pushLink(link.account_id,link.role);}
    let account_link_note='';const route_ids:string[]=[];
    if(raw.account_id){
      const ref=text(raw.account_id,300);
      if(/^[\w-]{1,80}$/.test(ref)){
        const routeId=mapping.routes[ref]||mapping.routes[ref.startsWith(country_code+'-')?ref.slice(country_code.length+1):ref];
        if(routeId)route_ids.push(routeId);
        else if(!links.some(l=>l.account_id===(mapping.accounts[ref]||ref)))pushLink(ref,raw.account_role||'项目相关单位，采购角色待核');
      }else{account_link_note=ref;warnings.push(`${raw.name||ids.source_id}尚未确定关联企业，已保留原始说明，未自动关联客户。`);}
    }
    const value:Item={...ids,name:required(raw.name,'项目名称',300),country_code,country:country_name,source_url:httpUrl(raw.source_url||''),source_date:raw.source_date?validDate(raw.source_date,'项目来源日期'):'',verified_on:raw.verified_on?validDate(raw.verified_on,'项目核验日期'):'',...projectBasics(raw),links,route_ids,account_link_note};
    for(const f of countryProjectFields)if(raw[f]!==undefined&&!['source_id','country_code','route_ids','account_link_note','research_raw','research_recommendations'].includes(f))value[f]=researchField(raw[f],f);
    value.location=text(raw.location||raw.cities_text||(Array.isArray(raw.cities)?raw.cities.join('；'):raw.city),1000);
    value.research_recommendations={next_action:raw.next_action||''};value.research_raw=structuredClone(raw);
    const previous=records.get(key('project',ids.id));
    if(previous){
      const previousSource=previous.research_raw?projectBasics(previous.research_raw):null;
      const manualFields=['phase','procurement_status','window_start','window_end','date_basis','requirements','note'].filter(f=>previous[f]!==undefined&&(!previousSource||stable(previous[f])!==stable((previousSource as Item)[f])));
      for(const f of manualFields)value[f]=previous[f];
      if(manualFields.length)operator_fields_preserved.push({kind:'project',id:ids.id,fields:manualFields,note:'保留上次导入后人工修改的项目字段；最新公开事实另存source_stage/research_raw'});
    }
    if(value.window_start&&value.window_end&&value.window_start>value.window_end)throw new AppError('项目采购窗口结束日期不能早于开始日期');
    add('project',value);
  }
  const metadata=structuredClone(portfolio);for(const f of ['accounts','utilities','routes','projects'])delete metadata[f];
  const knownRootFields=new Set(['accounts','utilities','routes','projects','date','source_date','region_plans','coverage','customs','methods','qa','original_qa']);
  const extraRootFields=Object.keys(portfolio).filter(f=>!knownRootFields.has(f));
  if(extraRootFields.length)retained_extra_fields.push({kind:'country',id:country_code,fields:extraRootFields,storage:'research_raw'});
  const unsupported_fields=extraRootFields.filter(f=>['states','contacts','letters','activities','tasks','settings'].includes(f)).map(field=>({kind:'country',field,note:'仅保留原始参考，不导入经营记录；请使用相应资料录入流程'}));
  if(unsupported_fields.length)warnings.push(`本包${unsupported_fields.map(x=>x.field).join('、')}仅保留原始参考，不迁入经营记录，请使用对应录入流程。`);
  const source_date=text(portfolio.source_date||portfolio.date,300);
  const country:Item={id:country_code,source_id:country_code,country_code,country_name,name:country_name,source_date,date:source_date,region_plans:portfolio.region_plans||portfolio.coverage||[],coverage:portfolio.region_plans||portfolio.coverage||[],customs:portfolio.customs||{},methods:portfolio.methods||[],qa:portfolio.qa||portfolio.original_qa||{},original_qa:portfolio.qa||portfolio.original_qa||{},research_raw:metadata,record_counts:{accounts:accounts.length,routes:routeInputs.length,projects:projects.length}};
  add('country',country);
  const expected={fingerprint:await hash({digest,snapshots:[...snapshots.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,r])=>({key:k,revision:r?.revision||0,data:r?.data||null,updated_at:r?.updated_at||null}))})};
  const summary:Item={};for(const [kind,label]of [['account','accounts'],['route','routes'],['project','projects'],['country','country']]as const){const group=changes.filter(x=>x.kind===kind);summary[label]={added:group.filter(x=>x.action==='add').length,updated:group.filter(x=>x.action==='update').length,unchanged:group.filter(x=>x.action==='unchanged').length};}
  return {country_code,country_name,batch_id,digest,expected,summary,changes,mapping,warnings,operator_fields_preserved,retained_extra_fields,unsupported_fields,snapshots};
}
function publicPreview(plan:Awaited<ReturnType<typeof planCountryImport>>){const {digest,snapshots,changes,...rest}=plan;return {...rest,changes:changes.map(({value,before,...x})=>x),added:changes.filter(c=>c.action==='add').length,updated:changes.filter(c=>c.action==='update').length,unchanged:changes.filter(c=>c.action==='unchanged').length};}
export async function previewCountryImport(input:Item){return publicPreview(await planCountryImport(input));}

export async function importCountryResearch(input:Item,actor:string){
  const plan=await planCountryImport(input);
  const prior=await db().prepare('SELECT hash,summary FROM import_batches WHERE id=?').bind(plan.batch_id).first<any>();
  if(prior){if(prior.hash!==plan.digest)throw new AppError('该批次编号已用于不同研究资料',409);return {...JSON.parse(prior.summary),replayed:true};}
  if(!input.expected||typeof input.expected.fingerprint!=='string')throw new AppError('请先预览国家研究资料，再确认导入');
  if(input.expected.fingerprint!==plan.expected.fingerprint)throw new AppError('预览后相关研究资料或经营状态已变化，请重新预览后确认',409);
  const ts=new Date().toISOString(),jobs:any[]=[],guardKeys:string[]=[];
  // Guard every read target inside the same transaction as mutations. A deleted, added,
  // directly changed, or revision-changed row violates revision NOT NULL and rolls back.
  const snapshots=[...plan.snapshots.entries()];
  for(let offset=0;offset<snapshots.length;offset+=20){
    const conditions:string[]=[],args:any[]=[];
    for(const [k,r]of snapshots.slice(offset,offset+20)){
      if(r){conditions.push('EXISTS(SELECT 1 FROM records WHERE key=? AND revision=? AND data=? AND updated_at=?)');args.push(k,r.revision,r.data,r.updated_at);}
      else{conditions.push('NOT EXISTS(SELECT 1 FROM records WHERE key=?)');args.push(k);}
    }
    const guardKey='country-import-guard:'+crypto.randomUUID();guardKeys.push(guardKey);
    jobs.push(db().prepare(`INSERT INTO records(key,kind,data,revision,updated_at) VALUES(?,?,'{}',CASE WHEN ${conditions.join(' AND ')} THEN 1 ELSE NULL END,?)`).bind(guardKey,'country_import_guard',...args,ts));
  }
  for(const change of plan.changes){
    if(change.action==='unchanged')continue;
    const k=key(change.kind,change.id),value=cleanRecord(change.value);
    if(change.before)jobs.push(db().prepare('UPDATE records SET data=?,revision=revision+1,updated_at=? WHERE key=? AND revision=?').bind(JSON.stringify(value),ts,k,change.revision));
    else jobs.push(db().prepare('INSERT INTO records(key,kind,data,revision,updated_at) VALUES(?,?,?,1,?)').bind(k,change.kind,JSON.stringify(value),ts));
    jobs.push(auditStatement(k,change.before?'update':'create',actor,await auditDetails(change.kind,change.before,value,{batch_id:plan.batch_id,source:'country_research_import',revision:change.revision+1}),ts));
    if(change.kind==='account'&&!change.before){
      const state={id:change.id,account_id:change.id,status:'未联系',owner:'',next_action:'',next_date:''};
      jobs.push(db().prepare('INSERT INTO records(key,kind,data,revision,updated_at) VALUES(?,?,?,1,?)').bind(key('state',change.id),'state',JSON.stringify(state),ts));
    }
  }
  for(const k of guardKeys)jobs.push(db().prepare('DELETE FROM records WHERE key=?').bind(k));
  const response={...publicPreview(plan),source:'国家研究资料导入',replayed:false,imported_at:ts};
  jobs.push(db().prepare('INSERT INTO import_batches(id,hash,summary,created_at) VALUES(?,?,?,?)').bind(plan.batch_id,plan.digest,JSON.stringify(response),ts));
  const changedAccounts=plan.changes.filter(c=>c.kind==='account'&&c.action!=='unchanged');
  jobs.push(auditStatement(plan.batch_id,'country_research_import',actor,{version:2,kind:'import',label:plan.country_name+'国家研究',country_code:plan.country_code,account_ids:changedAccounts.map(x=>x.id),accounts:changedAccounts.map(x=>({id:x.id,name:x.name})),changes:[],batch_id:plan.batch_id,summary:`导入${plan.country_name}研究：客户新增${plan.summary.accounts.added}、更新${plan.summary.accounts.updated}；区域入口新增${plan.summary.routes.added}；项目新增${plan.summary.projects.added}。`,counts:plan.summary,note:'仅迁入公开研究；保留人工阶段、负责人、停止联系与后续安排，未创建联系、任务或沟通记录。'},ts));
  try{await db().batch(jobs);}catch(error){
    const repeat=await db().prepare('SELECT hash,summary FROM import_batches WHERE id=?').bind(plan.batch_id).first<any>();
    if(repeat?.hash===plan.digest)return {...JSON.parse(repeat.summary),replayed:true};
    if(error instanceof Error&&/NOT NULL constraint failed: records.revision|UNIQUE constraint failed: records.key/.test(error.message))throw new AppError('确认过程中资料已变化，本批未写入，请重新预览',409);
    throw error;
  }
  return response;
}
