import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Workbook,SpreadsheetFile} from '@oai/artifact-tool';

const root=process.env.FRIESGO_OUTPUT_DIR;
if(!root)throw new Error('Run through scripts/reproduce.py --rebuild');
const records=JSON.parse(await fs.readFile(path.join(root,'canonical_accounts.json'),'utf8'));
const model=JSON.parse(await fs.readFile(path.join(root,'market_model.json'),'utf8'));
const wb=Workbook.create();
const action=wb.worksheets.add('20家行动名单');
const market=wb.worksheets.add('市场与渠道');
const channel=wb.worksheets.add('渠道地图与来源');
const mail=wb.worksheets.add('20封开发信');
const evidence=wb.worksheets.add('D_客户证据');
const colors={ink:'#252333',navy:'#3C315C',light:'#F3F1F7',line:'#DBD6E4',orange:'#E98A36',input:'#FFF3D2',white:'#FFFFFF',muted:'#6E6878'};
function col(n){let out='';while(n>0){n--;out=String.fromCharCode(65+n%26)+out;n=Math.floor(n/26);}return out;}
function base(s,range){s.showGridLines=false;s.getRange(range).format.font={name:'Arial',size:10,color:colors.ink};s.getRange(range).format.verticalAlignment='center';}
function header(s,range){s.getRange(range).format={fill:colors.navy,font:{name:'Arial',size:10,bold:true,color:colors.white},horizontalAlignment:'center',verticalAlignment:'center',wrapText:true};s.getRange(range).format.rowHeight=32;}
function title(s,text){s.getRange('A2').values=[[text]];s.getRange('A2').format.font={name:'Arial',size:15,bold:true,color:colors.navy};s.getRange('A2').format.rowHeight=27;}
function stripe(s,first,last,end){for(let r=first;r<=last;r++)if(r%2===0)s.getRange(`A${r}:${end}${r}`).format.fill=colors.light;}
function widths(s,arr){arr.forEach((w,i)=>s.getRange(`${col(i+1)}1:${col(i+1)}50`).format.columnWidth=w);}

const headers=['客户ID','优先级','国家/地区','公司名称','官网','客户类型','匹配产品','ICP匹配分','匹配依据','需求/采购信号','联系人/岗位','邮箱','电话/WhatsApp','LinkedIn','其他联系路径','来源URL','来源类型','证据等级','核验日期','验证状态','客户证据阶段','采购权限置信度','个性化切入点','下一步行动','负责人','跟进日期','备注/风险','地址','项目/应用场景','项目证据状态','项目/条件来源','联系来源','产品来源','备用联系详情','渠道ID','产品匹配25','渠道角色20','市场匹配15','商业品类信号15','采购岗位10','联系入口10','证据质量5','首封目标','英文主题','正文语言'];
base(evidence,'A1:AS28');title(evidence,'20家客户公开证据与评分');
evidence.getRange('A3').values=[['核验：2026-10-23；公司公开信息不等于采购需求；评分为联系优先顺序。']];
evidence.getRange('A3').format.font={size:10,color:colors.muted};
evidence.getRange('A5:AS5').values=[headers];header(evidence,'A5:AS5');
const rows=records.map(r=>[r.id,null,r.country,r.name,r.website,r.role,r.product,null,r.fact,'公开产品/业务信号；没有当前RFQ或已核订单',r.person,r.email,r.phone,
 r.alt.match(/https:\/\/(?:www\.)?linkedin\.com\/[^；（\s]+/)?.[0]||'未核实',r.alt,r.sources.join('\n'),'客户官网；公司公开目录/服务；注明的商户页',r.evidence_grade,new Date('2026-10-23T00:00:00Z'),r.verification,r.stage,r.authority,r.angle,r.next_action,r.owner,null,r.risk,r.address,r.scenario,r.project_status,r.project_url||'无具名项目来源',r.contact_url,r.product_url,r.alt,r.channel,...r.components,r.ask,r.subject,r.language]);
