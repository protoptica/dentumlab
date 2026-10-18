import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from extractor import fill_packaging
class PackagingTests(unittest.TestCase):
 def test_piece_quantity_is_not_pack_size(self):
  r=fill_packaging({'name':'Erkoflex 4.00 mm Ø120 mm','unit':'шт','quantity':'5'})
  self.assertEqual((r['factor'],r['base_unit']),('1','шт.'))
 def test_explicit_pack(self):
  r=fill_packaging({'name':'Диски, упаковка 10 шт.','unit':'уп.','quantity':'2'})
  self.assertEqual((r['factor'],r['base_unit']),('10','шт.'))
 def test_volume(self):
  r=fill_packaging({'name':'Жидкость 50 мл','unit':'флакон'})
  self.assertEqual((r['factor'],r['base_unit']),('50','мл'))
 def test_unknown_pack_stays_unknown(self):
  r=fill_packaging({'name':'Диски 98 mm','unit':'уп.'})
  self.assertEqual(r['factor'],'')
