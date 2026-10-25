import {inflateRawSync,crc32} from 'node:zlib';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {xml2js} from 'xml-js';
import {AppError} from '../app/errors';
type Item=Record<string,any>;
const limit=6*1024*1024;
// Read only bounded, internal OOXML parts. Never evaluate formulas or fetch relationships.
function archive(file:Buffer){
  if(file.length>8*1024*1024)throw new AppError('Excel 文件请控制在 8MB 以内',413);
  let end=-1;for(let i=file.length-22;i>=Math.max(0,file.length-65557);i--)if(file.readUInt32LE(i)===0x06054b50&&i+22+file.readUInt16LE(i+20)===file.length){end=i;break;}
  if(end<0)throw new AppError('无法读取表格，请使用未加密的 .xlsx 文件');
  const count=file.readUInt16LE(end+10),offset=file.readUInt32LE(end+16),length=file.readUInt32LE(end+12);
  if(file.readUInt16LE(end+4)||file.readUInt16LE(end+6)||file.readUInt16LE(end+8)!==count||count>512||offset+length!==end)throw new AppError('不支持此 Excel 压缩格式，请重新另存为 .xlsx');
  const entries=new Map<string,Item>();let at=offset,total=0;const cache=new Map<string,string>();
  for(let i=0;i<count;i++){
    if(at+46>end||file.readUInt32LE(at)!==0x02014b50)throw new AppError('Excel 压缩目录损坏');
    const nl=file.readUInt16LE(at+28),extra=file.readUInt16LE(at+30),comment=file.readUInt16LE(at+32),next=at+46+nl+extra+comment;
    if(next>end)throw new AppError('Excel 压缩目录损坏');
    const name=file.subarray(at+46,at+46+nl).toString('utf8');
    if(entries.has(name))throw new AppError('Excel 包含重复文件，请重新另存');
    entries.set(name,{flags:file.readUInt16LE(at+8),method:file.readUInt16LE(at+10),crc:file.readUInt32LE(at+16),size:file.readUInt32LE(at+20),plain:file.readUInt32LE(at+24),local:file.readUInt32LE(at+42)});at=next;
  }
  if(at!==end)throw new AppError('Excel 压缩目录异常');
  return (name:string,optional=false)=>{
    if(cache.has(name))return cache.get(name)!;
    const e=entries.get(name);if(!e){if(optional)return '';throw new AppError('Excel 缺少工作簿数据，请重新另存');}
    if(e.flags&1)throw new AppError('请先移除 Excel 密码保护');
    if(e.plain>limit||e.size>limit||total+e.plain>30*1024*1024)throw new AppError('Excel 内容过大，请拆分工作簿',413);
    if(e.local+30>offset||file.readUInt32LE(e.local)!==0x04034b50)throw new AppError('Excel 数据损坏');
    const start=e.local+30+file.readUInt16LE(e.local+26)+file.readUInt16LE(e.local+28);
    if(start+e.size>offset||![0,8].includes(e.method))throw new AppError('Excel 数据压缩格式不支持');
    let raw:Buffer;try{raw=e.method===0?file.subarray(start,start+e.size):inflateRawSync(file.subarray(start,start+e.size),{maxOutputLength:limit});}catch{throw new AppError('Excel 数据损坏或过大');}
    if(raw.length!==e.plain||crc32(raw)!==e.crc)throw new AppError('Excel 数据校验失败，请重新另存');
    let value:string;try{value=new TextDecoder('utf-8',{fatal:true}).decode(raw);}catch{throw new AppError('Excel 文字编码异常');}
    total+=raw.length;cache.set(name,value);return value;
  };
}
const local=(n:Item)=>String(n.name||'').split(':').at(-1);
const children=(n:Item|undefined,name:string):Item[]=>(n?.elements||[]).filter((x:Item)=>local(x)===name);
const attr=(n:Item,key:string)=>Object.entries(n.attributes||{}).find(([k])=>k.split(':').at(-1)===key)?.[1] as string||'';
function xml(value:string){
  if(/<!\s*(DOCTYPE|ENTITY)\b/i.test(value))throw new AppError('Excel 包含不支持的 XML 声明');
  if((value.match(/</g)||[]).length>200000)throw new AppError('Excel 结构过大，请拆分',413);
  // SAX-like depth guard runs before the XML library allocates its recursive result.
  let depth=0;for(const m of value.matchAll(/<\s*(\/?)\s*([\w:.-]+)\b[^>]*>/g)){if(m[1])depth--;else if(!/\/\s*>$/.test(m[0]))depth++;if(depth>48||depth<0)throw new AppError('Excel XML 结构异常');}
  try{return xml2js(value,{compact:false,ignoreComment:true,ignoreInstruction:true}) as Item;}catch{throw new AppError('Excel XML 无法读取');}
}
const root=(tree:Item,name:string)=>children(tree,name)[0];
function content(n:Item|undefined):string{if(!n)return '';return (n.elements||[]).map((x:Item)=>x.type==='text'||x.type==='cdata'?String(x.text??x.cdata??''):content(x)).join('');}
function rich(n:Item|undefined):string{if(!n)return '';if(local(n)==='t')return content(n);return (n.elements||[]).filter((x:Item)=>local(x)!=='rPh').map((x:Item)=>rich(x)).join('');}
const normalized=(s:string)=>s.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
export const excelFields:Record<string,string>={name:'公司名称',country:'国家/地区',city:'城市',role:'类型/角色',queue:'优先级',url:'官网',email:'公司邮箱',phone:'公司电话',note:'备注',verification:'原表核验说明',planned_date:'首封计划日',version:'邮件版本',contact_name:'联系人姓名',contact_title:'职位',contact_channel:'联系人邮箱/WhatsApp',sent_on:'首封实际发送日',reply_summary:'客户回复摘要',status:'当前阶段',owner:'负责人',next_action:'下次动作',next_date:'下次动作日期',follow4:'第4天跟进计划',follow10:'第10天跟进计划',follow20:'第20天跟进计划',linkedin_added:'LinkedIn已加',subject:'外文主题',body:'外文正文',cnsubject:'中文主题',cn:'中文正文',language:'语言',source_id:'原表ID'};
const aliases:Record<string,string[]>={name:['公司','公司名称','客户','客户名称','company','companyname'],country:['国家','国家地区','国家/地区','country'],city:['城市','city'],role:['类型','角色','公司角色','行业'],queue:['优先级','队列'],url:['官网','公司官网','网址','website'],email:['邮箱','公司邮箱','收件邮箱','email'],phone:['电话','公司电话','phone'],note:['备注','说明'],verification:['联系方式校验状态','核验情况'],planned_date:['首封计划日(可改)','首封计划日','计划发送日'],version:['邮件版本','版本'],contact_name:['对口联系人姓名','联系人姓名'],contact_title:['职位','联系人职位'],contact_channel:['联系人邮箱/WhatsApp','联系人邮箱','whatsapp'],sent_on:['首封实际发送日','实际发送日'],reply_summary:['客户回复摘要','回复摘要'],status:['当前阶段','跟进阶段','客户阶段'],owner:['负责人','业务员'],next_action:['下次动作','下一步动作'],next_date:['下次动作日期','下次跟进日期'],follow4:['第4天跟进'],follow10:['第10天跟进'],follow20:['第20天(收尾)'],linkedin_added:['LinkedIn已加'],subject:['主题(自动生成)','主题(原文)','外文主题','英文主题'],body:['正文(自动生成,复制发送)','正文(原文)','外文正文','英文正文'],cnsubject:['主题(中文)','中文主题'],cn:['正文(中文对照)','正文(中文)','中文正文','中文对照'],language:['语言'],source_id:['ID','编号']};
const keyFor=(s:string)=>Object.entries(aliases).find(([,values])=>values.some(v=>normalized(v)===normalized(s)))?.[0]||'';
function column(ref:string){let n=0;for(const c of ref.match(/^[A-Z]+/i)?.[0].toUpperCase()||'')n=n*26+c.charCodeAt(0)-64;return n-1;}
function letterCol(n:number){let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
function validDay(s:string){return /^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}
function asDate(s:string,date1904:boolean){
  if(!s)return '';let value=s.trim();
  if(/^\d{4}-\d{2}-\d{2}T/.test(value))value=value.slice(0,10);
  if(/^\d{4}[/.年]\d{1,2}[/.月]\d{1,2}日?$/.test(value)){const parts=value.match(/\d+/g)!;value=parts[0]+'-'+parts[1].padStart(2,'0')+'-'+parts[2].padStart(2,'0');}
  if(/^\d{4}-\d{1,2}-\d{1,2}$/.test(value)){const p=value.split('-');value=p[0]+'-'+p[1].padStart(2,'0')+'-'+p[2].padStart(2,'0');}
  if(validDay(value))return value;
  if(/^\d+(?:\.\d+)?$/.test(value)){let serial=Math.floor(Number(value));if(!Number.isFinite(serial)||serial<(date1904?0:1)||serial>100000||!date1904&&serial===60)return '';if(!date1904&&serial<60)serial++;return new Date((date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,30))+serial*86400000).toISOString().slice(0,10);}
  return '';
}
export function parseExcel(file:Buffer,filename:string,existing:Item[]=[],options:Item={}){
  if(!/\.xlsx$/i.test(filename))throw new AppError('目前支持 .xlsx；旧版 .xls 请先用 Excel 或 WPS 另存为 .xlsx');
  const read=archive(file),book=root(xml(read('xl/workbook.xml')),'workbook');
  if(!book)throw new AppError('无法识别 Excel 工作簿');
  const rels=children(root(xml(read('xl/_rels/workbook.xml.rels')),'Relationships'),'Relationship');
  const sharedXml=read('xl/sharedStrings.xml',true),shared=sharedXml?children(root(xml(sharedXml),'sst'),'si').map(rich):[];
  const date1904=['1','true'].includes(attr(children(book,'workbookPr')[0]||{},'date1904'));
  const sheetDefs=children(children(book,'sheets')[0],'sheet');if(sheetDefs.length>40)throw new AppError('工作表过多，请拆分工作簿');
  const sheets=sheetDefs.map(s=>{
    const relation=rels.find(r=>attr(r,'Id')===attr(s,'id'));if(!relation||attr(relation,'TargetMode')==='External')throw new AppError('不支持外部工作表');
    const target=attr(relation,'Target'),part=path.posix.normalize(target.startsWith('/')?target.slice(1):path.posix.join('xl',target));
    if(!part.startsWith('xl/worksheets/')||!part.endsWith('.xml')||target.includes('\\'))throw new AppError('工作表路径异常');
    const tree=root(xml(read(part)),'worksheet');const rows:Item[]=[];let cells=0;
    for(const row of children(children(tree,'sheetData')[0],'row')){
      const rowNumber=Number(attr(row,'r'));if(!Number.isInteger(rowNumber)||rowNumber<1||rowNumber>1000000)throw new AppError('工作表行号异常');
      const values:string[]=[],missing:string[]=[];
      for(const c of children(row,'c')){if(++cells>60000)throw new AppError('工作表内容过多，请分批导入',413);const ref=attr(c,'r'),col=column(ref);if(col<0||col>=200||Number(ref.match(/\d+$/)?.[0])!==rowNumber)throw new AppError('工作表列号异常或超出200列');
        const type=attr(c,'t'),v=content(children(c,'v')[0]),hasFormula=children(c,'f').length>0;
        if(hasFormula&&!v){missing.push(letterCol(col));values[col]='';continue;}
        let text=type==='s'?shared[Number(v)]:type==='inlineStr'?rich(children(c,'is')[0]):v;
        if(type==='s'&&(!/^\d+$/.test(v)||text===undefined))throw new AppError('Excel 共享文字引用损坏');
        if(type==='e'){missing.push(letterCol(col));text='';}
        if((text||'').length>20000)throw new AppError('单元格文字过长，请拆分后导入',413);values[col]=text||'';
      }
      if(values.some(v=>v)||missing.length)rows.push({row:rowNumber,values,missing});
      if(rows.length>5000)throw new AppError('工作表超过5000行，请分批导入',413);
    }
    const links:Item={};const linkXml=read(path.posix.join(path.posix.dirname(part),'_rels',path.posix.basename(part)+'.rels'),true);
    const linkRels=linkXml?children(root(xml(linkXml),'Relationships'),'Relationship'):[];
    for(const link of children(children(tree,'hyperlinks')[0],'hyperlink')){const relation=linkRels.find(r=>attr(r,'Id')===attr(link,'id'));const target=relation&&attr(relation,'Target');if(target&&/^https?:\/\//i.test(target))links[attr(link,'ref')]=target;}
    let header=rows[0],score=-1;for(const row of rows.slice(0,25)){const keys=row.values.map(keyFor),value=new Set(keys.filter(Boolean)).size+(keys.includes('name')?5:0)+(keys.includes('country')?3:0);if(value>score){score=value;header=row;}}
    return {name:attr(s,'name'),rows,header,score,links};
  });
  const selected=options.sheet?sheets.find(s=>s.name===options.sheet):sheets.find(s=>s.name==='客户总表')||[...sheets].sort((a,b)=>b.score-a.score)[0];
  if(!selected)throw new AppError('没有找到所选工作表');
  const header=options.header_row?selected.rows.find(r=>r.row===Number(options.header_row)):selected.header;if(!header)throw new AppError('未找到表头，请选择有数据的表头行');
  const columns=Array.from({length:header.values.length},(_,i)=>({column:letterCol(i),label:header.values[i]||'（空表头）'}));
  const mapping:Item={};for(const c of columns){const key=options.mapping?options.mapping[c.column]||'':keyFor(c.label);if(key&&(typeof key!='string'||!Object.hasOwn(excelFields,key)))throw new AppError('列映射无效');mapping[c.column]=key;}
  const mapped=Object.values(mapping).filter(Boolean);if(new Set(mapped).size!==mapped.length)throw new AppError('一个字段只能对应一列，请调整映射');
  const warnings=['仅读取保存值，不执行公式、宏或外部链接。解析不会写入系统。','客户核验说明及旧稿按原表保存，不代表本次已核实；导入草稿不代表已发送。'];
  const templates=sheets.find(s=>s.name==='模板'),letters=sheets.find(s=>s.name==='开发信(分公司)');
  const values=(s:Item,r:Item)=>{const value:Item={};s.header?.values.forEach((h:string,i:number)=>{const key=keyFor(h);if(key&&r.values[i])value[key]=r.values[i];});return value;};
  const templateRows=templates?.rows.filter(r=>r.row>templates.header.row).map(r=>values(templates,r))||[];
  const letterRows=letters?.rows.filter(r=>r.row>letters.header.row).map(r=>values(letters,r))||[];
  const candidates:Item[]=[];
  for(const row of selected.rows.filter(r=>r.row>header.row)){
    const raw:Item={};for(const [col,key] of Object.entries(mapping)){const value=key==='url'?selected.links[col+row.row]||row.values[column(col)]:row.values[column(col)];if(key&&value)raw[key as string]=value.trim();}
    if(!raw.name)continue;if(candidates.length>=100)throw new AppError('单批最多100家客户，请拆分工作表');
    const fields:Item={},tracking:Item={},notes:string[]=[];for(const k of ['name','country','city','role','queue','email','phone','note'])if(raw[k])fields[k]=raw[k];
    if(raw.url){let u=raw.url;if(!/^https?:\/\//i.test(u)&&/^(?:[a-z\d-]+\.)+[a-z]{2,}(?:[/:?#]|$)/i.test(u))u='https://'+u;try{const url=new URL(u);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error();fields.url=url.href;}catch{notes.push('官网地址格式不完整，请修正后录入');}}
    if(raw.verification)fields.verification='原表记载：'+raw.verification+'（本次导入未重新核验）';
    for(const k of ['planned_date','sent_on','next_date','follow4','follow10','follow20'])if(raw[k]){const day=asDate(raw[k],date1904);if(day){if(k==='planned_date')fields[k]=day;else tracking[k]=day;}else notes.push(excelFields[k]+'无法识别：'+raw[k]);}
    for(const k of ['contact_name','contact_title','contact_channel','reply_summary','status','owner','next_action','linkedin_added'])if(raw[k])tracking[k]=raw[k];
    if(row.missing.length)notes.push('无可用结果或公式报错的单元格：'+row.missing.map((c:string)=>c+row.row).join('、')+'；未导入这些值');
    const matches=existing.filter(a=>normalized(a.name)===normalized(fields.name)&&(!fields.country||a.country===fields.country));
    if(matches.length===1){fields.id=matches[0].id;fields.country||=matches[0].country;fields.name=matches[0].name;}else if(matches.length>1)notes.push('存在多个同名客户，请核对国家和主体');
    const candidateLetter=raw.body?raw:letterRows.find(r=>normalized(r.name||'')===normalized(fields.name));
    let draft=candidateLetter,template=false;if(!draft?.body){draft=templateRows.find(r=>r.version===raw.version);template=!!draft;}
    if(draft?.subject&&draft.body&&draft.cnsubject&&draft.cn){const fill=(s:string)=>s.replaceAll('\\n','\n').replaceAll('{{公司}}',fields.name);fields.letter={language:draft.language||String(raw.version||'').split('-')[0]||'其他',subject:fill(draft.subject),body:fill(draft.body),cnsubject:fill(draft.cnsubject),cn:fill(draft.cn),evidence:template?'原表模板整理的候选旧稿；事实、称谓及占位符需要复核':'Excel 原稿迁入；内容需要复核'};if(template)notes.push('邮件公式未保存结果，已从“模板”工作表按版本整理候选旧稿；保留其他占位符，请复核后再用');}
    else if(raw.version||draft)notes.push('未读到完整双语开发信，暂不生成草稿');
    candidates.push({key:String(row.row),fields,tracking,source:{filename,sheet:selected.name,row:row.row,original_id:raw.source_id||''},warnings:notes,missing:!fields.country?['国家/地区']:[]});
  }
  if(!mapped.includes('name'))warnings.push('尚未映射“公司名称”，请展开列对应关系调整。');
  if(!candidates.length)warnings.push('未找到客户行，请选择客户工作表并核对表头及列对应关系。');
  return {filename,hash:createHash('sha256').update(file).digest('hex'),sheet:selected.name,header_row:header.row,sheets:sheets.map(s=>({name:s.name,rows:s.rows.length,header_row:s.header?.row||1})),columns,mapping,fields:excelFields,candidates,warnings};
}
