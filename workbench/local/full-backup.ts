import {createHash} from 'node:crypto';
import seed from '../app/seed.json';
import {AppError} from '../app/errors';
import {databaseSnapshot,databaseTransaction} from './database';

type Row=Record<string,any>;
type Tables={records:Row[],audit_events:Row[],import_batches:Row[]};
const columns={records:['key','kind','data','revision','updated_at'],audit_events:['id','entity_key','action','actor','details','created_at'],import_batches:['id','hash','summary','created_at']} as const;
const kinds=new Set(['account','state','contact','letter','activity','task','project','country','route','settings']);
const resources={replies:seed.replies,tech:seed.tech,channels:seed.channels,russian:seed.russian};
const stable=(value:any):string=>value===undefined?'null':JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(x=>JSON.parse(stable(x))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(stable(value[k]))])):value);
const hash=(value:any)=>createHash('sha256').update(stable(value)).digest('hex');
const fail=(message:string):never=>{throw new AppError(message);};
const object=(v:any)=>v&&typeof v==='object'&&!Array.isArray(v);
const timestamp=(v:any)=>typeof v==='string'&&!!v&&!Number.isNaN(Date.parse(v));

function summary(tables:Tables,exported_at=''){
  const counts:Row={accounts:0,states:0,contacts:0,letters:0,activities:0,tasks:0,projects:0,countries:0,routes:0};
  const names:Row={account:'accounts',state:'states',contact:'contacts',letter:'letters',activity:'activities',task:'tasks',project:'projects',country:'countries',route:'routes'};
  for(const r of tables.records)if(names[r.kind])counts[names[r.kind]]++;
  return {...counts,records:tables.records.length,history:tables.audit_events.length,import_batches:tables.import_batches.length,exported_at};
}

function validate(input:any){
  if(!object(input)||input.format!=='friesgo-full-backup'||input.schema_version!==3)fail('请选择新版完整迁移备份；旧研究JSON或旧版备份不能整库恢复，请在原电脑重新导出。');
  if(!timestamp(input.exported_at)||!object(input.tables))fail('备份格式不完整');
  const tables={} as Tables;
  for(const table of Object.keys(columns) as (keyof Tables)[]){
    const rows=input.tables[table];if(!Array.isArray(rows)||rows.length>200000)fail('备份数据表无效或记录过多：'+table);
    const ids=new Set<string>();
    tables[table]=rows.map((r:any)=>{
      const fields:readonly string[]=columns[table];
      if(!object(r)||Object.keys(r).length!==fields.length||Object.keys(r).some(k=>!fields.includes(k)))fail('备份数据行格式无效：'+table);
      for(const field of fields){
        if(field==='revision'){if(!Number.isSafeInteger(r[field])||r[field]<1)fail('备份版本号无效');}
        else if(typeof r[field]!=='string')fail('备份字段需要文字：'+field);
      }
      const id=r[table==='records'?'key':'id'];if(!id||ids.has(id))fail('备份包含重复或空编号：'+table);ids.add(id);
      if(!timestamp(r[table==='records'?'updated_at':'created_at']))fail('备份记录时间无效');
      const jsonField=table==='records'?'data':table==='audit_events'?'details':'summary';
      let parsed;try{parsed=JSON.parse(r[jsonField]);}catch{fail('备份记录JSON损坏');}
      if(!object(parsed))fail('备份记录内容无效');
      if(table==='records'&&(!kinds.has(r.kind)||typeof parsed.id!=='string'||r.key!==r.kind+':'+parsed.id))fail('备份客户或资料编号不一致');
      return Object.fromEntries(fields.map(k=>[k,r[k]]));
    }).sort((a:Row,b:Row)=>Buffer.compare(Buffer.from(a[table==='records'?'key':'id']),Buffer.from(b[table==='records'?'key':'id'])));
  }
  const parsed=tables.records.map(r=>({kind:r.kind,value:JSON.parse(r.data)}));
  const accounts=new Set(parsed.filter(r=>r.kind==='account').map(r=>r.value.id));
  const letters=new Map(parsed.filter(r=>r.kind==='letter').map(r=>[r.value.id,r.value]));
  for(const {kind,value} of parsed){
    if(['state','contact','letter','activity','task'].includes(kind)&&!accounts.has(value.account_id))fail('备份存在悬空客户引用：'+value.id);
    if(kind==='state'&&value.id!==value.account_id)fail('备份客户阶段编号不一致');
    if(kind==='project'){
      if(value.links!==undefined&&!Array.isArray(value.links))fail('备份项目关联无效');
      for(const link of value.links||[])if(!object(link)||!accounts.has(link.account_id))fail('备份项目关联的客户不存在');
    }
    if(kind==='activity'&&value.letter_id&&(!letters.has(value.letter_id)||letters.get(value.letter_id).account_id!==value.account_id))fail('备份沟通记录与开发信不匹配');
  }
  if(parsed.filter(r=>r.kind==='state').length!==accounts.size||!parsed.some(r=>r.kind==='settings'&&r.value.id==='main'))fail('备份缺少客户阶段或工作台设置');
  if(!tables.import_batches.some(r=>r.id===seed.batch_id&&r.hash==='initial'))fail('备份缺少初始批次，无法安全恢复');
  if(!object(input.resources)||hash(input.resources)!==hash(resources))fail('备份参考资料版本不匹配，请使用与原电脑一致的最新版程序。');
  const payload={format:input.format,schema_version:input.schema_version,exported_at:input.exported_at,tables,resources:input.resources};
  if(typeof input.checksum!=='string'||hash(payload)!==input.checksum)fail('备份校验失败，文件可能不完整或被修改；请重新导出。');
  return {tables,payload,summary:summary(tables,input.exported_at),backupHash:input.checksum};
}

