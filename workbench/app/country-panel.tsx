'use client';
import {useMemo,useRef,useState} from 'react';
import {ArrowLeft,ArrowUpRight,ChevronRight,Copy,Globe,Search,Upload} from 'lucide-react';
import './country-panel.css';

type Item=Record<string,any>;
export type CountryPanelProps={
  data:Item;
  onChooseAccount:(id:string)=>void;
  onOpenProject?:(project:Item)=>void;
  onImport?:()=>void;
  renderFollowup?:(account:Item)=>React.ReactNode;
};
const tabs=[['accounts','客户'],['projects','项目'],['market','市场资料']] as const;
type Tab=typeof tabs[number][0];
const list=(value:any):Item[]=>Array.isArray(value)?value:[];
const text=(value:any):string=>typeof value==='string'?value:typeof value==='number'?String(value):'';
const display=(value:any):string=>Array.isArray(value)?value.map(text).filter(Boolean).join('、'):text(value);
const lower=(value:any)=>text(value).trim().toLocaleLowerCase();
const code=(value:any)=>text(value).trim().toUpperCase();
function merged(value:Item):Item{return {...(value?.research_raw&&typeof value.research_raw==='object'&&!Array.isArray(value.research_raw)?value.research_raw:{}),...value};}
function safeWeb(value:any):string|undefined{try{const u=new URL(text(value));return ['https:','http:'].includes(u.protocol)?u.href:undefined;}catch{return undefined;}}
function urls(value:Item):string[]{
  const row=merged(value),raw=[row.source_url,row.contact_url,row.fit_url,row.writing_source,row.tender_url,...(Array.isArray(row.source_urls)?row.source_urls:[]),...(Array.isArray(row.additional_source_urls)?row.additional_source_urls:[])];
  return [...new Set(raw.map(safeWeb).filter((url):url is string=>!!url))];
}
function profileKey(country:Item):string{return text(country.id||country.country_code||country.country_name||country.name);}
function countryName(country:Item):string{return text(country.country_name||country.name||country.country||country.country_code)||'国家名称待补充';}
function belongs(value:Item,country:Item):boolean{
  const row=merged(value),cc=code(country.country_code),rc=code(row.country_code);
  if(rc&&cc)return rc===cc;
  if(row.country_id&&text(row.country_id)===profileKey(country))return true;
  const name=lower(countryName(country));
  return !!name&&[row.country_name,row.country].some(v=>lower(v)===name);
}
function grade(value:Item):string{const g=code(merged(value).grade||merged(value).priority_suggestion);return ['S','A','B','C'].includes(g)?g:'';}
const residentialRole='住宅/大C入口';
const roleCategories=['渠道经销','工程安装','设计调试','设备配套','设施业主','供热机构','其他'];
function roleCategory(value:Item):string{
  const row=merged(value),provided=text(row.role_category);if(roleCategories.includes(provided))return provided;
  const role=text(row.role);
  if(/国家供热|集中供热|热力运营|供热运营|公用事业|供热机构/.test(role))return '供热机构';
  if(/设计院|机电设计|规格影响|系统诊断|暖通调试|技术选型影响/.test(role))return '设计调试';
  if(/酒店|度假|会展|综合体|设施|运营业主|开发业主/.test(role))return '设施业主';
  if(/OEM|制造商|锅炉制造|散热器制造|紧固件制造/i.test(role))return '设备配套';
  if(/安装|施工|承包|EPC|工程商|机电工程|暖通工程|冷却工程|建设/i.test(role))return '工程安装';
  if(/渠道|分销|进口|经销|批发|零售|设备销售/.test(role))return '渠道经销';
  if(/配套|成套|设备供货/.test(role))return '设备配套';
  return '其他';
}
function profiles(data:Item):Item[]{
  const result=list(data.countries).map(c=>merged(c));
  for(const account of list(data.accounts)){
    const row=merged(account),name=text(row.country_name||row.country),cc=code(row.country_code);
    if(!name&&!cc)continue;
    if(result.some(c=>belongs(row,c)))continue;
    result.push({id:cc||'legacy:'+name,country_code:cc,country_name:name||cc,synthetic:true});
  }
  return result.sort((a,b)=>Number(!!a.synthetic)-Number(!!b.synthetic)||countryName(a).localeCompare(countryName(b),'zh-CN'));
}
function SourceLinks({item,label='来源'}:{item:Item,label?:string}){
  const links=urls(item);if(!links.length)return null;
  return <div className="country-sources">{links.map((url,i)=><a key={url} href={url} target="_blank" rel="noreferrer">{label}{links.length>1?' '+(i+1):''}<ArrowUpRight size={12}/></a>)}</div>;
}
function Grade({value}:{value:string}){return <span className={'country-grade country-grade-'+(value||'none')}>{value||'未分级'}</span>;}
function Nothing({title,children}:{title:string,children?:React.ReactNode}){return <div className="country-empty"><Globe size={25}/><h3>{title}</h3>{children&&<p>{children}</p>}</div>;}
const unique=(values:string[])=>[...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
function cityLabel(value:any):string{
  const raw=text(value).trim(),lookup=raw.normalize('NFC').replace(/\s+/g,' ').toLowerCase();
  const groups:[string,string[]][]=[
    ['迪拜 Dubai',['迪拜','迪拜 dubai','dubai','迪拜 deira']],
    ['阿布扎比 Abu Dhabi',['阿布扎比','阿布扎比 abu dhabi','abu dhabi']],
    ['多哈 Doha',['多哈','多哈 doha','doha']],
    ['达曼 Dammam',['达曼','达曼 dammam','dammam']],
    ['曼谷 Bangkok',['曼谷','曼谷 bangkok','bangkok']],
    ['河内 Hà Nội',['河内','河内 hà nội','hà nội','hanoi']],
    ['胡志明市 TP.HCM',['胡志明市','胡志明市 tp.hcm','ho chi minh city','hcmc']],
    ['开罗 Cairo',['开罗','开罗 cairo','cairo']],
    ['雅加达 Jakarta',['雅加达','雅加达 jakarta','jakarta']]
  ];
  return groups.find(([,aliases])=>aliases.includes(lookup))?.[0]||raw;
}
function places(value:Item):Item[]{const row=merged(value);return [{city:cityLabel(row.city),region:text(row.region),primary:true},...list(row.locations).filter(location=>text(location.city)).map(location=>({...location,city:cityLabel(location.city),region:text(location.region)}))];}
function inPlace(value:Item,region:string,city=''):boolean{return places(value).some(location=>(!region||location.region===region)&&(!city||location.city===city));}
function sourceDate(country:Item):string{return text(country.source_date||country.date||country.query_date);}
const million=(value:any)=>typeof value==='number'&&Number.isFinite(value)?(value/1e6).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}):'无本轮记录';
function periodLabel(value:any):string{const s=text(value);return /^\d{6}$/.test(s)?s.slice(0,4)+'年'+Number(s.slice(4))+'月':s;}
function tradeKey(row:Item):string{return [row.reporter_code??row.reporter,row.partner_code??row.partner,row.flow].join('|');}
function tradeLabel(row:Item):string{
  const reporter=text(row.reporter||row.reporter_name||row.reporter_code),partner=Number(row.partner_code)===0?'全球':text(row.partner||row.partner_name||row.partner_code);
  return reporter+' '+(row.flow==='M'?'自'+partner+'进口':row.flow==='X'?'对'+partner+'出口':text(row.flow)+' '+partner)+(row.valuation?' / '+row.valuation:'');
}
function ValueSource({row}:{row?:Item}){if(!row)return <>无本轮记录</>;const url=safeWeb(row.source_url);return url?<a href={url} target="_blank" rel="noreferrer" title="查看这条数据的原始来源">{million(row.value_usd)}<ArrowUpRight size={11}/></a>:<>{million(row.value_usd)}</>;}