evidence.getRange('A6:AS25').values=rows;
for(let r=6;r<=25;r++){
 evidence.getRange(`H${r}`).formulas=[[`=SUM(AJ${r}:AP${r})`]];
 evidence.getRange(`B${r}`).formulas=[[`=IF(H${r}>=80,"A",IF(H${r}>=65,"B","C"))`]];
}
evidence.getRange('A6:AS25').format.wrapText=true;evidence.getRange('A6:AS25').format.verticalAlignment='top';
evidence.getRange('A6:AS25').format.rowHeight=148;
const evWidths=[10,9,14,42,40,34,32,12,65,38,49,38,47,45,70,90,32,42,14,52,51,48,66,95,23,15,75,76,75,76,76,76,76,80,12,15,15,15,18,15,15,15,78,72,15];
widths(evidence,evWidths);stripe(evidence,6,25,'AS');
evidence.getRange('S6:S25').setNumberFormat('yyyy-mm-dd');evidence.getRange('Z6:Z25').setNumberFormat('yyyy-mm-dd');
evidence.getRange('H6:H25').setNumberFormat('0');evidence.getRange('AJ6:AP25').setNumberFormat('0');
evidence.getRange('AJ6:AP25').format.fill=colors.input;
evidence.freezePanes.freezeRows(5);evidence.freezePanes.freezeColumns(2);
evidence.tables.add('A5:AS25',true,'AccountEvidence');
evidence.getRange('B6:B25').conditionalFormats.add('containsText',{text:'A',format:{font:{bold:true,color:'#3C315C'}}});

base(action,'A1:L28');title(action,'FriesGo 阀门渠道客户行动名单');action.tabColor=colors.navy;
action.getRange('A3').values=[['客户数']];action.getRange('B3').formulas=[['=COUNTA(A6:A25)']];
action.getRange('C3').values=[['A组']];action.getRange('D3').formulas=[['=COUNTIFS(B6:B25,"A")']];
action.getRange('E3').values=[['B组']];action.getRange('F3').formulas=[['=COUNTIFS(B6:B25,"B")']];
action.getRange('A4').values=[['核验2026-10-23；未发送；A先联系，B先核条件。黄色列留作真实跟进记录。']];action.getRange('A4').format.font={size:10,color:colors.muted};
action.getRange('A5:L5').values=[['ID','组别','国家','公司','匹配产品','首封确认目标','业务邮箱','电话/已核渠道','正文语言','联系状态','实际发送日','回访日期']];header(action,'A5:L5');
for(let i=0;i<records.length;i++){
 const r=i+6;action.getRange(`A${r}`).values=[[records[i].id]];
 for(const [c,idx]of [['B',2],['C',3],['D',4],['E',7],['F',43],['G',12],['H',13],['I',45]])action.getRange(`${c}${r}`).formulas=[[`=VLOOKUP($A${r},'D_客户证据'!$A$6:$AS$25,${idx},FALSE)`]];
 action.getRange(`J${r}`).values=[['未联系']];
}
widths(action,[10,9,14,43,31,70,38,48,14,17,17,17]);
action.getRange('A6:L25').format.rowHeight=48;action.getRange('A6:L25').format.wrapText=true;action.getRange('A6:L25').format.verticalAlignment='top';stripe(action,6,25,'L');
for(const c of ['B3','D3','F3'])action.getRange(c).format.horizontalAlignment='center';
action.getRange('J6:L25').format.fill=colors.input;
action.getRange('J6:J25').dataValidation={rule:{type:'list',values:['未联系','已联系','已转负责人','待技术资料','收到RFQ','暂不匹配','暂停','停止联系']}};
action.getRange('K6:L25').setNumberFormat('yyyy-mm-dd');
action.freezePanes.freezeRows(5);action.freezePanes.freezeColumns(1);action.tables.add('A5:L25',true,'ContactActions');
action.getRange('A27').values=[['先取V01/V02、M01/M02、U01/U02验证。发送后5个工作日核部门；再过7个工作日无有效信息则暂停。']];
action.getRange('A28').values=[['没有当前RFQ；报价须补规格、连接、准入文件、包装物流、授权成本及数量/条款。']];
action.getRange('A27:A28').format.font={size:10,color:colors.muted};

