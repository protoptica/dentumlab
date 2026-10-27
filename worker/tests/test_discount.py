import unittest, sys, copy
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from extractor import reconcile_invoice, validate
TEXT='''Сумма без скидки Скидка Ставка Сумма НДС Сумма
2 Услуги доставки 1 шт 377.25 377.25 22% 83.00 460.25
Итого: 8 667.25 1 740.90 83.00 7 009.35
Итого с НДС: 7 009.35'''
class DiscountTests(unittest.TestCase):
 def test_69939(self):
  result={'date':'2026-10-06','delivery':0,'discount':0,'lines':[{'name':'Абатмент','quantity':'1','unit_price':829000,'total':829000},{'name':'Услуги доставки','quantity':'1','unit_price':37725,'total':37725}]}
  parsed=validate(reconcile_invoice(result,TEXT))
  self.assertEqual(parsed['delivery'],46025)
  self.assertEqual(parsed['discount'],174090)
  self.assertEqual(parsed['lines'][0]['total'],654910)
  self.assertEqual(parsed['lines'][0]['base_total'],829000)
  self.assertEqual(reconcile_invoice(copy.deepcopy(parsed),TEXT),parsed)
 def test_mismatch(self):
  with self.assertRaises(ValueError): reconcile_invoice({'lines':[{'name':'A','total':100}]},'Итого: 2.00')
