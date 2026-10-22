from pathlib import Path
import os
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E

base=Path(os.environ['FRIESGO_OUTPUT_DIR']).resolve()
file=base/'06_业务员操作记录_一页横版.xlsx'
ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
q=lambda x:'{'+ns+'}'+x
with ZipFile(file) as z: entries={n:z.read(n) for n in z.namelist()}
x=E.fromstring(entries['xl/worksheets/sheet1.xml'])
for name in ['sheetPr','printOptions','pageMargins','pageSetup','rowBreaks','colBreaks']:
 for e in x.findall(q(name)): x.remove(e)
pr=E.Element(q('sheetPr'));E.SubElement(pr,q('pageSetUpPr'),fitToPage='1',autoPageBreaks='0');x.insert(0,pr)
E.SubElement(x,q('printOptions'),horizontalCentered='1',gridLines='0',headings='0')
E.SubElement(x,q('pageMargins'),left='0.32',right='0.32',top='0.28',bottom='0.28',header='0.1',footer='0.1')
E.SubElement(x,q('pageSetup'),paperSize='9',orientation='landscape',fitToWidth='1',fitToHeight='1',usePrinterDefaults='0')
entries['xl/worksheets/sheet1.xml']=E.tostring(x,encoding='UTF-8',xml_declaration=True,standalone=True)
w=E.fromstring(entries['xl/workbook.xml'])
dn=w.find(q('definedNames'))
if dn is None:
 dn=E.Element(q('definedNames'));sheets=w.find(q('sheets'));w.insert(list(w).index(sheets)+1,dn)
for e in list(dn):
 if e.get('name')=='_xlnm.Print_Area':dn.remove(e)
E.SubElement(dn,q('definedName'),name='_xlnm.Print_Area',localSheetId='0').text="'打印记录'!$A$1:$I$25"
entries['xl/workbook.xml']=E.tostring(w,encoding='UTF-8',xml_declaration=True,standalone=True)
tmp=file.with_suffix('.printtmp.xlsx')
with ZipFile(tmp,'w',ZIP_DEFLATED) as z:
 for n,data in entries.items():z.writestr(n,data)
tmp.replace(file)
print('A4 landscape, one page, print area A1:I25')
