import {ArrowUpRight,Link2} from 'lucide-react';
type Item=Record<string,any>;
function safe(value:any){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}}
export default function ResearchDetails({account}:{account:Item}){
  if(!account.country_code&&!account.grade&&!account.source_urls?.length)return null;
  const raw=account.research_raw||{};
  const fact=account.fit_fact||account.writing_fact;
  const question=account.first_question_zh||raw.first_question_zh;
  const contacts=account.contact_level||raw.contact_level;
  const recentSignal=typeof raw.recent_signal==='string'?raw.recent_signal:typeof raw.recent_signal?.fact==='string'?raw.recent_signal.fact:'';
  const messaging=account.messaging||raw.messaging;
  const messagingUrls=(String(messaging||'').match(/https?:\/\/[^\s；，（）)]+/g)||[]).filter((url:string)=>safe(url));
  const sources=Array.from(new Set([account.contact_url,account.fit_url,...(account.source_urls||raw.source_urls||[]),account.writing_source,raw.large_c_evidence?.source_url].filter(Boolean))) as string[];
  return <section className="research-details">
    {question&&<div className="research-question"><span className="small muted">建议先问这一句</span><p>{question}</p></div>}
    {recentSignal&&<div className="research-facts"><div><span className="small muted">近期公开动态</span><p>{recentSignal}</p>{raw.recent_signal?.evidence_level&&<p className="small muted">{raw.recent_signal.evidence_level}</p>}{safe(raw.recent_signal?.source_url)&&<a href={safe(raw.recent_signal.source_url)!} target="_blank" rel="noreferrer">查看动态来源<ArrowUpRight size={12}/></a>}</div></div>}
    <div className="research-facts"><div><span className="small muted">匹配依据</span><p>{fact||'待补充'}</p></div>{contacts&&<div><span className="small muted">联系入口性质</span><p>{contacts}</p></div>}{account.function_to_ask&&<div><span className="small muted">拟找部门或岗位</span><p>{account.function_to_ask}</p></div>}{account.procurement_status&&<div><span className="small muted">需求与采购情况</span><p>{account.procurement_status}</p></div>}{account.large_c_route&&<div><span className="small muted">私人住宅 / 大C转介</span><p>{account.large_c_route}</p></div>}</div>
    <div className="research-source-links"><Link2 size={15}/><span>原始依据</span>{sources.filter(safe).map((url,i)=><a key={url} href={safe(url)!} target="_blank" rel="noreferrer">{url===account.contact_url?'联系方式':url===account.fit_url?'业务与产品':`来源 ${i+1}`}<ArrowUpRight size={12}/></a>)}</div>
    {messaging&&<div className="research-facts"><div><span className="small muted">其他公开联系渠道</span><p>{messaging}</p>{messagingUrls.map((url:string)=><a key={url} href={safe(url)!} target="_blank" rel="noreferrer">打开公开渠道<ArrowUpRight size={12}/></a>)}</div></div>}
    {Array.isArray(account.locations)&&account.locations.length>0&&<details className="research-limitations"><summary>各地业务入口 · {account.locations.length}处</summary>{account.locations.map((location:Item,i:number)=><div key={i}><p><strong>{[location.city,location.region].filter(Boolean).join(' / ')}</strong></p><p>{[location.address,location.email,location.phone].filter(Boolean).join(' · ')}</p>{safe(location.source_url)&&<a href={safe(location.source_url)!} target="_blank" rel="noreferrer">查看该入口来源<ArrowUpRight size={12}/></a>}</div>)}</details>}
    {(account.limitations||raw.limitations)&&<details className="research-limitations"><summary>待核事项与资料冲突</summary><p>{account.limitations||raw.limitations}</p>{account.original_city&&account.original_city!==account.city&&<p>原始地点：{account.original_city}</p>}{account.evidence_quality&&<p>来源核验：{account.evidence_quality}</p>}</details>}
  </section>;
}
