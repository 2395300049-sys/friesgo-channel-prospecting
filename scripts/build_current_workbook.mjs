import fs from 'node:fs/promises';
import path from 'node:path';
import {Workbook,SpreadsheetFile} from '@oai/artifact-tool';
const root=process.env.FRIESGO_OUTPUT_DIR;
const records=JSON.parse(await fs.readFile(path.join(root,'canonical_accounts.json'),'utf8'));
const model=JSON.parse(await fs.readFile(path.join(root,'operating_model.json'),'utf8'));
const decisions=JSON.parse(await fs.readFile(path.join(root,'action_decisions.json'),'utf8'));
const wb=Workbook.create();
const action=wb.worksheets.add('当前行动');
const tech=wb.worksheets.add('产品与报价条件');
const letters=wb.worksheets.add('逐家开发信');
const evidence=wb.worksheets.add('D_客户证据');
const log=wb.worksheets.add('私有操作日志模板');
const navy='#24364B',pale='#F1F5F8',yellow='#FFF4D1';
function col(n){let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;}
function sheet(s,title,heads,rows,widths,height=70,note=''){
 const end=col(heads.length),last=rows.length+4;
 s.showGridLines=false;s.getRange(`A1:${end}${last+2}`).format={font:{name:'Arial',size:10,color:'#202020'},verticalAlignment:'top'};
 s.getRange('A1').values=[[title]];s.getRange('A1').format.font={size:16,bold:true,color:navy};s.getRange('A1').format.rowHeight=30;
 s.getRange('A2').values=[[note]];s.getRange('A2').format.font={size:10,color:'#555555'};s.getRange('A2').format.rowHeight=25;
 s.getRange(`A4:${end}4`).values=[heads];s.getRange(`A4:${end}4`).format={font:{size:10,bold:true,color:'#FFFFFF'},fill:navy,wrapText:true,rowHeight:32,verticalAlignment:'center'};
 s.getRange(`A5:${end}${last}`).values=rows;s.getRange(`A5:${end}${last}`).format.wrapText=true;s.getRange(`A5:${end}${last}`).format.rowHeight=height;
 widths.forEach((w,i)=>s.getRange(`${col(i+1)}1:${col(i+1)}${last+2}`).format.columnWidth=w);
 for(let i=5;i<=last;i++)if(i%2===0)s.getRange(`A${i}:${end}${i}`).format.fill=pale;
 s.getRange(`A4:${end}${last}`).format.borders={preset:'all',style:'thin',color:'#D9D9D9'};
 s.freezePanes.freezeRows(4);s.freezePanes.freezeColumns(2);
 return last;
}
const end=sheet(action,'FriesGo 当前20家候选账户及推进条件',
 ['ID','公司','国家','当前队列','讨论位置','首封只确认一件事','进入下一步的证据','停止条件','负责人','当前阶段','操作状态','下次日期','正式报价'],
 records.map(a=>[a.id,a.display_name,a.country,a.review.queue,a.review.entry_product,a.review.next_commitment,a.review.unlock,a.review.stop,'',a.review.stage,a.review.outreach_status,'',decisions[a.id].ready?'条件齐全 待正式批准':'未就绪']),
 [9,25,14,19,32,55,58,58,16,26,18,17,18],85,
 `${model.report_date}；P1建议小批验证，P2先补条件，P3暂缓。采购权限和当前需求均未确认。填写前另存私有副本。`);
action.tables.add(`A4:M${end}`,true,'CurrentActions');
 action.getRange(`I5:I${end}`).format.fill=yellow;action.getRange(`K5:L${end}`).format.fill=yellow;
 action.getRange(`K5:K${end}`).dataValidation={rule:{type:'list',values:['未发送','已发送待投递确认','退信待修复','自动回复','人工回复','转介待核','暂停','停止联系']}};
 action.getRange(`L5:L${end}`).setNumberFormat('yyyy-mm-dd');
 action.getRange('A27').values=[['账户数']];action.getRange('B27').formulas=[[`=COUNTA(A5:A${end})`]];
 action.getRange('C27').values=[['P1']];action.getRange('D27').formulas=[[`=COUNTIF(D5:D${end},"P1 小批验证")`]];
 action.getRange('E27').values=[['P2']];action.getRange('F27').formulas=[[`=COUNTIF(D5:D${end},"P2 条件验证")`]];
 action.getRange('G27').values=[['P3']];action.getRange('H27').formulas=[[`=COUNTIF(D5:D${end},"P3 暂缓")`]];