base(market,'A1:J55');title(market,'八国筛查与六个渠道网络');
market.getRange('A3').values=[['贸易口径：中国报告方对目标国HS848180出口，FOB百万美元，H6/HS2022；不等于平衡阀市场规模。']];
market.getRange('A4').values=[['2026-06至09月查询为空，最新可用月未确认；贸易数值截至2025。首批选择为渠道验证顺序。']];
market.getRange('A3:A4').format.font={size:10,color:colors.muted};
market.getRange('A5:J5').values=[['市场','联系顺序','2023 FOB','2024 FOB','2025 FOB','2025同比','名单数量','入选/观察理由','反证及未决条件','数量来源']];header(market,'A5:J5');
for(let i=0;i<model.markets.length;i++){
 const m=model.markets[i],r=i+6,t=model.trade.find(t=>t.country===m[0]);
 market.getRange(`A${r}:J${r}`).values=[[m[0],m[1],t['2023']/1e6,t['2024']/1e6,t['2025']/1e6,null,null,m[3],m[4]+' '+m[5],model.sources.S03[1]]];
 market.getRange(`F${r}`).formulas=[[`=E${r}/D${r}-1`]];
 market.getRange(`G${r}`).formulas=[[`=COUNTIFS('D_客户证据'!$C$6:$C$25,A${r})`]];
}
widths(market,[17,20,16,16,16,16,14,82,105,95]);
market.getRange('A6:J13').format.rowHeight=94;market.getRange('A6:J13').format.wrapText=true;market.getRange('A6:J13').format.verticalAlignment='top';stripe(market,6,13,'J');
market.getRange('C6:E13').setNumberFormat('0.0');market.getRange('F6:F13').setNumberFormat('+0.0%;-0.0%;0.0%');
market.tables.add('A5:J13',true,'MarketScreen');
market.getRange('A16').values=[['“菜市场”是可核分销网络；六个网络与来源另见“渠道地图与来源”，未证明为统一阀门批发城。']];market.getRange('A16').format.font={size:10,color:colors.muted};
market.freezePanes.freezeRows(5);

base(channel,'A1:F35');title(channel,'六个渠道网络及调研来源');
channel.getRange('A3').values=[['渠道聚集依据与每家官网复核分开；不推定商户互有交易、同属一个市场或全部参展。']];channel.getRange('A3').format.font={size:10,color:colors.muted};
widths(channel,[12,45,26,65,65,70]);
channel.getRange('A5:F5').values=[['渠道ID','网络/地点','客户ID','下游路线依据','发现与核验路径','边界']];header(channel,'A5:F5');
channel.getRange('A6:F11').values=model.channels.map(c=>[c[0],c[1],c[2],c[3],c[4],c[6]]);
channel.getRange('A6:F11').format.rowHeight=95;channel.getRange('A6:F11').format.wrapText=true;channel.getRange('A6:F11').format.verticalAlignment='top';stripe(channel,6,11,'F');
channel.getRange('A15:E15').values=[['来源ID','来源标题','核验日','证据用途','URL']];header(channel,'A15:E15');
const sourceRows=Object.entries(model.sources).filter(([k])=>k!=='S18').map(([k,v])=>[k,v[0],new Date('2026-10-23T00:00:00Z'),'详见市场调研报告；公开网页的发布日期与本次核验日分开。',v[1]]);
channel.getRange(`A16:E${15+sourceRows.length}`).values=sourceRows;
channel.getRange(`A16:E${15+sourceRows.length}`).format.rowHeight=100;channel.getRange(`A16:E${15+sourceRows.length}`).format.wrapText=true;channel.getRange(`A16:E${15+sourceRows.length}`).format.verticalAlignment='top';channel.getRange(`C16:C${15+sourceRows.length}`).setNumberFormat('yyyy-mm-dd');
channel.freezePanes.freezeRows(5);

