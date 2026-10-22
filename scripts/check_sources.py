"""Check transport availability only; human review owns semantic verification dates."""
import concurrent.futures, hashlib, json, re, urllib.request
from datetime import datetime, timezone
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def check(item):
    account_id, kind, url, email = item
    rec = dict(account_id=account_id, kind=kind, url=url,
               attempted_at=datetime.now(timezone.utc).isoformat(),
               semantic_verification=False, delivery_verified=False)
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=18) as response:
            body = response.read(8_000_000)
            rec.update(status=response.status, final_url=response.url,
                       sha256=hashlib.sha256(body).hexdigest(), bytes=len(body))
        raw = body.decode('utf-8', errors='replace')
        title = re.search(r'<title[^>]*>(.*?)</title>', raw, re.S | re.I)
        rec['title'] = unescape(re.sub('<[^>]+>', '', title[1])).strip() if title else ''
        rec['published_email_literal_found'] = email.lower() in unescape(raw).lower()
        local = ROOT/'outputs/source-audit'
        local.mkdir(parents=True, exist_ok=True)
        (local/f'{account_id}-{kind}.bin').write_bytes(body)
    except Exception as exc:
        rec.update(status=None, error=str(exc)[:250])
    return rec

if __name__ == '__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT/'outputs/source-availability.json')
    args=parser.parse_args()
    accounts = json.loads((ROOT/'data/canonical_accounts.json').read_text())
    jobs = [(a['id'], k, a[k+'_url'], a['email']) for a in accounts for k in ['product','contact']]
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        rows = list(pool.map(check, jobs))
    result = {'scope':'HTTP availability and literal email match, not content or delivery verification', 'checks':rows}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps({'attempts':len(rows), 'http_200':sum(r.get('status')==200 for r in rows),
                      'failures':[r['account_id']+':'+r['kind'] for r in rows if r.get('status')!=200]}))
