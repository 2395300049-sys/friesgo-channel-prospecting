"""Cross-file consistency checks; visual approval is intentionally separate."""
import re, unicodedata
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
from current_model import require, load_current
from validate import read_sheet, NS

def validate_outputs(dest, accounts):
    dest=Path(dest)
    book=dest/'07_20家客户与推进工作簿.xlsx'
    action,_=read_sheet(book,1);letters,_=read_sheet(book,3);evidence,_=read_sheet(book,4);log,_=read_sheet(book,5)
    for row,a in enumerate(accounts,5):
        require(action.get(f'A{row}')==letters.get(f'A{row}')==evidence.get(f'A{row}')==a['id'],'Account IDs out of sync')
        require(action.get(f'D{row}')==a['review']['queue'],'Queue mismatch')
        require(letters.get(f'D{row}')==evidence.get(f'L{row}')==a['email'],'Email mismatch')
        require(letters.get(f'F{row}')==a['local'] and letters.get(f'G{row}')==a['chinese'] and letters.get(f'I{row}')==a['english'],'Letter mismatch')
        require(not any(log.get(f'{c}{row}') for c in 'ABCDEFGHI'),'Public event log must be blank')
    tracker=dest/'06_业务员操作记录_一页横版.xlsx'
    cells,xml=read_sheet(tracker)
    require([cells.get(f'A{i}') for i in range(5,25)]==[a['display_name'] for a in accounts],'Print names mismatch')
    require(not any(cells.get(f'{c}{r}') for c in 'BCDEFGHI' for r in range(5,25)),'Print action cells must be blank')
    setup=xml.find('s:pageSetup',NS)
    require(setup is not None and setup.get('paperSize')=='9' and setup.get('orientation')=='landscape' and setup.get('fitToWidth')==setup.get('fitToHeight')=='1','Print setup mismatch')
    from pypdf import PdfReader
    pdf=PdfReader(dest/'06_业务员操作记录_一页横版.pdf')
    require(len(pdf.pages)==1,'Print PDF must be one page')
    box=pdf.pages[0].mediabox
    require(abs(float(box.width)-841.89)<2 and abs(float(box.height)-595.28)<2,'Print PDF must be A4 landscape')
    norm=lambda s:re.sub(r'\s+','',unicodedata.normalize('NFC',s))
    pdftext=norm(pdf.pages[0].extract_text())
    for a in accounts:require(norm(a['display_name']) in pdftext,f'{a["id"]}: missing PDF company')
    with ZipFile(dest/'FriesGo_审核优化与20家客户开发手册_v2.docx') as z:
        text=norm(''.join(ET.fromstring(z.read('word/document.xml')).itertext()))
        for a in accounts:
            for key in ['email','phone','address','local','english','chinese']:
                require(norm(a[key]) in text,f'{a["id"]}: Word {key} mismatch')
            for key in ['unlock','stop']:
                require(norm(a['review'][key]) in text,f'{a["id"]}: Word {key} mismatch')
    return {'accounts':len(accounts),'blank_print_cells':160,'blank_event_cells':180,'a4_landscape_pages':1,'word_and_xlsx_consistent':True}

if __name__=='__main__':
    import argparse,json
    p=argparse.ArgumentParser();p.add_argument('directory',type=Path);args=p.parse_args()
    accounts,model=load_current();print(json.dumps(validate_outputs(args.directory,accounts),ensure_ascii=False,indent=2))
