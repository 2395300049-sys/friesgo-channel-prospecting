import {useRef,useState} from 'react';
import {CheckCircle2,FileUp} from 'lucide-react';

type Item=Record<string,any>;
type Props={onRestored:()=>Promise<void>|void};
const MAX_BYTES=128*1024*1024;
const countFields=[['accounts','客户'],['states','经营状态'],['projects','项目'],['countries','国家资料'],['routes','区域入口'],['history','操作历史']] as const;

export default function BackupRestorePanel({onRestored}:Props){
  const [backup,setBackup]=useState<Item|null>(null),[filename,setFilename]=useState(''),[preview,setPreview]=useState<Item|null>(null);
  const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState(''),[success,setSuccess]=useState('');
  const fileRef=useRef<HTMLInputElement>(null),selection=useRef(0);

  async function readFile(file?:File){
    const current=++selection.current;
    setBackup(null);setPreview(null);setConfirmed(false);setError('');setSuccess('');setFilename(file?.name||'');
    if(!file)return;
    setBusy('reading');
    try{
      if(file.size>MAX_BYTES)throw Error('完整备份请控制在128MiB以内。');
      const value=JSON.parse((await file.text()).replace(/^\uFEFF/,''));
      if(!value||typeof value!=='object'||Array.isArray(value))throw Error('请选择从工作台下载的完整JSON备份。');
      if(current===selection.current)setBackup(value);
    }catch(e){
      if(current===selection.current)setError(e instanceof SyntaxError?'文件不是有效的JSON，请重新选择完整备份。':(e as Error).message);
    }finally{if(current===selection.current)setBusy('');}
  }

  async function request(restore=false){
    if(!backup||busy||restore&&(!preview?.target?.can_restore||!confirmed))return;
    setBusy(restore?'restore':'preview');setError('');setSuccess('');
    if(!restore){setPreview(null);setConfirmed(false);}
    try{
      const response=await fetch(restore?'/api/backup/restore':'/api/backup/preview',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(restore?{backup,expected:preview?.expected}:backup)
      });
      let result:Item;
      try{result=await response.json();}catch{throw Error('本地程序未返回有效结果，请确认两台电脑都已更新工作台。');}
      if(!response.ok)throw Error(result.error||'备份检查失败，请稍后重试。');
      if(!restore){
        if(!result.summary||typeof result.target?.can_restore!=='boolean'||typeof result.expected?.backup_hash!=='string'||typeof result.expected?.target_hash!=='string')throw Error('备份检查结果不完整，请更新工作台后重试。');
        setPreview(result);return;
      }
      if(result.restored!==true)throw Error('未收到迁入成功结果，请重新检查工作台数据。');
      setBackup(null);setPreview(null);setConfirmed(false);setFilename('');if(fileRef.current)fileRef.current.value='';
      setSuccess('完整备份已迁入，可打开客户库、国家资料和操作历史核对。');
      try{await onRestored();}catch{setError('备份已迁入，但页面刷新失败；请刷新浏览器查看。');}
    }catch(e){
      setError((e as Error).message);
      if(restore){setPreview(null);setConfirmed(false);}
    }finally{setBusy('');}
  }

  const summary=preview?.summary||{};
  const count=(key:string)=>typeof summary[key]==='number'?summary[key].toLocaleString('zh-CN'):'—';
  return <section className="panel resource-panel" aria-labelledby="backup-restore-title">
    <div className="section-head"><div><h2 id="backup-restore-title">迁入完整备份</h2><p className="muted small">换电脑时使用。先检查备份，再迁入当前新工作台。</p></div></div>
    <label className="file-picker"><FileUp size={20}/><span>{filename||'选择完整JSON备份（最多128MiB）'}</span><input ref={fileRef} aria-label="选择完整JSON备份" type="file" accept=".json,application/json" disabled={!!busy} onChange={e=>void readFile(e.target.files?.[0])}/></label>
    <p className="small muted">保留客户与分支、经营状态、签名、开发信、沟通记录、项目、操作历史和导入批次。文件仅交给本机工作台处理；已有经营数据时不覆盖。</p>
    {backup&&<button disabled={!!busy} onClick={()=>void request()}>{busy==='preview'?'正在检查…':'检查完整备份'}</button>}
    {busy==='reading'&&<p className="small muted" role="status">正在读取备份…</p>}
    {preview&&<div className="import-preview">
      <h3>迁入前核对</h3>
      <dl className="details">{countFields.map(([key,label])=><div key={key}><dt>{label}</dt><dd>{count(key)}</dd></div>)}<div><dt>备份时间</dt><dd>{String(summary.exported_at||'未提供')}</dd></div></dl>
      <p className="small muted">另含开发信 {count('letters')}、沟通记录 {count('activities')}、联系人 {count('contacts')}、任务 {count('tasks')}、导入批次 {count('import_batches')}。</p>
      <p role="status">{String(preview.target.reason||(preview.target.can_restore?'当前工作台可以迁入。':'当前工作台不能迁入，请使用新工作台。'))}</p>
      {preview.target.can_restore===true&&<><label className="word-include-letter"><input type="checkbox" checked={confirmed} disabled={!!busy} onChange={e=>setConfirmed(e.target.checked)}/> 将这份完整备份迁入当前新工作台</label><div className="button-row"><button className="primary" disabled={!!busy||!confirmed} onClick={()=>void request(true)}>{busy==='restore'?'正在迁入…':'确认迁入完整备份'}</button></div></>}
    </div>}
    {error&&<p className="country-import-error" role="alert">{error}</p>}
    {success&&<p className="word-success" role="status"><CheckCircle2 size={17}/>{success}</p>}
  </section>;
}
