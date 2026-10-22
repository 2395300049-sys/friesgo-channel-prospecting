"""Offline validation of the published snapshot. No network or external packages."""
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
from collections import Counter
import hashlib, json, re

ROOT=Path(__file__).resolve().parents[1]
SNAPSHOT=ROOT/'deliverables/2026-10-23'
NS={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}

def read_sheet(file, index=1):
    with ZipFile(file) as z:
        strings=[]
        if 'xl/sharedStrings.xml' in z.namelist():
            strings=[''.join(x.itertext()) for x in ET.fromstring(z.read('xl/sharedStrings.xml'))]
        root=ET.fromstring(z.read(f'xl/worksheets/sheet{index}.xml'))
        result={}
        for cell in root.findall('.//s:c',NS):
            assert cell.get('t')!='e',(file,cell.get('r'),'Excel error')
            v=cell.find('s:v',NS);value=v.text if v is not None and v.text else ''
            if cell.get('t')=='s':value=strings[int(value)]
            elif cell.get('t')=='inlineStr':value=''.join(x.text or '' for x in cell.findall('.//s:t',NS))
            result[cell.get('r')]=value
        return result,root

def validate_snapshot():
    manifest=json.loads((SNAPSHOT/'manifest.json').read_text())
    for rec in manifest['files']:
        file=SNAPSHOT/rec['path']
        assert file.is_file(),file
        assert hashlib.sha256(file.read_bytes()).hexdigest()==rec['sha256'],file
    # Historical bytes are compared with historical inputs, never live research.
    accounts=json.loads((ROOT/'data/archive/accounts-2026-10-23-v1.json').read_text())
    assert len(accounts)==20
    assert len({a['id'] for a in accounts})==20
    assert len({a['email'].lower() for a in accounts})==20
    assert len({a['website'].split('/')[2].removeprefix('www.') for a in accounts})==20
    assert Counter(a['country'] for a in accounts)=={'越南':7,'马来西亚':6,'阿联酋':7}
    assert Counter(a['priority'] for a in accounts)=={'A':11,'B':9}
    required=['display_name','name','email','phone','address','fact','scenario','project_status',
              'risk','ask','english','chinese','local','local_subject','contact_url','product_url','checked_on']
    for a in accounts:
        assert all(a.get(k) for k in required),a['id']
        assert sum(a['components'])==a['score'],a['id']
        assert len(a['english'].split())<150,a['id']
        assert a['checked_on']=='2026-10-23'
    assert len({a['english'] for a in accounts})==20
    assert len({a['ask'] for a in accounts})==20
    full=SNAPSHOT/'02_20家客户_联系方式与开发信.xlsx'
    action,_=read_sheet(full,1);letters,_=read_sheet(full,4);ev,_=read_sheet(full,5)
    for row,a in enumerate(accounts,6):
        assert action[f'A{row}']==letters[f'A{row}']==ev[f'A{row}']==a['id']
        assert action[f'G{row}']==letters[f'C{row}']==ev[f'L{row}']==a['email']
        assert letters[f'F{row}']==a['local']
        assert letters[f'G{row}']==a['chinese']
        assert float(ev[f'H{row}'])==a['score']
        if a['language']=='越南语':assert letters[f'H{row}']==a['english']
    tracker=SNAPSHOT/'06_业务员操作记录_一页横版.xlsx'
    cells,xml=read_sheet(tracker)
    assert [cells[f'A{i}'] for i in range(5,25)]==[a['display_name'] for a in accounts]
    assert all(not cells.get(f'{col}{row}') for col in 'BCDEFGHI' for row in range(5,25))
    setup=xml.find('s:pageSetup',NS)
    assert setup.get('paperSize')=='9' and setup.get('orientation')=='landscape'
    assert setup.get('fitToWidth')==setup.get('fitToHeight')=='1'
    pdf=(SNAPSHOT/'06_业务员操作记录_一页横版.pdf').read_bytes()
    assert len(re.findall(rb'/Type\s*/Page\b',pdf))==1
    box=re.search(rb'/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)',pdf)
    assert box,'PDF MediaBox unavailable'
    assert float(box[3])>float(box[4]),'PDF must be landscape'
    doc=SNAPSHOT/'FriesGo_海外渠道市场调研与20家客户开发方案_2026-10-23.docx'
    with ZipFile(doc) as z:
        text=''.join(ET.fromstring(z.read('word/document.xml')).itertext())
        norm=lambda s:re.sub(r'\s+','',s)
        for a in accounts:
            for k in ['email','phone','address','english','chinese','local']:
                assert norm(a[k]) in norm(text),(a['id'],k)
    # Public files must not contain local home paths or common token formats.
    allowed={'.md','.txt','.py','.mjs','.json','.csv','.yml','.yaml'}
    patterns=[b'/' + rb'Users/[^/\s]+/',rb'gh[pousr]_[A-Za-z0-9_]{24,}',rb'github_pat_[A-Za-z0-9_]{20,}',
              rb'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----']
    for p in ROOT.rglob('*'):
        if not p.is_file() or any(x in p.parts for x in ['.git','outputs','node_modules','__pycache__','.venv']):continue
        payloads=[]
        if p.suffix in allowed:payloads=[p.read_bytes()]
        elif p.suffix in {'.docx','.xlsx'}:
            with ZipFile(p) as z:
                assert z.testzip() is None,p
                payloads=[z.read(n) for n in z.namelist() if n.endswith(('.xml','.rels'))]
        for b in payloads:
            for pat in patterns:assert re.search(pat,b) is None,('Public path/token check',p)
    return {'accounts':20,'record_cells_empty':160,'print_pages':1,'snapshot_files':len(manifest['files']),
            'letters_english':20,'letters_chinese':20,'letters_vietnamese':7,'status':'passed'}

if __name__=='__main__':
    print(json.dumps(validate_snapshot(),ensure_ascii=False,indent=2))
