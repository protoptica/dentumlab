import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from extractor import validate, extract_text
class ExtractionTests(unittest.TestCase):
    def test_rounding(self):
        result={'date':'2026-10-17','lines':[{'name':'A','quantity':'0.125','unit_price':100,'total':13}]}
        self.assertEqual(validate(result)['lines'][0]['total'],13)
        result['lines'][0]['total']=12
        with self.assertRaises(ValueError): validate(result)
    def test_payment_does_not_create_purchase(self):
        self.assertEqual(validate({'kind':'payment'})['kind'],'payment')
    def test_reject_float_money(self):
        with self.assertRaises(ValueError): validate({'date':'2026-10-17','lines':[{'quantity':'1','unit_price':1.1,'total':1}]})
    def test_pdf_text(self):
        from reportlab.pdfgen import canvas
        import io
        buf=io.BytesIO(); c=canvas.Canvas(buf); c.drawString(40,800,'Invoice 123 supplier Test quantity 10 price 25 total 250');c.save()
        data=extract_text(buf.getvalue());self.assertIn('Invoice 123',data['text']);self.assertTrue(data['pages'][0]['words'])
if __name__=='__main__': unittest.main()
