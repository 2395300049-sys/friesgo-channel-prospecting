import {env} from 'cloudflare:workers';
import {AppError} from './errors';
import {historyKinds,historyActions,historyFields} from './history-format';
type Item=Record<string,any>;
const db=()=>{if(!env.DB)throw new AppError('数据库尚未连接',503);return env.DB;};
const clean=(x:Item|null)=>x?Object.fromEntries(Object.entries(x).filter(([k])=>!k.startsWith('_'))):null;
const stable=(v:any):string=>v&&typeof v==='object'?JSON.stringify(Array.isArray(v)?v.map(x=>JSON.parse(stable(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(stable(v[k]))]))):JSON.stringify(v??null);
export function historyChanges(before:Item|null,after:Item|null){return [...new Set([...Object.keys(before||{}),...Object.keys(after||{})])].filter(k=>!k.startsWith('_')&&!['id','account_id','created_at'].includes(k)&&stable(before?.[k])!==stable(after?.[k])).map(field=>({field,label:historyFields[field]||field,before:before?.[field]??null,after:after?.[field]??null}));}
export async function auditDetails(kind:string,before:Item|null,after:Item|null,extra:Item={}){
  const accountIds=[...new Set([...(kind==='account'||kind==='state'?[after?.id||before?.id]:[]),before?.account_id,after?.account_id,...(before?.links||[]).map((x:Item)=>x.account_id),...(after?.links||[]).map((x:Item)=>x.account_id)].filter(Boolean))] as string[];
  const accounts:Item[]=[];
  for(const id of accountIds){const r=await db().prepare('SELECT data FROM records WHERE key=?').bind('account:'+id).first<any>();accounts.push({id,name:kind==='account'&&after?.id===id?after.name:r?JSON.parse(r.data).name:id});}
    const label=kind==='settings'?'业务员签名':kind==='state'?accounts[0]?.name:kind==='letter'?after?.subject:kind==='activity'?(after?.summary||'沟通记录').slice(0,90):after?.name||after?.title||before?.name||before?.title||historyKinds[kind];
  const fieldLabels:Record<string,string>=kind==='state'?{status:'客户阶段'}:kind==='task'?{title:'任务内容',status:'任务状态'}:kind==='contact'?{name:'联系人或部门',title:'职位'}:kind==='settings'?{name:'英文姓名'}:kind==='project'?{name:'项目名称',owner:'项目业主'}:kind==='account'?{name:'公司名称'}:{};
  const changes=historyChanges(before,after).map(c=>({...c,label:fieldLabels[c.field]||c.label}));
  const summary=kind==='task'&&before&&after?.status==='done'&&before.status!=='done'?'完成任务 · '+after.title:kind==='state'&&before?.next_action&&!after?.next_action?'完成跟进安排 · '+(accounts[0]?.name||'客户'):undefined;
  return {version:2,kind,label,account_ids:accountIds,accounts,before:clean(before),after:clean(after),changes,...(summary?{summary}:{}),...extra};
}
export function auditStatement(entityKey:string,action:string,actor:string,details:Item,createdAt=new Date().toISOString(),id=crypto.randomUUID()){
  return db().prepare('INSERT INTO audit_events(id,entity_key,action,actor,details,created_at) VALUES(?,?,?,?,?,?)').bind(id,entityKey,action,actor,JSON.stringify(details),createdAt);
}
export async function recordEvent(action:string,actor:string,details:Item){await auditStatement(details.entity_key||details.kind||'system',action,actor,{version:2,account_ids:[],accounts:[],changes:[],...details}).run();}
export async function initializeHistory(){
  const imports=(await db().prepare('SELECT * FROM import_batches WHERE hash=?').bind('initial').all<any>()).results;
  for(const batch of imports){const summary=JSON.parse(batch.summary);await db().prepare('INSERT OR IGNORE INTO audit_events(id,entity_key,action,actor,details,created_at) VALUES(?,?,?,?,?,?)').bind('initial-history-'+batch.id,batch.id,'initial_import','system',JSON.stringify({version:2,kind:'import',label:'初始化客户开发工作册',account_ids:[],accounts:[],changes:[],summary:`导入 ${summary.accounts||24} 家客户、${summary.letters||24} 封双语开发信。`,reconstructed:true}),batch.created_at).run();}
  await db().prepare('INSERT OR IGNORE INTO audit_events(id,entity_key,action,actor,details,created_at) VALUES(?,?,?,?,?,?)').bind('history-v2-enabled','system:history','history_enabled','system',JSON.stringify({version:2,kind:'system',label:'启用操作历史',account_ids:[],accounts:[],changes:[],summary:'启用操作历史',note:'从现在起保存资料修改前后、导入、草稿复制与导出记录。旧日志保持原有内容。'}),new Date().toISOString()).run();
}
function normalize(row:Item):Item{
  const {current_record,current_account_name,...auditRow}=row,details=JSON.parse(row.details);
  const kind=details.kind||(row.action==='research_import'?'import':row.entity_key.split(':')[0]),legacy=details.version!==2;
  const current=current_record?JSON.parse(current_record):null;
  const accountId=kind==='account'||kind==='state'?current?.id:current?.account_id;
  const accounts=details.accounts||(legacy&&accountId?[{id:accountId,name:current_account_name||accountId}]:[]);
  const label=details.label||(legacy?(kind==='settings'?'业务员签名':kind==='account'||kind==='state'?current_account_name:current?.name||current?.title||details.source):'');
  const operation=['create','update'].includes(row.action)?(historyActions[row.action]+(historyKinds[kind]||'记录')):(historyActions[row.action]||'操作');
  return {...auditRow,details,kind:historyKinds[kind]?kind:'system',kind_label:historyKinds[kind]||'系统记录',action_label:historyActions[row.action]||row.action,legacy,summary:details.summary||`${operation}${label&&label!==historyKinds[kind]?' · '+label:''}`,accounts,changes:details.changes||[]};
}
function day(value:any){if(!value)return '';if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00+08:00'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw new AppError('历史日期无效');return value;}
function queryParts(input:Item){
  const where:string[]=[],args:any[]=[];const from=day(input.from),to=day(input.to);if(from&&to&&from>to)throw new AppError('开始日期不能晚于结束日期');
  if(from){where.push('h.created_at>=?');args.push(new Date(from+'T00:00:00+08:00').toISOString());}
  if(to){where.push('h.created_at<?');args.push(new Date(Date.parse(to+'T00:00:00+08:00')+86400000).toISOString());}
  if(input.account_id){where.push("(h.entity_key IN (?,?) OR json_extract(r.data,'$.account_id')=? OR EXISTS(SELECT 1 FROM json_each(h.details,'$.account_ids') a WHERE a.value=?))");args.push('account:'+input.account_id,'state:'+input.account_id,input.account_id,input.account_id);}
  if(input.kind){if(!historyKinds[input.kind])throw new AppError('历史类型无效');where.push("COALESCE(json_extract(h.details,'$.kind'),CASE WHEN h.action='research_import' THEN 'import' ELSE substr(h.entity_key,1,instr(h.entity_key,':')-1) END)=?");args.push(input.kind);}
  if(input.action){if(!historyActions[input.action])throw new AppError('历史操作无效');where.push('h.action=?');args.push(input.action);}
  if(input.q){if(typeof input.q!=='string'||input.q.length>200)throw new AppError('搜索词最长200字');where.push("(instr(lower(h.entity_key),lower(?))>0 OR EXISTS(SELECT 1 FROM json_tree(h.details) t WHERE t.type='text' AND instr(lower(t.atom),lower(?))>0) OR instr(lower(COALESCE(json_extract(a.data,'$.name'),'')),lower(?))>0)");args.push(input.q.trim(),input.q.trim(),input.q.trim());}
  return {where,args};
}
const base="FROM audit_events h LEFT JOIN records r ON r.key=h.entity_key LEFT JOIN records a ON a.key=CASE WHEN r.kind IN ('account','state') THEN 'account:'||json_extract(r.data,'$.id') ELSE 'account:'||json_extract(r.data,'$.account_id') END";
export async function readHistory(input:Item={}){
  await initializeHistory();const {where,args}=queryParts(input);const total=await db().prepare(`SELECT count(*) AS count ${base}${where.length?' WHERE '+where.join(' AND '):''}`).bind(...args).first<any>();
  const limit=Number(input.limit||50);if(!Number.isInteger(limit)||limit<1||limit>100)throw new AppError('历史分页大小无效');
  if(input.cursor){let c:Item;try{c=JSON.parse(input.cursor);if(typeof c.id!=='string'||typeof c.at!=='string'||!Number.isFinite(Date.parse(c.at)))throw Error();}catch{throw new AppError('历史分页位置无效');}where.push('(h.created_at<? OR (h.created_at=? AND h.id<?))');args.push(c.at,c.at,c.id);}
  const rows=(await db().prepare(`SELECT h.*,r.data AS current_record,json_extract(a.data,'$.name') AS current_account_name ${base}${where.length?' WHERE '+where.join(' AND '):''} ORDER BY h.created_at DESC,h.id DESC LIMIT ?`).bind(...args,limit+1).all<any>()).results;
  const more=rows.length>limit,items=rows.slice(0,limit).map(normalize),last=items.at(-1);return {items,total:total?.count||0,next_cursor:more&&last?JSON.stringify({at:last.created_at,id:last.id}):null};
}
export async function allHistory(input:Item={}){await initializeHistory();const {where,args}=queryParts(input);return (await db().prepare(`SELECT h.*,r.data AS current_record,json_extract(a.data,'$.name') AS current_account_name ${base}${where.length?' WHERE '+where.join(' AND '):''} ORDER BY h.created_at DESC,h.id DESC`).bind(...args).all<any>()).results.map(normalize);}
