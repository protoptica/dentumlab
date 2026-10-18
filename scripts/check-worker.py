"""Read-only installation check. Never takes a queue job or prints secrets."""
import os
from pathlib import Path
import httpx
import pytesseract
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / 'worker' / '.env')
try:
    languages = pytesseract.get_languages(config='')
    if not {'rus','eng'}.issubset(languages):
        raise ValueError('OCR languages rus and eng are required')
    models = httpx.get('http://127.0.0.1:11434/v1/models',timeout=15)
    models.raise_for_status()
    if os.environ['MODEL_NAME'] not in [m['id'] for m in models.json()['data']]:
        raise ValueError('Configured model is not installed')
    # Health verifies credentials without claiming or changing jobs.
    response = httpx.post(os.environ['SUPABASE_URL'].rstrip('/')+'/functions/v1/worker-gateway',
        headers={'Authorization':'Bearer '+os.environ['WORKER_TOKEN']},json={'action':'health'},timeout=30)
    if response.status_code != 200:
        raise ValueError('Worker credentials or cloud connection failed (HTTP '+str(response.status_code)+')')
    print('OK: OCR rus+eng, local model, cloud worker credentials')
except (ValueError, KeyError):
    print('Configuration check failed. Check worker/.env, Ollama and OCR languages.')
    raise SystemExit(1)
except Exception:
    print('Connection check failed. Check internet, Ollama and Supabase availability.')
    raise SystemExit(1)
