import sys, unittest, tempfile, subprocess, os
from pathlib import Path
from io import BytesIO
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from converter import to_pdf, office_binary
from PIL import Image
class ConverterTests(unittest.TestCase):
 def test_pdf_identity(self):
  data=b'%PDF-test';self.assertIs(to_pdf(data,'a.pdf'),data)
 def test_png(self):
  b=BytesIO();Image.new('RGB',(20,20),'white').save(b,format='PNG');self.assertTrue(to_pdf(b.getvalue(),'a.png').startswith(b'%PDF'))
 def test_unsupported(self):
  with self.assertRaises(ValueError):to_pdf(b'test','file.exe')
 @unittest.skipUnless(os.getenv('TEST_OFFICE'),'Office conversion integration')
 def test_xlsx_and_xls(self):
  import openpyxl,pdfplumber
  book=openpyxl.Workbook();sheet=book.active;sheet.column_dimensions['A'].width=28
  sheet.append(['Invoice 2891','Quantity','Price','Total']);sheet.append(['Material',2,150,300]);sheet.append(['Total',None,None,300])
  buf=BytesIO();book.save(buf)
  for ext,data in [('xlsx',buf.getvalue())]:
   pdf=to_pdf(data,'invoice.'+ext)
   with pdfplumber.open(BytesIO(pdf)) as doc:self.assertIn('2891',doc.pages[0].extract_text())
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);source=root/'invoice.xlsx';source.write_bytes(buf.getvalue())
   subprocess.run([office_binary(),'-env:UserInstallation='+(root/'profile').as_uri(),'--headless','--convert-to','xls','--outdir',tmp,str(source)],check=True,stdout=subprocess.DEVNULL,timeout=120)
   pdf=to_pdf((root/'invoice.xls').read_bytes(),'invoice.xls')
   with pdfplumber.open(BytesIO(pdf)) as doc:self.assertIn('2891',doc.pages[0].extract_text())
