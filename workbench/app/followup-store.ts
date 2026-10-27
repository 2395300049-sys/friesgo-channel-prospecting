import {env} from 'cloudflare:workers';
import {AppError} from './errors';
import {auditDetails,auditStatement,historyChanges} from './history-store';
import {validWorkDay,workDay} from './followup-model';
type Item=Record<string,any>;
const db=()=>{if(!env.DB)throw new AppError('数据库尚未连接',503);return env.DB;};
const clean=(value:Item)=>Object.fromEntries(Object.entries(value).filter(([key])=>!key.startsWith('_')));
async function read(kind:string,id:string){const row=await db().prepare('SELECT * FROM records WHERE key=?').bind(kind+':'+id).first<any>();return row?{...JSON.parse(row.data),_revision:row.revision}:null;}
function required(value:any,label:string,max:number){if(typeof value!=='string'||!value.trim()||value.length>max)throw new AppError(`${label}不能为空，且不可超过${max}字`);return value.trim();}
async function followupId(account:string,day:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(account+'|'+day));return 'followup-'+Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,40);}
async function context(input:Item){
  const id=required(input.account_id,'客户ID',80),account=await read('account',id);if(!account)throw new AppError('客户不存在',404);
  const state=await read('state',id);return {id,account,state};
}
async function writeJobs(kind:string,id:string,before:Item|null,after:Item,actor:string,ts:string){
  const value=clean(after);if(before&&!historyChanges(before,value).length)return [];
  const key=kind+':'+id;
  const mutation=before?db().prepare('UPDATE records SET data=?,revision=CASE WHEN revision=? THEN revision+1 ELSE NULL END,updated_at=? WHERE key=?').bind(JSON.stringify(value),before._revision,ts,key):db().prepare('INSERT INTO records(key,kind,data,revision,updated_at) VALUES(?,?,?,1,?)').bind(key,kind,JSON.stringify(value),ts);
  return [mutation,auditStatement(key,before?'update':'create',actor,await auditDetails(kind,before,value,{revision:(before?._revision||0)+1,source:'manual_followup'}),ts)];
}
async function commit(jobs:any[]){try{if(jobs.length)await db().batch(jobs);}catch(error){if(error instanceof Error&&/records.revision|UNIQUE constraint failed: records.key/.test(error.message))throw new AppError('跟进记录已变化，请刷新后重试',409);throw error;}}
function guardedState(id:string,state:Item|null,ts:string,jobs:any[]){
  const guard='followup-guard:'+crypto.randomUUID();
  const condition=state?'EXISTS(SELECT 1 FROM records WHERE key=? AND revision=?)':'NOT EXISTS(SELECT 1 FROM records WHERE key=?)';
  return [db().prepare(`INSERT INTO records(key,kind,data,revision,updated_at) VALUES(?,'followup_guard','{}',CASE WHEN ${condition} THEN 1 ELSE NULL END,?)`).bind(guard,'state:'+id,...(state?[state._revision]:[]),ts),...jobs,db().prepare('DELETE FROM records WHERE key=?').bind(guard)];
}
function followupValue(id:string,account:string,day:string,done:boolean,before:Item|null,ts:string){return {id,account_id:account,kind:'followup',channel:'人工标记',summary:before?.summary||'人工标记已完成跟进；具体渠道和内容可在跟进记录中补充。',occurred_on:day,status:done?'done':'cancelled',created_at:before?.created_at||ts};}
export async function setFollowup(input:Item,actor:string){
  const {id,state}=await context(input),day=input.occurred_on||workDay();
  if(!validWorkDay(day)||day>workDay())throw new AppError('跟进日期需要有效日期，且不能晚于今天');
  if(typeof input.done!=='boolean')throw new AppError('请明确完成或撤销跟进');
  if(input.done&&state?.status==='停止联系')throw new AppError('客户已停止联系，请先核对并更新阶段');
  const recordId=await followupId(id,day),before=await read('activity',recordId);
  if(!before&&!input.done)return {unchanged:true};
  if(before?.status===(input.done?'done':'cancelled'))return before;
  if(before&&input._revision!==before._revision)throw new AppError('跟进记录已变化，请刷新后重试',409);
  const ts=new Date().toISOString(),after=followupValue(recordId,id,day,input.done,before,ts);
  try{await commit(guardedState(id,state,ts,await writeJobs('activity',recordId,before,after,actor,ts)));}
  catch(error){const current=await read('activity',recordId);if(current?.status===after.status)return current;throw error;}
  return read('activity',recordId);
}
export async function saveInterest(input:Item,actor:string){
  const {id,state}=await context(input);
  if(!state||input._revision!==state._revision)throw new AppError('客户阶段已变化，请刷新后重试',409);
  if(state.status==='停止联系')throw new AppError('客户已停止联系，请先核对并更新阶段');
  const interest_note=required(input.interest_note,'回复或需求摘要',4000),next_action=required(input.next_action,'下一步动作',1000),next_date=input.next_date;
  if(!validWorkDay(next_date)||next_date<workDay())throw new AppError('请设置今天或之后的下次跟进日期');
  const ts=new Date().toISOString(),day=workDay(),recordId=await followupId(id,day),priorFollowup=await read('activity',recordId);
  const after={...clean(state),status:'意向客户',interest_note,interest_on:state.interest_on||day,next_action,next_date};
  const followup=followupValue(recordId,id,day,true,priorFollowup,ts);
  followup.summary='意向跟进：'+interest_note+'\n下一步：'+next_action+'（'+next_date+'）';
  await commit(guardedState(id,state,ts,[...(await writeJobs('state',id,state,after,actor,ts)),...(await writeJobs('activity',recordId,priorFollowup,followup,actor,ts))]));
  return read('state',id);
}