function freshTarget(tables:Tables){
  const initial=new Map<string,any>();
  for(const a of seed.accounts){initial.set('account:'+a.id,a);initial.set('state:'+a.id,{id:a.id,account_id:a.id,status:'未联系',owner:'',next_action:a.note,next_date:''});}
  for(const l of seed.letters)initial.set('letter:'+l.id,l);
  initial.set('settings:main',{id:'main',name:'',position:'Sales Contact',website:'',whatsapp:'',email:'',company:'FriesGo Global'});
  return tables.records.length===initial.size&&tables.records.every(r=>r.revision===1&&initial.has(r.key)&&hash(JSON.parse(r.data))===hash(initial.get(r.key)))&&tables.import_batches.length===1&&tables.import_batches[0].id===seed.batch_id&&tables.import_batches[0].hash==='initial'&&tables.audit_events.every(r=>['initial_import','history_enabled','export_backup','export_history','export_word','export_followups'].includes(r.action));
}

export function createFullBackup(){
  return databaseTransaction(()=>{
    const snapshot=databaseSnapshot() as Tables;
    const payload={format:'friesgo-full-backup',schema_version:3,exported_at:new Date().toISOString(),tables:snapshot,resources};
    return {...payload,checksum:hash(payload)};
  });
}

export function previewFullBackup(input:any){
  const validated=validate(input),target=databaseSnapshot() as Tables,can_restore=freshTarget(target);
  return {summary:validated.summary,target:{can_restore,reason:can_restore?'当前是尚未录入数据的新工作台，可以迁入完整备份。':'当前工作台已有数据或改动，不能覆盖。请在未录入数据的新工作台恢复。'},expected:{backup_hash:validated.backupHash,target_hash:hash(target)}};
}

export function restoreFullBackup(input:any,expected:any){
  const validated=validate(input);
  if(!object(expected)||expected.backup_hash!==validated.backupHash||typeof expected.target_hash!=='string')throw new AppError('请先核对这份完整备份，再确认迁入',409);
  return databaseTransaction(database=>{
    const target=databaseSnapshot() as Tables;
    if(hash(target)===hash(validated.tables))return {restored:true,replayed:true,summary:validated.summary};
    if(hash(target)!==expected.target_hash)throw new AppError('当前工作台已变化，请重新核对后迁入',409);
    if(!freshTarget(target))throw new AppError('当前工作台已有数据或改动，不能覆盖',409);
    database.exec('DELETE FROM records; DELETE FROM audit_events; DELETE FROM import_batches;');
    for(const table of Object.keys(columns) as (keyof Tables)[]){
      const fields:readonly string[]=columns[table],statement=database.prepare(`INSERT INTO ${table}(${fields.join(',')}) VALUES(${fields.map(()=>'?').join(',')})`);
      for(const row of validated.tables[table])statement.run(...fields.map(k=>row[k]));
    }
    return {restored:true,replayed:false,summary:validated.summary};
  });
}
