import sys,unittest,json,os
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from extractor import OpenAICompatibleProvider,process
class ProviderTests(unittest.TestCase):
 def test_rubles_to_kopecks(self):
  class Response:
   status_code=200
   def json(self):
    return {'choices':[{'message':{'content':json.dumps({'delivery':'750.00','lines':[{'unit_price':'1063.80','total':'2127.60'}]})}}]}
  import types
  with patch.dict(os.environ,{'MODEL_API_KEY':'ollama','MODEL_NAME':'local'}),patch.dict(sys.modules,{'httpx':types.SimpleNamespace(post=lambda *a,**k:Response())}):
   r=OpenAICompatibleProvider().parse('Цена 1 063,80')
  self.assertEqual(r['delivery'],75000)
  self.assertEqual(r['lines'][0]['total'],212760)
 def test_document_total_mismatch(self):
  class Provider:
   def parse(self,text): return {'kind':'invoice','date':'2026-09-30','delivery':0,'lines':[{'quantity':'1','unit_price':100,'total':100}]}
  with patch('extractor.extract_text',return_value={'text':'Всего к оплате: 6 684,60','pages':[]}):
   with self.assertRaisesRegex(ValueError,'Итог распознавания'):
    process(b'test',Provider())
