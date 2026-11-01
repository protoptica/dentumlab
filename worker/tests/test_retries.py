import sys, unittest, os, types, json
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from extractor import extract_text,process,PermanentExtractionError,OpenAICompatibleProvider
class RetryTests(unittest.TestCase):
 def test_excel_is_not_an_image(self):
  for signature in (bytes.fromhex('D0CF11E0'),b'PK\x03\x04'):
   with self.assertRaisesRegex(PermanentExtractionError,'PDF'): extract_text(signature+b'test')
 def test_reconciliation_is_not_invoice(self):
  with patch('extractor.extract_text',return_value={'text':'Акт сверки взаимных расчетов','pages':[]}):
   with self.assertRaisesRegex(PermanentExtractionError,'акт сверки'):process(b'test')
 def test_retry_changes_model_instructions(self):
  captured=[]
  class Response:
   status_code=200
   def json(self):return {'choices':[{'message':{'content':json.dumps({'lines':[]})}}]}
  def post(*a,**kw): captured.append(kw['json']['messages'][0]['content']);return Response()
  with patch.dict(os.environ,{'MODEL_API_KEY':'test','MODEL_NAME':'test'}),patch.dict(sys.modules,{'httpx':types.SimpleNamespace(post=post)}):
   OpenAICompatibleProvider().parse('test')
   OpenAICompatibleProvider('Ошибка суммы').parse('test')
  self.assertNotEqual(captured[0],captured[1])
  self.assertIn('Не подгоняй данные',captured[1])