function MarketPanel({country}:{country:Item}){
  const c=merged(country),customs=c.customs&&typeof c.customs==='object'?c.customs:{},allAnnual=list(customs.annual),allMonthly=list(customs.monthly);
  const codes=unique([...allAnnual,...allMonthly].map(row=>text(row.hs||row.cmdCode)));
  const primaryHs=text(customs.primary_hs||customs.hs)||(codes.includes('848180')?'848180':codes[0]||'');
  const annual=allAnnual.filter(row=>text(row.hs||row.cmdCode)===primaryHs),sourceMonthly=allMonthly.filter(row=>text(row.hs||row.cmdCode)===primaryHs);
  const latestYear=unique(sourceMonthly.map(row=>text(row.period).slice(0,4))).at(-1);
  const monthly=sourceMonthly.filter(row=>text(row.period).slice(0,4)===latestYear);
  const years=unique(annual.map(row=>text(row.period||row.year))).slice(-3),annualGroups=[...new Map(annual.map(row=>[tradeKey(row),row])).values()];
  const months=unique(monthly.map(row=>text(row.period))),latestMonth=months.at(-1),monthlyGroups=[...new Map(monthly.map(row=>[tradeKey(row),row])).values()];
  const originsKey=Object.keys(customs).filter(key=>/^partners_\d{4}$/.test(key)).sort().at(-1);
  const signals=list(customs.signals);
  const origins=list(customs.partners_latest||customs.origins||originsKey&&customs[originsKey]).filter(row=>Number(row.partner_code)!==0).sort((a,b)=>(Number(b.value_usd)||0)-(Number(a.value_usd)||0)).slice(0,5);
  const originPeriod=text(customs.partners_period||customs.origin_period)||(originsKey?originsKey.replace('partners_',''):'');
  const rawCoverage=Array.isArray(c.coverage)?c.coverage:list(c.region_plans),methods=list(c.methods);
  const coverage=rawCoverage.map((row:any)=>Array.isArray(row)?{region:display(row[0]),cities:display(row[1]),priority:display(row[2]),focus:display(row[3]),gap:display(row[4])}:{region:display(row.region||row.name),cities:display(row.cities||row.city),priority:display(row.priority||row.queue),focus:display(row.focus||row.target),gap:display(row.gap||row.gaps||row.next_action||row.next_step),search_status:display(row.search_status),queries:list(row.queries),source_urls:list(row.source_urls)});
  const missing=list(customs.monthly_availability).filter(row=>text(row.status).includes('empty')).map(row=>[row.reporter_code||row.reporter,row.period].filter(Boolean).join(' / '));
  const hasMarket=annual.length||monthly.length||origins.length||signals.length||coverage.length||methods.length;
  if(!hasMarket)return <div className="panel"><Nothing title="尚无国家市场资料">现有客户仍可查看。导入该国研究包后，这里会显示海关数据、城市覆盖和发现方法。</Nothing></div>;
  return <div className="country-market">
    {(annual.length>0||monthly.length>0)&&<section className="panel country-market-section"><div className="country-section-head"><div><h2>海关数据{primaryHs&&' · HS '+primaryHs}</h2><p>金额单位：百万美元。报告方、流向和估值分别保留。</p></div></div>{primaryHs==='848180'&&<p className="country-boundary">848180为宽口径阀类，不能直接代表平衡阀市场或企业采购需求。</p>}
      {annual.length>0&&<div className="country-table-wrap"><table className="country-trade-table"><caption>年度记录 · {years.join(' / ')}</caption><thead><tr><th scope="col">统计口径</th>{years.map(year=><th scope="col" key={year}>{year}</th>)}</tr></thead><tbody>{annualGroups.map(group=><tr key={tradeKey(group)}><th scope="row">{tradeLabel(group)}</th>{years.map(year=><td key={year}><ValueSource row={annual.find(row=>tradeKey(row)===tradeKey(group)&&text(row.period||row.year)===year)}/></td>)}</tr>)}</tbody></table></div>}
      {monthly.length>0&&<div className="country-monthly"><h3>月度记录 · 本轮观察到{periodLabel(latestMonth)}</h3><div className="country-monthly-totals">{monthlyGroups.map(group=>{const records=monthly.filter(row=>tradeKey(row)===tradeKey(group)),complete=records.every(row=>typeof row.value_usd==='number'&&Number.isFinite(row.value_usd)),sum=complete?records.reduce((total,row)=>total+row.value_usd,0):undefined;return <div key={tradeKey(group)}><span>{tradeLabel(group)}</span><strong>{complete?million(sum):'数值待补'}</strong><small>{latestYear}年 · {unique(records.map(row=>text(row.period))).length}个月已观察记录{complete?'累计':'，数值不完整'}</small></div>;})}</div><details className="country-data-details"><summary>查看逐月记录及原始来源</summary><div className="country-table-wrap"><table className="country-trade-table"><thead><tr><th scope="col">月份</th>{monthlyGroups.map(group=><th key={tradeKey(group)} scope="col">{tradeLabel(group)}</th>)}</tr></thead><tbody>{months.map(month=><tr key={month}><th scope="row">{periodLabel(month)}</th>{monthlyGroups.map(group=><td key={tradeKey(group)}><ValueSource row={monthly.find(row=>tradeKey(row)===tradeKey(group)&&text(row.period)===month)}/></td>)}</tr>)}</tbody></table></div></details><p className="country-caption">观察累计不作年化；缺失记录不填零{missing.length?'。本轮未返回的查询：'+missing.join('、'):''}。</p></div>}
    </section>}
    {origins.length>0&&<section className="panel country-market-section"><div className="country-section-head"><div><h2>主要进口来源{originPeriod&&' · '+originPeriod}</h2><p>按已导入数据的金额排序，前5个来源国家/地区。</p></div></div><div className="country-table-wrap"><table className="country-trade-table"><thead><tr><th scope="col">来源</th><th scope="col">金额（百万美元）</th><th scope="col">占比</th><th scope="col">来源</th></tr></thead><tbody>{origins.map((row,i)=><tr key={text(row.partner_code||row.partner)||i}><th scope="row">{text(row.partner||row.partner_name||row.partner_code)||'待补充'}</th><td>{million(row.value_usd)}</td><td>{typeof row.share==='number'&&Number.isFinite(row.share)?(row.share*100).toFixed(2)+'%':'未提供'}</td><td><SourceLinks item={row}/></td></tr>)}</tbody></table></div><p className="country-caption">来源国结构不等于企业供应商集中度。</p></section>}
    {signals.length>0&&<section className="panel country-market-section"><div className="country-section-head"><div><h2>海关记录反查 · {signals.length}条</h2><p>{text(customs.status)||'原始交易日期与核读状态分别保留；记录不代表当前采购需求。'}</p></div></div><div className="country-table-wrap"><table className="country-coverage-table"><thead><tr><th scope="col">企业 / 交易日期</th><th scope="col">货描与原始编号</th><th scope="col">核读状态 / 下一步</th></tr></thead><tbody>{signals.map((row,i)=><tr key={i}><th scope="row">{text(row.company)||'企业待核'}<span>{text(row.event_date)||'交易日期待核'}</span></th><td>{text(row.goods||row.description)}{row.hs_as_source&&<p className="country-caption">原始HS：{text(row.hs_as_source)}</p>}{row.record&&<p className="country-caption">{text(row.record)}</p>}<SourceLinks item={row}/></td><td>{row.read_status&&<p><strong>{text(row.read_status)}</strong></p>}{text(row.next_step)||'先核企业现状、联系入口与产品适配。'}</td></tr>)}</tbody></table></div></section>}
    {coverage.length>0&&<section className="panel country-market-section"><details className="country-data-details" open><summary>城市覆盖与待补证 · {coverage.length}个地区 / 城市</summary><div className="country-table-wrap"><table className="country-coverage-table"><thead><tr><th scope="col">区域 / 城市</th><th scope="col">开发方向</th><th scope="col">下一步与缺口</th></tr></thead><tbody>{coverage.map((row:Item,i:number)=><tr key={row.region||i}><th scope="row">{row.region}<span>{row.cities}</span></th><td>{row.priority&&<span className="country-inline-tag">{row.priority}</span>}{row.focus}</td><td>{row.search_status&&<p><strong>{row.search_status}</strong></p>}{row.gap||'待补充'}{(row.queries?.length>0||row.source_urls?.length>0)&&<details><summary>检索记录</summary>{row.queries?.length>0&&<p className="country-caption">{row.queries.join('；')}</p>}<SourceLinks item={row}/></details>}</td></tr>)}</tbody></table></div><p className="country-caption">总部、项目地点、区县与服务城市按原始证据区分；此表不是全城企业普查。</p></details></section>}
    {methods.length>0&&<section className="panel country-market-section"><details className="country-data-details"><summary>信息发现方法 · {methods.length}条</summary><div className="country-method-list">{methods.map((row,i)=><article key={row.id||i}><div><span>{row.id||String(i+1).padStart(2,'0')}</span><h3>{text(row.method||row.name)||'发现方法'}</h3></div>{row.signal&&<p>{display(row.signal)}</p>}{row.action&&<p>{display(row.action)}</p>}{row.limit&&<p className="country-caption">{display(row.limit)}</p>}{safeWeb(row.url)&&<a href={safeWeb(row.url)} target="_blank" rel="noreferrer">查看入口<ArrowUpRight size={12}/></a>}</article>)}</div></details></section>}
  </div>;
}

