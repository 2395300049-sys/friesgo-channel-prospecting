import {useRef,useState} from 'react';
import {FileUp,CheckCircle2,ArrowRight,Download} from 'lucide-react';
type Item=Record<string,any>;
type Props={onSaved:()=>Promise<void>|void};
const MAX=1000000;
function downloadTemplate(){
  const sample={country_code:'XX',country_name:'国家名称',batch_id:'XX-research-2026-01-01',portfolio:{date:'2026-01-01',accounts:[{id:'A01',name:'企业名称',country:'国家名称',city:'城市',region:'州/省',role:'暖通承包商',grade:'B',website:'https://example.com',email:'',phone:'',fit_fact:'已核业务事实',product_fit:'适配情况及待核项',source_urls:['https://example.com'],verified_on:'2026-01-01',first_question_zh:'准备向企业核实的问题',limitations:'尚未确认的内容'}],utilities:[],projects:[],region_plans:[],customs:{annual:[],monthly:[],partners_2024:[],monthly_availability:[]},methods:[]}};
  const blob=new Blob([JSON.stringify(sample,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='国家研究包_格式示例.json';a.click();URL.revokeObjectURL(url);
}
export default function CountryImportPanel({onSaved}:Props){
  const [input,setInput]=useState<Item|null>(null),[filename,setFilename]=useState(''),[preview,setPreview]=useState<Item|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[success,setSuccess]=useState('');
  const fileRef=useRef<HTMLInputElement>(null);
  async function readFile(file:File){
    setError('');setSuccess('');setPreview(null);setInput(null);setFilename(file.name);
    try{
      if(file.size>MAX)throw Error('研究包请控制在1MB以内，较大的资料可按国家或批次拆分。');
      const value=JSON.parse(await file.text());
      if(!value||typeof value!=='object'||!value.portfolio||!Array.isArray(value.portfolio.accounts))throw Error('请选择国家研究包。应包含国家代码、国家名称和 portfolio 资料；普通客户表仍使用下方 Excel/Word 入口。');
      setInput(value);
    }catch(e){setError(e instanceof SyntaxError?'文件不是有效的 JSON，请重新选择完整研究包。':(e as Error).message);}
  }
  function update(k:string,v:string){setInput(x=>x?{...x,[k]:v}:x);setPreview(null);setSuccess('');setError('');}
  async function run(confirm=false){
    if(!input)return;
    setBusy(true);setError('');setSuccess('');
    try{
      const response=await fetch('/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:confirm?'import_country_research':'preview_country_import',data:{...input,...(confirm?{expected:preview?.expected}:{})}})});
      const result:any=await response.json();if(!response.ok)throw Error(result.error||'读取失败，请稍后重试');
      if(confirm){await onSaved();setSuccess(result.replayed?'这批资料已经导入，无需重复写入。':'国家资料已导入，可在“国家与城市”查看。原有跟进安排保持不变。');setPreview(null);setInput(null);setFilename('');if(fileRef.current)fileRef.current.value='';}
      else setPreview(result);
    }catch(e){setError((e as Error).message);if(confirm)setPreview(null);}finally{setBusy(false);}
  }
  const parts=[['accounts','客户档案'],['routes','区域联系入口'],['projects','项目记录']] as const;
  return <section className="panel country-import-panel" id="country-import">
    <div className="section-head"><div><h2>导入国家研究资料</h2><p className="muted small">一次迁入客户、项目、城市研究和海关资料。先检查，再写入。</p></div><button onClick={downloadTemplate} disabled={busy}><Download size={15}/>格式示例</button></div>
    <label className="file-picker"><FileUp size={22}/><span>{filename||'选择国家研究包（.json）'}</span><input ref={fileRef} aria-label="选择国家研究包" type="file" accept=".json,application/json" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)void readFile(f);}}/></label>
    {input&&<><div className="country-import-fields"><label className="field"><span>国家名称</span><input aria-label="研究包国家名称" value={input.country_name||''} disabled={busy} onChange={e=>update('country_name',e.target.value)}/></label><label className="field"><span>国家代码</span><input aria-label="研究包国家代码" value={input.country_code||''} disabled={busy} maxLength={2} placeholder="例如 UZ" onChange={e=>update('country_code',e.target.value.toUpperCase())}/></label><div className="country-import-date"><span className="small muted">研究日期</span><strong>{input.portfolio?.date||'未提供'}</strong></div></div><button className="primary" disabled={busy||!input.country_code||!input.country_name} onClick={()=>void run()}>{busy?'正在检查…':'检查这批资料'}<ArrowRight size={15}/></button></>}
    {preview&&<div className="country-import-review"><h3>{preview.country_name} · 写入预览</h3><div className="country-table-scroll"><table className="country-import-table"><thead><tr><th>资料</th><th>新增</th><th>更新</th><th>保持原值</th></tr></thead><tbody>{parts.map(([k,label])=><tr key={k}><td>{label}</td><td>{preview.summary?.[k]?.added||0}</td><td>{preview.summary?.[k]?.updated||0}</td><td>{preview.summary?.[k]?.unchanged||0}</td></tr>)}</tbody></table></div>
      <p className="small muted">区域入口和项目单独保存，不增加客户数。负责人、销售阶段、停止联系和人工安排保持原值。</p>
      {!!preview.warnings?.length&&<details className="country-import-changes"><summary>{preview.warnings.length} 条待核事项</summary><ul className="country-import-warnings">{preview.warnings.map((x:any,i:number)=><li key={i}>{typeof x==='string'?x:JSON.stringify(x)}</li>)}</ul></details>}
      <details className="country-import-changes"><summary>核对 {preview.changes?.length||0} 条资料及来源编号</summary><div className="country-table-scroll"><table className="country-import-table"><thead><tr><th>类型</th><th>名称</th><th>原研究编号</th><th>处理</th></tr></thead><tbody>{preview.changes?.map((x:Item)=><tr key={x.kind+'-'+x.id}><td>{({account:'客户',route:'区域入口',project:'项目',country:'国家'} as Item)[x.kind]||x.kind}</td><td>{x.name}</td><td>{x.source_id||'—'}</td><td>{({add:'新增',create:'新增',update:'更新',unchanged:'保持原值',added:'新增',updated:'更新'} as Item)[x.action]||x.action}</td></tr>)}</tbody></table></div></details>
      <button className="primary" disabled={busy} onClick={()=>void run(true)}>{busy?'正在保存…':'确认导入这批资料'}</button>
    </div>}
    {error&&<p className="country-import-error" role="alert">{error}</p>}
    {success&&<p className="word-success" role="status"><CheckCircle2 size={17}/>{success}</p>}
  </section>;
}
