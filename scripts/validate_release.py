"""Validate a frozen v2 release without the document/table runtime."""
import hashlib,json
from pathlib import Path
from current_model import ROOT, require, validate_current

V2=ROOT/'deliverables/2026-10-23-v2'

def validate_release(directory=V2):
    directory=Path(directory)
    manifest=json.loads((directory/'manifest.json').read_text())
    expected={r['path'] for r in manifest['files']}
    actual={str(p.relative_to(directory)) for p in directory.rglob('*') if p.is_file() and p.name!='manifest.json'}
    require(expected==actual,'Release file set differs from manifest')
    for rec in manifest['files']:
        file=(directory/rec['path']).resolve()
        require(directory.resolve() in file.parents,'Manifest path escapes release')
        require(hashlib.sha256(file.read_bytes()).hexdigest()==rec['sha256'],f'Changed release file: {rec["path"]}')
    a=json.loads((directory/'canonical_accounts.json').read_text())
    m=json.loads((directory/'operating_model.json').read_text())
    validate_current(a,m)
    require(manifest['visual_review']=='passed','Release requires separate visual acceptance')
    review=json.loads((directory/'visual-review.json').read_text())
    require(review['status']=='passed','Visual review has not passed')
    for item in review['artifacts']:
        require(hashlib.sha256((directory/item['path']).read_bytes()).hexdigest()==item['sha256'],'Visual review does not match artifact bytes')
    return {'version':m['version'],'accounts':len(a),'files':len(expected),'status':'passed'}

if __name__=='__main__':print(json.dumps(validate_release(),ensure_ascii=False,indent=2))
