export type FollowupItem=Record<string,any>;
export const workDay=(value:Date=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
export function validWorkDay(value:any):value is string{
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
}
export function isCompletedFollowup(activity:FollowupItem,day:string){
  return activity.occurred_on===day&&(activity.kind==='followup'?activity.status==='done':['outreach','reply'].includes(activity.kind));
}
export function followedAccountIds(activities:FollowupItem[],day:string):Set<string>{
  return new Set(activities.filter(a=>isCompletedFollowup(a,day)).map(a=>a.account_id));
}
export function followupRows(data:FollowupItem,day:string){
  const ids=followedAccountIds(data.activities||[],day),states=new Map<string,FollowupItem>((data.states||[]).map((s:FollowupItem)=>[s.account_id,s]));
  return (data.accounts||[]).filter((a:FollowupItem)=>ids.has(a.id)).map((account:FollowupItem)=>({account,state:states.get(account.id)||{},activities:(data.activities||[]).filter((a:FollowupItem)=>a.account_id===account.id&&isCompletedFollowup(a,day))}));
}
function csvCell(value:any){
  let text=String(value??'');
  // Spreadsheet applications must not interpret a customer name or note as a formula.
  if(/^[\s\u0000-\u001f]*[=+@-]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
export function followupCSV(data:FollowupItem,day:string){
  const rows=[['跟进日期','客户编号','公司','国家','城市','当前阶段','负责人','本日记录','意向摘要','下次动作','下次日期'],...followupRows(data,day).map(({account,state,activities}:any)=>[day,account.id,account.name,account.country,account.city,state.status,state.owner,activities.map((a:FollowupItem)=>a.summary).join('\n'),state.interest_note,state.next_action,state.next_date])];
  return '\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
