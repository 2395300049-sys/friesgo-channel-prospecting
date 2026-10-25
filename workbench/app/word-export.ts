import {historyValue} from './history-format';
const xml=(x:any)=>String(x??'').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const run=(text:any,bold=false,size=20)=>`<w:r><w:rPr><w:rFonts w:ascii="Arial Unicode MS" w:hAnsi="Arial Unicode MS" w:eastAsia="Arial Unicode MS"/><w:sz w:val="${size}"/>${bold?'<w:b/>':''}</w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
const p=(text:any,style='',page=false,keep=false)=>`<w:p><w:pPr>${style?`<w:pStyle w:val="${style}"/>`:''}${page?'<w:pageBreakBefore/>':''}${keep?'<w:keepNext/>':''}<w:spacing w:after="70"/><w:snapToGrid w:val="0"/></w:pPr>${String(text??'').split('\n').map((x,i)=>(i?'<w:r><w:br/></w:r>':'')+run(x,!!style,style==='Title'?32:style==='Heading1'?28:style==='Heading2'?23:20)).join('')}</w:p>`;
const compactP=(text:any)=>`<w:p><w:pPr><w:spacing w:after="45" w:line="220" w:lineRule="exact"/><w:snapToGrid w:val="0"/></w:pPr>${String(text??'').split('\n').map((x,i)=>(i?'<w:r><w:br/></w:r>':'')+run(x,false,17)).join('')}</w:p>`;
const cell=(text:any,header=false,size=19)=>`<w:tc><w:tcPr><w:vAlign w:val="center"/>${header?'<w:shd w:fill="E8EDF2"/>':''}</w:tcPr><w:p><w:pPr><w:spacing w:after="40" w:before="40"/><w:snapToGrid w:val="0"/></w:pPr>${String(text??'').split('\n').map((x,i)=>(i?'<w:r><w:br/></w:r>':'')+run(x,header,size)).join('')}</w:p></w:tc>`;
const table=(rows:any[][],widths:number[],small=false)=>`<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="fixed"/><w:tblBorders>${['top','left','bottom','right','insideH','insideV'].map(x=>`<w:${x} w:val="single" w:sz="4" w:color="D1D8DE"/>`).join('')}</w:tblBorders><w:tblCellMar><w:top w:w="25" w:type="dxa"/><w:bottom w:w="25" w:type="dxa"/><w:left w:w="60" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(x=>`<w:gridCol w:w="${x}"/>`).join('')}</w:tblGrid>${rows.map((r,i)=>`<w:tr><w:trPr>${i===0?'<w:tblHeader/>':''}<w:cantSplit/></w:trPr>${r.map(x=>cell(x,i===0,small?17:19)).join('')}</w:tr>`).join('')}</w:tbl>`;
const section=(land=false)=>`<w:sectPr><w:pgSz w:w="${land?16838:11906}" w:h="${land?11906:16838}"${land?' w:orient="landscape"':''}/><w:pgMar w:top="${land?397:850}" w:bottom="${land?397:850}" w:left="${land?397:960}" w:right="${land?397:960}" w:header="0" w:footer="0"/></w:sectPr>`;
function substitute(text:string,s:any){return text.replaceAll('{{姓名}}',s.name||'[姓名]').replaceAll('{{官网}}',s.website||'[官网]').replaceAll('{{WhatsApp}}',s.whatsapp||'[WhatsApp]').replaceAll('[姓名]',s.name||'[姓名]').replaceAll('[官网]',s.website||'[官网]').replaceAll('[WhatsApp]',s.whatsapp||'[WhatsApp]');}
export function exportWord(data:any){
  let body=p('FriesGo Global 客户开发完整工作册','Title')+p('客户资料、双语开发信、项目与跟进记录')+p('导出时间：'+new Date().toISOString().slice(0,10));
  const settings=data.settings||{};
  body+=p('签名与使用','Heading1')+table([['项目','内容'],['姓名',settings.name],['职位',settings.position],['官网',settings.website],['WhatsApp',settings.whatsapp],['企业邮箱',settings.email]],[2200,7786]);
  body+=p('本文件包含导出时的客户资料及实际已登记记录。未填写字段保持空白；未替换的签名占位符需在发送前填写。')+p('客户索引','Heading1',true)+table([['编号','公司','国家或地区','当前阶段'],...data.accounts.map((a:any)=>[a.number?String(a.number).padStart(2,'0'):a.id,a.name,a.country,data.states.find((s:any)=>s.account_id===a.id)?.status||'未联系'])],[700,5000,1800,2486],true);
  for(const a of data.accounts){
    const s=data.states.find((s:any)=>s.account_id===a.id)||{};
    body+=p(`${a.number?String(a.number).padStart(2,'0')+'  ':''}${a.name}`,'Heading1',true);
    body+=compactP(`${a.country} / ${a.city||''}    ${a.role||''}    ${a.queue||''}`);
    body+=compactP(`官网：${a.url||'待补充'}\n邮箱：${a.email||'待补充'}    电话：${a.phone||'待补充'}\n地址：${a.address||'待补充'}`);
    body+=compactP(`联系方式核验：${a.verification||'待核实'}    核验日期：${a.verified_on||'待补充'}\n写信依据：${a.writing_fact||'待整理'}\n公开来源：${a.writing_source||'待补充'}`);
    body+=compactP(`当前阶段：${s.status||'未联系'}    负责人：${s.owner||''}\n下次动作：${s.next_action||''}\n下次日期：${s.next_date||''}`);
    const contacts=data.contacts.filter((c:any)=>c.account_id===a.id);
    if(contacts.length)body+=p('联系人','Heading2')+table([['姓名或部门','职位','邮箱 / 电话','核验'],...contacts.map((c:any)=>[c.name,c.title,[c.email,c.phone,c.whatsapp,c.linkedin].filter(Boolean).join('\n'),[c.verification,c.source_url,c.verified_on].filter(Boolean).join('\n')])],[1700,1800,3500,2986],true);
    for(const l of data.letters.filter((l:any)=>l.account_id===a.id))body+=p(`双语开发信 ${l.language} ${l.status==='candidate'?'研究候选稿':'未发送草稿'}`,'Heading2')+table([['外文正文','中文对照'],['Subject: '+l.subject+'\n\n'+substitute(l.body,settings),'主题：'+l.cnsubject+'\n\n'+substitute(l.cn,settings)]],[4993,4993]);
    const projects=data.projects.filter((p:any)=>p.links?.some((l:any)=>l.account_id===a.id));
    if(projects.length){body+=p('关联项目','Heading2');for(const project of projects)body+=p(`${project.name}\n阶段：${project.phase}；采购状态：${project.procurement_status}\n采购窗口：${project.window_start||'待核'} 至 ${project.window_end||'待核'}（${project.date_basis}）\n来源：${project.source_url||'待补充'}\n说明：${project.note||''}`);}
    const activities=data.activities.filter((x:any)=>x.account_id===a.id);
    if(activities.length){body+=p('跟进记录','Heading2');for(const x of activities){body+=p(`${x.occurred_on||x.created_at.slice(0,10)}  ${x.channel}  ${x.kind==='automatic_reply'?'自动回复':x.kind==='reply'?'人工回复':x.kind==='outreach'?'实际联系':'内部备注'}\n${x.summary}`);if(x.letter_snapshot)body+=p('当时登记的正文\nSubject: '+x.letter_snapshot.subject+'\n'+x.letter_snapshot.body);}}
    const tasks=data.tasks.filter((x:any)=>x.account_id===a.id);if(tasks.length)body+=p('任务','Heading2')+table([['动作','日期','状态'],...tasks.map((x:any)=>[x.title,x.due_date,x.status==='done'?'已完成':x.status==='cancelled'?'已取消':'待办'])],[6000,1800,2186],true);
  }
  if(data.russian)body+=p('俄语简短介绍稿','Heading1',true)+table(data.russian,[4993,4993]);
  body+=p('客户回复话术','Heading1',true);
  for(const [i,r] of data.replies.entries())body+=p(String(i+1).padStart(2,'0')+'  '+r.trigger,'Heading2')+p(r.text,'',false,true)+p('中文：'+r.cn,'',false,true)+p('处理：'+r.strategy);
  body+=p('技术询价与确认清单','Heading1',true)+table(data.tech,[1400,4200,4386],true);
  body+=p('补充获客渠道','Heading1',true)+table(data.channels,[1400,2500,3300,2786],true);
  if(data.history?.length){
    body+=p('操作历史','Heading1',true)+p('按登记时间倒序排列。旧日志未保存的修改前后内容无法补录；复制与导出均不代表发送。');
    for(const h of data.history){
      body+=p(new Date(h.created_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+'  '+h.summary,'Heading2');
      if(h.accounts?.length)body+=compactP('关联客户：'+h.accounts.map((a:any)=>a.name).join('、'));
      for(const c of h.changes||[])body+=compactP(c.label+'\n修改前：'+historyValue(c.before,h.accounts)+'\n修改后：'+historyValue(c.after,h.accounts));
      if(h.legacy)body+=compactP('旧日志：仅保存了时间、操作类型和版本号，未保存修改前后内容。');
      if(h.action==='copy_letter'&&h.details?.after)body+=compactP('当时复制的草稿（不代表已发送）\n'+historyValue(h.details.after,h.accounts));
    }
  }
  body+=`<w:p><w:pPr>${section()}</w:pPr></w:p>`;
  body+=p('客户开发跟进记录表','Title')+p('负责人：________________    记录周期：________________')+p('渠道格填写日期与动作；当前结果记录回复要点，下一步填写具体动作。');
  const widths=[3572,794,794,1020,1020,1077,1077,794,1361,1304,3231];
  const headers=['客户编号 / 公司名称','网站','邮箱','WhatsApp','LinkedIn','Facebook/IG','Zalo/微信','电话','当前结果','下次日期','下一步动作'];
  let record=table([headers,...data.accounts.map((a:any)=>[(a.number?String(a.number).padStart(2,'0')+'  ':'')+a.name,...Array(10).fill('')])],widths,true);
  record=record.replaceAll('<w:trPr>','<w:trPr><w:trHeight w:val="280" w:hRule="atLeast"/>').replaceAll('<w:spacing w:after="40" w:before="40"/>','<w:spacing w:after="0" w:before="0" w:line="190" w:lineRule="exact"/>');body+=record+section(true);
  const document=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  const styles=`<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:line="260" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial Unicode MS" w:hAnsi="Arial Unicode MS" w:eastAsia="Arial Unicode MS"/><w:sz w:val="20"/></w:rPr></w:style>${[['Title',32],['Heading1',28],['Heading2',23]].map(([name,size])=>`<w:style w:type="paragraph" w:styleId="${name}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="80" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/><w:color w:val="000000"/></w:rPr></w:style>`).join('')}</w:styles>`;
  return zip({
    '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml':document,'word/styles.xml':styles,
    'word/_rels/document.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  });
}
function crc32(bytes:Uint8Array){let c=0xffffffff;for(const byte of bytes){c^=byte;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function zip(files:Record<string,string>){const encoder=new TextEncoder();const chunks:Uint8Array[]=[];const central:Uint8Array[]=[];let offset=0;
  for(const [path,content] of Object.entries(files)){const name=encoder.encode(path),body=encoder.encode(content),crc=crc32(body);const local=new Uint8Array(30+name.length+body.length),v=new DataView(local.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint32(14,crc,true);v.setUint32(18,body.length,true);v.setUint32(22,body.length,true);v.setUint16(26,name.length,true);local.set(name,30);local.set(body,30+name.length);chunks.push(local);const dir=new Uint8Array(46+name.length),d=new DataView(dir.buffer);d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint32(16,crc,true);d.setUint32(20,body.length,true);d.setUint32(24,body.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);dir.set(name,46);central.push(dir);offset+=local.length;}
  const size=central.reduce((n,x)=>n+x.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,central.length,true);e.setUint16(10,central.length,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);const result=new Uint8Array(offset+size+22);let at=0;for(const chunk of [...chunks,...central,end]){result.set(chunk,at);at+=chunk.length;}return result;
}
