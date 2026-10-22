"""Current inputs and business gates. Standard library; no artifact dependencies."""
import json
from datetime import date
from urllib.parse import urlparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
QUEUES = {'P1 小批验证','P2 条件验证','P3 暂缓'}
QUOTE_FIELDS = {'exact_specification','quantity_timing','buyer_authority','destination_consignee','incoterm','payment_terms','compliance_path','packing_freight','authorized_cost','approval_and_validity'}

def require(condition, message):
    if not condition: raise ValueError(message)

def quotation_readiness(review, fields):
    require(set(fields)==QUOTE_FIELDS and len(fields)==len(QUOTE_FIELDS),'All ten quotation fields must be assessed')
    missing=[]
    for key in fields:
        item=review.get('quote_gates',{}).get(key,{})
        accepted=item.get('status')=='confirmed' and bool(item.get('value')) and bool(item.get('evidence'))
        # Core commercial facts (specification, authority, cost, terms...) cannot
        # be waived with N/A. Only an evidenced applicability assessment may
        # close the regulatory/document gate as not applicable.
        exempt=key=='compliance_path' and item.get('status')=='not_applicable' and bool(item.get('reason')) and bool(item.get('evidence'))
        if not (accepted or exempt): missing.append(key)
    return {'ready':not missing,'missing':missing}

def validate_current(accounts, model):
    require(set(model['quote_fields'])==QUOTE_FIELDS and len(model['quote_fields'])==len(QUOTE_FIELDS),'All ten quotation fields must be retained')
    require(len(accounts)==model['account_count']==20, 'The one-page contract requires 20 independent accounts')
    report_date=date.fromisoformat(model['report_date'])
    for field in ['id','name','display_name','email']:
        require(len({a[field].strip().casefold() for a in accounts})==len(accounts),f'Duplicate {field}')
    domains=[urlparse(a['website']).hostname.removeprefix('www.') for a in accounts]
    require(len(set(domains))==len(domains),'Review duplicate company domains')
    for a in accounts:
        for field in ['fact','role','product','phone','address','person','risk','ask','subject','english','chinese','local','local_subject','language']:
            require(bool(a.get(field)),f'{a["id"]}: missing {field}')
        for field in ['website','contact_url','product_url']:
            u=urlparse(a[field]);require(u.scheme in {'http','https'} and bool(u.hostname),f'{a["id"]}: invalid {field}')
        require(date.fromisoformat(a['checked_on'])<=report_date,f'{a["id"]}: future source date')
        require(len(a['english'].split())<150,f'{a["id"]}: English letter too long')
        require(a.get('sources') and a['product_url'] in a['sources'] and a['contact_url'] in a['sources'],f'{a["id"]}: source chain incomplete')
        r=a['review'];require(r['queue'] in QUEUES,f'{a["id"]}: queue')
        for field in ['reason','unlock','stop','fit','entry_product','next_commitment']:
            require(bool(r.get(field)),f'{a["id"]}: missing review {field}')
        stage=int(r['stage'][1])
        require(stage in range(1,8),f'{a["id"]}: invalid stage')
        require(stage<3 or r.get('authority_verified') is True and bool(r.get('authority_evidence')),f'{a["id"]}: authority evidence required')
        require(stage<4 or r.get('demand_confirmed') is True and bool(r.get('demand_evidence')),f'{a["id"]}: demand evidence required')
        require(stage<5 or bool(r.get('rfq_evidence')),f'{a["id"]}: RFQ evidence required')
        require(stage<6 or quotation_readiness(r,model['quote_fields'])['ready'] and bool(r.get('issued_quote_evidence')),f'{a["id"]}: actual quote and all gates required')
        require(stage<7 or bool(r.get('sample_or_order_evidence')),f'{a["id"]}: sample/order evidence required')
    for field in ['english','ask']:
        require(len({a[field] for a in accounts})==len(accounts),f'Duplicate {field}')
    ids={a['id'] for a in accounts}
    require(len(set(model['pilot_ids']))==len(model['pilot_ids']) and set(model['pilot_ids'])<=ids,'Invalid pilot IDs')
    require(set(model['pilot_ids'])=={a['id'] for a in accounts if a['review']['queue']=='P1 小批验证'},'Pilot/queue mismatch')
    return {'accounts':len(accounts),'pilot':len(model['pilot_ids']),'all_sources_reverified':False,
            'formal_quote_ready':sum(quotation_readiness(a['review'],model['quote_fields'])['ready'] for a in accounts)}

def load_current():
    accounts=json.loads((ROOT/'data/canonical_accounts.json').read_text())
    model=json.loads((ROOT/'data/operating_model.json').read_text())
    validate_current(accounts,model)
    return accounts,model

if __name__=='__main__':
    a,m=load_current();print(json.dumps(validate_current(a,m),ensure_ascii=False,indent=2))