const techRows=model.technical_fields.map(r=>[...r,'','']);
techRows.push(['','','','','','','']);
techRows.push(['报价字段','所需事实','状态','责任','推进时点','凭据/理由','实际内容']);
const labels=['确定规格','数量与时间','采购/选品职权','目的地及收货主体','Incoterm','付款条件','适用准入与文件','包装及运费','授权成本','审批与有效期'];
model.quote_fields.forEach((key,i)=>techRows.push([key,labels[i],'待确认','业务负责人','正式报价前','','']));
sheet(tech,'产品资料缺项及单个询价的报价条件',
 ['编号','应核资料','当前证据或状态','负责来源','使用前提','凭据/理由','实际内容'],techRows,[30,52,65,25,35,55,55],50,
 '黄色格用于私有副本。每个真实询价另建一份报价条件；未取得证据保持未知。成本、买方回复不上传公开仓库。');
tech.getRange(`F5:G${techRows.length+4}`).format.fill=yellow;
sheet(letters,'逐家开发信草稿及母稿',
 ['ID','公司','队列','收件入口','主题 首选语言','首选正文','中文译文','英文主题','英文母稿'],
 records.map(a=>[a.id,a.display_name,a.review.queue,a.email,a.local_subject,a.local,a.chinese,a.subject,a.english]),
 [9,25,19,38,52,110,100,52,110],320,'全部未发送。P3草稿暂存；每封事实、问题和推进条件逐家不同。');
letters.tables.add(`A4:I${records.length+4}`,true,'CurrentLetters');
const evHeads=['客户ID','优先级','国家/地区','公司名称','官网','客户类型','匹配产品','ICP匹配分','匹配依据','需求/采购信号','联系人/岗位','邮箱','电话/WhatsApp','LinkedIn','其他联系路径','来源URL','来源类型','证据等级','核验日期','验证状态','客户证据阶段','采购权限置信度','个性化切入点','下一步行动','负责人','跟进日期','备注/风险','地址','项目/应用','项目证据边界','判断复审日期','进入下一步','停止条件'];
sheet(evidence,'客户公开证据与原始联系资料',evHeads,
 records.map(a=>[a.id,a.review.queue,a.country,a.name,a.website,a.role,a.product,a.score,a.fact,'无已核当前RFQ',a.person,a.email,a.phone,a.alt.match(/https:\/\/(?:www\.)?linkedin\.com\/[^；（\s]+/)?.[0]||'未核实',a.alt,a.sources.join('\n'),'公司官网及注明的补充来源',a.evidence_grade,a.checked_on,a.verification,a.review.stage,a.authority,a.angle,a.next_action,'','',a.risk,a.address,a.scenario,a.project_status,a.review.reviewed_on,a.review.unlock,a.review.stop]),
 [9,19,14,42,42,35,35,14,65,32,50,38,52,48,80,100,35,45,17,60,30,40,65,95,16,17,70,65,70,65,17,60,60],150,
 'ICP分仅保留v1轨迹，不决定当前P队列、采购意向或报价。核验日期为原事实日期，判断复审日期单列。');
evidence.tables.add(`A4:AG${records.length+4}`,true,'CurrentEvidence');
sheet(log,'私有操作日志空模板',
 ['操作日期','客户ID','渠道','动作/结果','事实或回复摘要','证据位置','负责人','下一步','下次日期'],
 Array.from({length:20},()=>Array(9).fill('')),[18,12,20,26,65,45,18,55,18],35,
 '请复制到private目录或公司受控位置再填写；一行一个真实事件。未操作保持空白，自动回复不等于采购兴趣。');
log.getRange('A5:I24').format.fill=yellow;
wb.recalculate();
const qa=path.join(root,'previews');await fs.mkdir(qa,{recursive:true});
const inspect=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:20},maxChars:2000});
await fs.writeFile(path.join(qa,'workbook-errors.ndjson'),inspect.ndjson);
for(const [s,range,name]of [['当前行动','A1:H11','action'],['产品与报价条件','A1:E12','technical'],['逐家开发信','A4:F6','letters']]){
 const png=await wb.render({sheetName:s,range,scale:1.2,format:'png'});
 await fs.writeFile(path.join(qa,name+'.png'),new Uint8Array(await png.arrayBuffer()));
}
const output=await SpreadsheetFile.exportXlsx(wb);await output.save(path.join(root,'07_20家客户与推进工作簿.xlsx'));
console.log('Current workbook exported');