export default function CountryPanel({data,onChooseAccount,onOpenProject,onImport,renderFollowup}:CountryPanelProps){
  const countries=useMemo(()=>profiles(data),[data]),[selectedId,setSelectedId]=useState(''),[tab,setTab]=useState<Tab>('accounts');
  const [region,setRegion]=useState(''),[city,setCity]=useState(''),[selectedGrade,setSelectedGrade]=useState(''),[role,setRole]=useState(''),[query,setQuery]=useState(''),[notice,setNotice]=useState('');
  const tabButtons=useRef<Array<HTMLButtonElement|null>>([]),heading=useRef<HTMLHeadingElement>(null);
  const selected=countries.find(country=>profileKey(country)===selectedId);
  const accounts=selected?list(data.accounts).filter(row=>belongs(row,selected)):[],routes=selected?list(data.routes).filter(row=>belongs(row,selected)):[],projects=selected?list(data.projects).filter(row=>belongs(row,selected)):[];
  const states=new Map<string,Item>(list(data.states).map(state=>[text(state.account_id),state]));
  const accountNames=new Map(list(data.accounts).map(account=>[text(account.id),text(account.name)]));
  const grades=accounts.reduce<Item>((result,row)=>{const g=grade(row);result[g||'none']=(result[g||'none']||0)+1;return result;},{});
  const regions=unique([...accounts,...routes].flatMap(row=>places(row).map(location=>text(location.region)))),cities=unique(accounts.flatMap(row=>places(row).filter(location=>!region||location.region===region).map(location=>text(location.city)))),roles=roleCategories.filter(category=>accounts.some(row=>roleCategory(row)===category)).concat(accounts.some(row=>!!text(merged(row).large_c_route))?[residentialRole]:[]);
  const q=query.trim().toLocaleLowerCase();
  const visible=accounts.filter(account=>{const row=merged(account);return inPlace(row,region,city)&&(!selectedGrade||(selectedGrade==='none'?!grade(row):grade(row)===selectedGrade))&&(!role||(role===residentialRole?!!text(row.large_c_route):roleCategory(row)===role))&&(!q||[row.name,row.city,row.region,row.role,row.email,row.phone,row.source_id,row.large_c_route,row.product_fit,...places(row).flatMap(location=>[location.city,location.region,location.email,location.phone])].map(display).join(' ').toLocaleLowerCase().includes(q));}).sort((a,b)=>{const order=['S','A','B','C',''];return order.indexOf(grade(a))-order.indexOf(grade(b))||text(a.name).localeCompare(text(b.name),'zh-CN');});
  const selectedRoutes=routes.filter(route=>!region||text(merged(route).region)===region);
  const filtered=!!(region||city||selectedGrade||role||query);
  function clear(){setRegion('');setCity('');setSelectedGrade('');setRole('');setQuery('');}
  function focusHeading(){requestAnimationFrame(()=>heading.current?.focus());}
  function chooseCountry(country:Item){setSelectedId(profileKey(country));setTab('accounts');setNotice('');clear();focusHeading();}
  function currentPlace(account:Item){const row=merged(account);return places(row).find(location=>(city?location.city===city:region?location.region===region:location.primary)&&(!region||location.region===region))||places(row)[0];}
  function contactRow(account:Item){const row=merged(account),location=currentPlace(account);return !location.primary&&(location.email||location.phone)?{...row,email:location.email||'',phone:location.phone||'',branch:location.city}:row;}
  async function copyContact(account:Item){const row=contactRow(account),value=[row.email,row.phone].map(display).filter(Boolean).join('\n')||text(row.url||row.website);if(!value)return;try{await navigator.clipboard.writeText(value);setNotice('已复制 '+text(row.name)+(row.branch?' · '+row.branch:'')+' 的公开联系方式。');}catch{setNotice('复制失败，请选中联系方式后复制。');}}
  function nextAction(account:Item):{value:string,label:string}{const row=merged(account),state=states.get(text(account.id));if(state?.status==='停止联系')return {value:'停止联系',label:'当前安排'};if(state?.next_action)return {value:text(state.next_action)+(state.next_date?' · '+text(state.next_date):''),label:'当前安排'};return {value:display(row.first_question_zh||row.first_question||row.next_action||row.next_step)||'先核实负责部门与业务范围',label:'研究建议'};}
  function contact(account:Item){const row=contactRow(account),site=safeWeb(row.url||row.website);return <div className="country-contact">{row.contact_freshness&&<small className="country-cell-secondary">{text(row.contact_freshness)}</small>}{row.branch&&<small className="country-cell-secondary">{row.branch}业务入口</small>}{row.email&&<span>{display(row.email)}</span>}{row.phone&&<span>{display(row.phone)}</span>}<div className="country-contact-actions">{site&&<a href={site} target="_blank" rel="noreferrer">网站<ArrowUpRight size={12}/></a>}{(row.email||row.phone||site)&&<button type="button" className="text-button" onClick={()=>void copyContact(account)} aria-label={'复制'+text(row.name)+'的联系方式'}><Copy size={12}/>复制</button>}{!row.email&&!row.phone&&!site&&<span className="country-caption">待补充</span>}</div></div>;}
  function accountLabel(account:Item){const row=merged(account),pool=text(row.pool),purpose=display(row.contact_level),procurement=/(官网已公开采购部|官网采购部|官方采购部门|采购部邮箱\/电话)/.test(purpose);return <div className="country-company-name"><button type="button" className="text-button" onClick={()=>onChooseAccount(text(account.id))}>{text(row.name)||'名称待补充'}</button><span title={purpose||undefined} aria-label={(text(row.source_id)||text(row.id))+(purpose?'；联系用途：'+purpose:'')}>{text(row.source_id)||text(row.id)}{pool&&' · '+({backlog:'待补证',main:'主档',candidate:'研究候选'}[pool]||pool)}{procurement&&<strong className="country-procurement-label">采购部入口</strong>}</span></div>;}
  if(!selected)return <section className="country-workspace"><div className="page-head"><div><p className="eyebrow">COUNTRY WORKSPACE</p><h1 ref={heading} tabIndex={-1}>国家开发</h1><p className="muted">先选国家，再按城市推进客户和项目。</p></div>{onImport&&<button type="button" onClick={onImport}><Upload size={15}/>导入国家资料</button>}</div>{countries.length?<div className="country-list">{countries.map(country=>{const count=list(data.accounts).filter(row=>belongs(row,country)).length,projectCount=list(data.projects).filter(row=>belongs(row,country)).length,date=sourceDate(country);return <button type="button" className="country-card" key={profileKey(country)} onClick={()=>chooseCountry(country)}><span className="country-card-top"><span className="country-icon"><Globe size={22}/></span><ChevronRight size={17}/></span><strong>{countryName(country)}</strong><span className="country-card-count">{count+'条客户档案'}{projectCount>0&&' · '+projectCount+'个项目'}</span><span className="country-caption">{date?'资料基准 '+date:country.synthetic?'现有客户资料 · 尚无国家研究包':'资料日期待补充'}</span></button>;})}</div>:<div className="panel"><Nothing title="从第一个国家开始">导入一份国家研究包，核对客户、项目和市场资料后保存。以后新增的国家会自动显示在这里。</Nothing>{onImport&&<div className="country-empty-action"><button type="button" className="primary" onClick={onImport}>导入国家资料</button></div>}</div>}</section>;
  const totalLabel=accounts.length+'条客户档案';
  return <section className="country-workspace"><button type="button" className="country-back text-button" onClick={()=>{setSelectedId('');setNotice('');focusHeading();}}><ArrowLeft size={15}/>全部国家</button><div className="page-head country-selected-head"><div><p className="eyebrow">COUNTRY WORKSPACE{selected.country_code&&' / '+selected.country_code}</p><h1 ref={heading} tabIndex={-1}>{countryName(selected)}</h1><p className="muted">{sourceDate(selected)?'资料基准 '+sourceDate(selected):'原有客户资料'} · {totalLabel} · {projects.length}个项目</p></div>{onImport&&<button type="button" onClick={onImport}><Upload size={15}/>更新国家资料</button>}</div>
    <div className="country-tabs" role="tablist" aria-label="国家资料">{tabs.map(([key,label],index)=><button type="button" key={key} ref={node=>{tabButtons.current[index]=node;}} role="tab" id={'country-tab-'+key} aria-controls={'country-panel-'+key} aria-selected={tab===key} tabIndex={tab===key?0:-1} className={tab===key?'active':''} onClick={()=>setTab(key)} onKeyDown={event=>{let next=index;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;event.preventDefault();setTab(tabs[next][0]);tabButtons.current[next]?.focus();}}>{label}<span>{key==='accounts'?accounts.length:key==='projects'?projects.length:''}</span></button>)}</div>
    {notice&&<div className="country-notice" role="status" aria-live="polite">{notice}<button type="button" className="text-button" aria-label="关闭复制提示" onClick={()=>setNotice('')}>关闭</button></div>}
    {tab==='accounts'&&<div id="country-panel-accounts" role="tabpanel" aria-labelledby="country-tab-accounts"><div className="country-grade-summary" aria-label="客户分级数量">{['S','A','B','C'].map(g=><button type="button" key={g} className={selectedGrade===g?'active':''} aria-pressed={selectedGrade===g} aria-label={'筛选'+g+'级客户，共'+(grades[g]||0)+'条'} onClick={()=>setSelectedGrade(current=>current===g?'':g)}><Grade value={g}/><strong>{grades[g]||0}</strong></button>)}{grades.none>0&&<span className="country-caption">未分级 {grades.none}</span>}<p>分级用于开发排序，实际联系与需求以客户记录为准。</p></div><div className="panel country-clients"><div className="country-filters"><label className="country-search"><span>搜索客户</span><div className="search-box"><Search size={15}/><input aria-label="搜索国家客户" placeholder="公司、邮箱、电话或角色" value={query} onChange={e=>setQuery(e.target.value)}/></div></label><label><span>区域</span><select aria-label="筛选区域" value={region} onChange={e=>{setRegion(e.target.value);setCity('');}}><option value="">全部区域</option>{regions.map(value=><option key={value} value={value}>{value}</option>)}</select></label><label><span>城市 / 区县</span><select aria-label="筛选城市或区县" value={city} onChange={e=>setCity(e.target.value)}><option value="">全部城市 / 区县</option>{cities.map(value=><option key={value} value={value}>{value}</option>)}</select></label><label><span>级别</span><select aria-label="筛选客户级别" value={selectedGrade} onChange={e=>setSelectedGrade(e.target.value)}><option value="">全部级别</option>{['S','A','B','C'].map(value=><option key={value} value={value}>{value}</option>)}{grades.none>0&&<option value="none">未分级</option>}</select></label><label><span>客户角色</span><select aria-label="筛选客户角色" value={role} onChange={e=>setRole(e.target.value)}><option value="">全部角色</option>{roles.map(value=><option key={value} value={value}>{value}</option>)}</select></label></div><div className="country-results-head"><span>显示 {visible.length} / {accounts.length}条档案</span>{filtered&&<button type="button" className="text-button" onClick={clear}>清除筛选</button>}</div>{visible.length?<><div className="country-account-table"><table><thead><tr><th scope="col">公司</th><th scope="col">城市 / 区域</th><th scope="col">级别</th><th scope="col">角色</th><th scope="col">公开联系</th><th scope="col">下一步</th><th scope="col"><span className="country-sr-only">打开客户</span></th></tr></thead><tbody>{visible.map(account=>{const row=merged(account),next=nextAction(account);return <tr key={account.id}><td>{accountLabel(account)}</td><td>{text(currentPlace(account).city)||'城市待核'}<small className="country-cell-secondary">{text(currentPlace(account).region)}</small></td><td><Grade value={grade(row)}/></td><td>{text(row.role)||'角色待核'}</td><td>{contact(account)}</td><td><span className="country-cell-secondary">{next.label}</span><p className="country-action-copy" title={next.value}>{next.value}</p></td><td className="country-followup-cell">{renderFollowup?.(account)}<button type="button" className="text-button country-open" onClick={()=>onChooseAccount(text(account.id))} aria-label={'打开客户 '+text(account.name)}>打开<ChevronRight size={13}/></button></td></tr>;})}</tbody></table></div><div className="country-account-cards">{visible.map(account=>{const row=merged(account),next=nextAction(account);return <article key={account.id}><div className="country-mobile-card-head">{accountLabel(account)}<Grade value={grade(row)}/></div><p className="country-caption">{[currentPlace(account).city,currentPlace(account).region].map(text).filter(Boolean).join(' / ')||'城市待核'} · {text(row.role)||'角色待核'}</p>{contact(account)}<div className="country-mobile-next"><span>{next.label}</span><p>{next.value}</p></div>{renderFollowup?.(account)}<button type="button" className="text-button" onClick={()=>onChooseAccount(text(account.id))}>打开客户<ChevronRight size={13}/></button></article>;})}</div></>:<Nothing title="没有符合条件的客户">调整城市、级别或搜索条件后再查看。</Nothing>}</div>
      {routes.length>0&&<details className="panel country-routes"><summary>集团与区域联系入口 <span>{routes.length}条 · 单独保存，不计独立客户</span></summary><p className="country-caption">先确认当地采购责任与集团关系。下方按当前区域筛选显示 {selectedRoutes.length}条。</p><div className="country-route-grid">{selectedRoutes.map(route=>{const row=merged(route);return <article key={row.id}><h3>{text(row.name)}</h3><p className="country-caption">{[row.region,row.city].map(text).filter(Boolean).join(' / ')}</p>{contact(row)}{row.function_to_ask&&<p className="country-route-function">{display(row.function_to_ask)}</p>}<SourceLinks item={row}/></article>;})}{!selectedRoutes.length&&<p className="country-caption">该区域暂无已导入入口。</p>}</div></details>}
    </div>}
    {tab==='projects'&&<div id="country-panel-projects" role="tabpanel" aria-labelledby="country-tab-projects">{projects.length?<div className="country-projects">{projects.map(project=>{const row=merged(project),date=display(row.date||row.source_date||row.signal_date),limitations=display(row.limitations||row.note),conflict=!!row.date_conflict||/日期.{0,12}冲突|日期不同|日期不一致|日期.{0,8}差异/.test([date,limitations].join(' '));return <article className="panel country-project" key={project.id}><div className="country-project-top"><span>{text(row.source_id||row.id)}</span>{onOpenProject&&<button type="button" className="text-button" onClick={()=>onOpenProject(project)}>打开项目<ChevronRight size={13}/></button>}</div><h3>{text(row.name)||'项目名称待补充'}</h3><p className="country-caption">{display(row.location||row.cities||row.cities_text)||'地点待补充'}</p><dl><div><dt>阶段 / 采购</dt><dd>{display(row.source_stage||row.stage||row.phase)||'阶段待核'}{row.procurement_status&&<span>{display(row.procurement_status)}</span>}</dd></div>{date&&<div><dt>公告 / 事件日期</dt><dd className={conflict?'country-date-conflict':''}>{date}{conflict&&<small>日期信息有冲突，需按原公告复核。</small>}</dd></div>}{(row.lot||row.project_id)&&<div><dt>lot / 项目编号</dt><dd>{[row.lot,row.project_id].map(text).filter(Boolean).join(' / ')}</dd></div>}{row.next_action&&<div><dt>研究下一步</dt><dd>{display(row.next_action)}</dd></div>}</dl>{limitations&&<details className="country-project-note"><summary>待核事项与范围</summary><p>{limitations}</p></details>}{list(row.links).length>0&&<div className="country-project-links">{list(row.links).map((association,i)=><button type="button" className="text-button" key={text(association.account_id)||i} onClick={()=>onChooseAccount(text(association.account_id))}>{accountNames.get(text(association.account_id))||text(association.account_id)}{association.role&&' · '+text(association.role)}</button>)}</div>}<SourceLinks item={row}/></article>;})}</div>:<div className="panel"><Nothing title="该国尚无项目资料">导入有来源的项目后，可在这里查看状态、lot与采购路径。</Nothing></div>}</div>}
    {tab==='market'&&<div id="country-panel-market" role="tabpanel" aria-labelledby="country-tab-market"><MarketPanel country={selected}/></div>}
  </section>;
}