base(mail,'A1:K26');title(mail,'20封独立开发信及中文译文');
mail.getRange('A3').values=[['7封越南语正文＋20封英文母稿；其余13封英语正文。只供复制审阅，未发送；项目/应用边界见K列。']];mail.getRange('A3').format.font={size:10,color:colors.muted};
mail.getRange('A5:K5').values=[['客户ID','公司','首选业务邮箱','正文语言','正文主题','正文','中文译文','英文母稿（越南客户）','英文主题（越南客户）','个性化事实','项目/应用证据状态']];header(mail,'A5:K5');
mail.getRange('A6:K25').values=records.map(r=>[r.id,r.name,r.email,r.language,r.local_subject,r.local,r.chinese,r.language==='越南语'?r.english:'同F列',r.language==='越南语'?r.subject:'同E列',r.fact,r.project_status]);
widths(mail,[11,43,38,14,70,103,85,103,70,83,74]);
mail.getRange('A6:K25').format.rowHeight=240;mail.getRange('A6:K25').format.wrapText=true;mail.getRange('A6:K25').format.verticalAlignment='top';stripe(mail,6,25,'K');mail.freezePanes.freezeRows(5);mail.freezePanes.freezeColumns(1);mail.tables.add('A5:K25',true,'OutreachDrafts');

// A meaningful priority-boundary check, restoring all temporary values before export.
evidence.getRange('AJ6').values=[[15]];wb.recalculate();
const changed={score:evidence.getRange('H6').values[0][0],grade:evidence.getRange('B6').values[0][0],action:action.getRange('B6').values[0][0]};
if(changed.score!==73||changed.grade!=='B'||changed.action!=='B')throw new Error('Priority propagation failed: '+JSON.stringify(changed));
evidence.getRange('AJ6').values=[[25]];wb.recalculate();
const restored={total:action.getRange('B3').values[0][0],A:action.getRange('D3').values[0][0],B:action.getRange('F3').values[0][0],V01:evidence.getRange('H6').values[0][0]};
if(restored.total!==20||restored.A!==11||restored.B!==9||restored.V01!==83)throw new Error('Restored counts mismatch '+JSON.stringify(restored));
const inspected=await wb.inspect({kind:'table',range:"'20家行动名单'!A5:I8",include:'values,formulas',tableMaxRows:4,tableMaxCols:9,maxChars:2000});
await fs.writeFile(path.join(root,'_workbook_inspect.ndjson'),inspected.ndjson);
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:100},summary:'final formula error scan',maxChars:2000});
await fs.writeFile(path.join(root,'_workbook_formula_scan.ndjson'),errors.ndjson);
await fs.mkdir(path.join(root,'previews'),{recursive:true});
const renders=[['20家行动名单','A1:F10','action'],['市场与渠道','A1:H13','market'],['渠道地图与来源','A1:F8','channel'],['渠道地图与来源','A15:E18','sources'],['20封开发信','D5:G6','letters'],['D_客户证据','A5:I8','evidence']];
for(const[s,range,name]of renders){
 const blob=await wb.render({sheetName:s,range,scale:1.5,format:'png'});
 await fs.writeFile(path.join(root,'previews',name+'.png'),new Uint8Array(await blob.arrayBuffer()));
}
const output=await SpreadsheetFile.exportXlsx(wb);
await output.save(path.join(root,'02_20家客户_联系方式与开发信.xlsx'));
await fs.writeFile(path.join(root,'_workbook_qa.json'),JSON.stringify({priorityInputTest:changed,restoredCounts:restored,formulaScan:errors.ndjson,renderedRanges:renders},null,2));
console.log(JSON.stringify({exported:true,counts:restored,formulaScan:errors.ndjson}));
