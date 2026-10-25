import {inflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {xml2js} from 'xml-js';
import {AppError} from '../app/errors';
type Item=Record<string,any>;
const maxXml=6*1024*1024;
function documentXml(file:Buffer){
  if(file.length>8*1024*1024)throw new AppError('Word 文件请控制在 8MB 以内',413);
  let end=-1;for(let i=file.length-22;i>=Math.max(0,file.length-65557);i--)if(file.readUInt32LE(i)===0x06054b50&&i+22+file.readUInt16LE(i+20)===file.length){end=i;break;}
  if(end<0)throw new AppError('无法读取此文件。请使用未加密的 .docx 文档；旧版 .doc 请先另存为 .docx');
  const count=file.readUInt16LE(end+10),offset=file.readUInt32LE(end+16);
  if(file.readUInt16LE(end+4)||file.readUInt16LE(end+6)||count===65535||offset===0xffffffff)throw new AppError('不支持此 Word 压缩格式，请在 Word 中重新另存为 .docx');
  let at=offset,found:Buffer|null=null;
  for(let i=0;i<count;i++){
    if(at+46>file.length||file.readUInt32LE(at)!==0x02014b50)throw new AppError('Word 压缩目录已损坏');
    const flags=file.readUInt16LE(at+8),method=file.readUInt16LE(at+10),size=file.readUInt32LE(at+20),plain=file.readUInt32LE(at+24),nl=file.readUInt16LE(at+28),extra=file.readUInt16LE(at+30),comment=file.readUInt16LE(at+32),local=file.readUInt32LE(at+42);
    if(at+46+nl+extra+comment>file.length)throw new AppError('Word 压缩目录已损坏');
    const name=file.subarray(at+46,at+46+nl).toString('utf8');at+=46+nl+extra+comment;
    if(name!=='word/document.xml')continue;
    if(found)throw new AppError('Word 中存在重复正文，请重新另存文件');
    if(flags&1)throw new AppError('请先移除 Word 密码保护后再导入');
    if(plain>maxXml||size>maxXml)throw new AppError('Word 正文过大，请分批导入',413);
    if(local+30>file.length||file.readUInt32LE(local)!==0x04034b50)throw new AppError('Word 正文已损坏');
    const start=local+30+file.readUInt16LE(local+26)+file.readUInt16LE(local+28);
    if(start+size>file.length||![0,8].includes(method))throw new AppError('无法读取 Word 正文压缩格式');
    try{found=method===0?file.subarray(start,start+size):inflateRawSync(file.subarray(start,start+size),{maxOutputLength:maxXml});}catch{throw new AppError('Word 正文损坏或过大，请重新另存后导入');}
    if(found.length!==plain||found.length>maxXml)throw new AppError('Word 正文长度异常，请重新另存文件');
  }
  if(!found)throw new AppError('未找到 Word 正文，请确认上传的是 .docx 文档');
  try{return new TextDecoder('utf-8',{fatal:true}).decode(found);}catch{throw new AppError('Word 正文编码无法识别，请重新另存为 .docx');}
}
const tag=(n:Item)=>String(n.name||'').split(':').at(-1);
function text(n:Item,depth=0):string{
  if(depth>64)throw new AppError('Word 结构过于复杂，请简化后导入');
  if(['del','moveFrom','instrText','delText'].includes(tag(n)||''))return '';
  if(tag(n)==='t')return (n.elements||[]).map((x:Item)=>x.text||x.cdata||'').join('');
  if(['br','cr'].includes(tag(n)||''))return '\n';if(tag(n)==='tab')return '\t';
  return (n.elements||[]).map((x:Item)=>text(x,depth+1)).join('');
}
function children(n:Item,name:string):Item[]{return (n.elements||[]).filter((x:Item)=>tag(x)===name);}
function blocks(n:Item,depth=0):Item[]{
  if(depth>64)throw new AppError('Word 结构过于复杂，请简化后导入');
  if(tag(n)==='p'){const props=children(n,'pPr')[0],style=props&&children(props,'pStyle')[0];return [{type:'p',text:text(n).trim(),style:Object.entries(style?.attributes||{}).find(([k])=>k.split(':').at(-1)==='val')?.[1]||''}];}
  if(tag(n)==='tbl')return [{type:'table',rows:children(n,'tr').map(row=>children(row,'tc').map(cell=>blocks(cell,depth+1).map(p=>p.text||'').join('\n').trim()))}];
  return (n.elements||[]).flatMap((x:Item)=>blocks(x,depth+1));
}
const labels:Record<string,string>={'公司名称':'name','客户名称':'name','公司':'name','Company':'name','Company Name':'name','国家或地区':'country','国家/地区':'country','国家':'country','Country':'country','城市':'city','City':'city','官网':'url','公司官网':'url','网站':'url','Website':'url','官网/原入口':'url','邮箱':'email','公开邮箱':'email','Email':'email','电话':'phone','公开电话':'phone','Phone':'phone','地址':'address','详细地址':'address','Address':'address','公司角色':'role','角色':'role','下一步与限制':'note','写信依据':'writing_fact','公开来源':'writing_source','产品功能切入口':'product_focus','产品切入口':'product_focus','核验情况':'verification','联系方式核验':'verification','核验日期':'verified_on'};
const stripNumber=(s:string)=>s.replace(/^\s*(?:客户\s*\d{1,3}\s*[:：.、)）]?\s*|\d{1,3}(?:[.、)）:：]\s*|\s+))/,'');
const norm=(s:string)=>stripNumber(s.normalize('NFKC')).replace(/\s+/g,' ').trim().toLowerCase();
const empty=(s:string)=>!s.trim()||/^(待核实|待补充|待填写|待核|尚未取得|未填写|—|-)$/i.test(s.trim());
const escaped=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const labelPattern=Object.keys(labels).sort((a,b)=>b.length-a.length).map(escaped).join('|');
function fields(value:string){const result:Item={};const re=new RegExp(`(?:^|\\n|\\s{2,})(${labelPattern})\\s*[:：]\\s*([\\s\\S]*?)(?=(?:\\n|\\s{2,})(?:${labelPattern})\\s*[:：]|$)`,'gi');for(const m of value.matchAll(re)){const k=Object.keys(labels).find(k=>k.toLowerCase()===m[1].toLowerCase())!;if(!empty(m[2]))result[labels[k]]=m[2].trim();}return result;}
function splitLetter(s:string,chinese=false){const lines=s.split('\n');const first=lines.findIndex(l=>l.trim());if(first<0)return null;const subject=lines[first].replace(chinese?/^(?:中文)?主题\s*[:：]\s*/i:/^(?:Subject|Тема|Tema)\s*[:：]\s*/i,'').trim();if(subject===lines[first].trim())return null;return {subject,body:lines.slice(first+1).join('\n').trim()};}
export function parseWord(file:Buffer,filename:string,existing:Item[]=[]){
  if(!/\.docx$/i.test(filename))throw new AppError('目前支持 .docx；旧版 .doc 请先在 Word 中另存为 .docx');
  const xml=documentXml(file);if(/<!\s*(DOCTYPE|ENTITY)\b/i.test(xml))throw new AppError('此文档包含不支持的 XML 声明，请重新另存为 .docx');
  if((xml.match(/</g)||[]).length>100000)throw new AppError('Word 结构过大，请分批导入',413);
  let tree:Item;try{tree=xml2js(xml,{compact:false,ignoreComment:true,ignoreInstruction:true}) as Item;}catch{throw new AppError('Word 正文 XML 无法读取，请重新另存文件');}
  const content=blocks(tree),allText=content.map(b=>b.type==='p'?b.text:b.rows.map((r:string[])=>r.join(' | ')).join('\n')).filter(Boolean).join('\n\n');
  const warnings:string[]=['本次只整理客户研究资料和双语草稿；Word 中的跟进状态、项目、签名及发送记录不会自动恢复。'];
  if(/<(?:\w+:)?(?:ins|del)\b/.test(xml))warnings.push('文档包含修订标记，请在预览中核对，已删除文字不参与识别。');
  const raw:Item[]=[];let current:Item|null=null,mode='info';
  const add=(data:Item,excerpt:string)=>{const candidate={fields:data,excerpt:excerpt.slice(0,2500),warnings:[]};raw.push(candidate);return candidate;};
  const match=(name:string)=>existing.filter(a=>norm(a.name)===norm(name));
  for(const block of content){
    if(block.type==='p'){
      const value=block.text;if(!value)continue;const f=fields(value);
      const known=existing.filter(a=>norm(value)===norm(a.name)||(/^(?:Heading[1-6]|标题[1-6])$/i.test(block.style)||/^(?:客户\s*\d{1,3}\s*[:：]|\d{1,3}\s+)/.test(value))&&norm(value).startsWith(norm(a.name))&&norm(value).length<=norm(a.name).length+25);
      if(f.name||known.length===1){current=add({...f,name:f.name||known[0].name},value);mode='info';continue;}
      if(/^(?:Heading1|标题1)$/i.test(block.style)||/^客户\s*\d{1,3}\s*[:：]/.test(value)){current=/^(客户资料|公司资料|客户信息|公司信息|客户开发资料|客户索引|俄语简短介绍稿|客户回复话术|技术询价与确认清单|补充获客渠道|操作历史|客户开发跟进记录表|签名与使用)$/.test(value)?null:add({name:stripNumber(value.split('\n')[0]).trim()},value);mode='info';continue;}
      if(current&&/^双语开发信/.test(value)){mode='letter';current.language=value.match(/\b(EN|PL|TR|AR|VI|ID|RO|RU)\b/)?.[1]||'其他';continue;}
      if(current&&/^(?:联系人|关联项目|跟进记录|任务)$/.test(value)){mode='other';continue;}
      if(current&&mode==='info'){Object.assign(current.fields,f);current.excerpt=(current.excerpt+'\n'+value).slice(0,2500);}
    }else{
      const rows:string[][]=block.rows;if(!rows.length)continue;
      const headerKey=(c:string)=>labels[c.replace(/[（(][^）)]*[）)]/g,'').trim()]||(/^(编号|当前阶段)$/.test(c.trim())?'__ignore':'');
      const headers=rows[0].map(headerKey),columnMode=headers.filter(Boolean).length>=2&&headers.filter(Boolean).length>=rows[0].length*.6;
      if(columnMode&&headers.includes('name')&&headers.some(k=>k&&k!=='name'&&k!=='__ignore')){
        for(const row of rows.slice(1)){const data:Item={};headers.forEach((key,i)=>{if(key&&key!=='__ignore'&&row[i]&&!empty(row[i]))data[key]=row[i].trim();});if(data.name)add(data,row.join(' | '));}continue;
      }
      if(current&&rows[0].some(c=>/外文正文|外文信|外文首封草稿|英文原文|Original/i.test(c))&&rows[0].some(c=>/中文对照|中文译文/.test(c))){
        const enIndex=rows[0].findIndex(c=>/外文正文|外文信|外文首封草稿|英文原文|Original/i.test(c)),cnIndex=rows[0].findIndex(c=>/中文对照|中文译文/.test(c));
        const foreign=splitLetter(rows.slice(1).map(r=>r[enIndex]||'').join('\n')),cn=splitLetter(rows.slice(1).map(r=>r[cnIndex]||'').join('\n'),true);
        if(foreign?.body&&foreign.subject&&cn?.body&&cn.subject){if(current.fields.letter)current.warnings.push('识别到多封草稿，本次预览保留最后一封，其他版本可分别录入。');current.fields.letter={language:rows[0].join(' ').match(/\b(EN|PL|TR|AR|VI|ID|RO|RU)\b/)?.[1]||current.language||'其他',subject:foreign.subject,body:foreign.body,cnsubject:cn.subject,cn:cn.body};}else current.warnings.push('双语正文或主题不完整，未自动生成开发信。');
        continue;
      }
      if(columnMode&&current&&mode==='info'){for(const row of rows.slice(1))headers.forEach((key,i)=>{if(key&&key!=='__ignore'&&row[i]&&!empty(row[i]))current!.fields[key]=row[i].trim();});continue;}
      const pairs:Item={};for(const row of rows)for(let i=0;i+1<row.length;i+=2){const key=labels[row[i].trim()];if(key&&!empty(row[i+1]))pairs[key]=row[i+1].trim();}
      if(pairs.name){current=add(pairs,rows.map(r=>r.join(' | ')).join('\n'));mode='info';}else if(current&&mode==='info')Object.assign(current.fields,pairs);
    }
  }
  const merged=new Map<string,Item>();
  for(const c of raw){const f=c.fields;if(!f.name||!['country','url','email','phone','address','letter'].some(k=>f[k]))continue;const found=match(f.name).filter(a=>!f.country||a.country===f.country);if(found.length===1){f.id=found[0].id;f.country||=found[0].country;f.name=found[0].name;}else if(found.length>1)c.warnings.push('存在多个同名客户，请先核对主体。');
    const key=f.id||norm(f.name)+'|'+(f.country||'');const old=merged.get(key);if(old){Object.assign(old.fields,f);old.excerpt=(old.excerpt+'\n'+c.excerpt).slice(0,3000);old.warnings.push(...c.warnings);}else merged.set(key,c);
  }
  const candidates=[...merged.values()].map((c,i)=>({...c,key:String(i),warnings:[...new Set(c.warnings)],missing:!c.fields.country?['国家或地区']:[]}));
  if(candidates.length>100)throw new AppError('单批最多100家客户，请拆分 Word 文件');
  if(!allText)warnings.push('未读到可识别正文；扫描件和图片暂不支持文字识别。');
  if(!candidates.length)warnings.push('未识别到完整客户字段。你可以选择一家已有客户，把需要的正文保存为参考备注。');
  return {filename,hash:createHash('sha256').update(file).digest('hex'),candidates,warnings,text:allText.slice(0,30000),text_truncated:allText.length>30000};
}
