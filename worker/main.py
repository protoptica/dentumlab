"""Outbound-only queue worker. No Supabase service role and no Telegram token."""
from __future__ import annotations
import hashlib
import logging
import os
import threading
import time
from urllib.parse import urlsplit
import httpx
from dotenv import load_dotenv
from extractor import process

load_dotenv()
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')

def run():
    endpoint = os.environ['SUPABASE_URL'].rstrip('/') + '/functions/v1/worker-gateway'
    token = os.environ['WORKER_TOKEN']
    client = httpx.Client(headers={'Authorization': 'Bearer ' + token}, timeout=240)
    def call(action, job=None, **values):
        body = {'action': action, **values}
        if job:
            body.update(job_id=job['id'], lease_token=job['lease_token'])
        response = client.post(endpoint, json=body)
        if response.status_code != 200:
            raise RuntimeError(f'Облачная операция: HTTP {response.status_code}')
        return response.content if action == 'download' else response.json()
    while True:
        job = None
        stop = threading.Event()
        heartbeat = None
        try:
            model_url = urlsplit(os.getenv('MODEL_API_URL', ''))
            if model_url.hostname in ('127.0.0.1', 'localhost', '::1'):
                # Do not spend queue retries while Ollama is stopped or still starting.
                health = httpx.get(f'{model_url.scheme}://{model_url.netloc}/v1/models', timeout=10)
                health.raise_for_status()
                if os.getenv('MODEL_NAME') not in [m['id'] for m in health.json().get('data', [])]:
                    raise ValueError('Локальная модель не установлена; очередь ожидает')
            job = call('claim')
            if job:
                def renew():
                    while not stop.wait(120):
                        try:
                            call('renew', job)
                        except Exception:
                            logging.warning('Аренда не продлена; результат может быть отклонён')
                heartbeat = threading.Thread(target=renew, daemon=True)
                heartbeat.start()
                content = call('download', job)
                if len(content) > 20 * 1024 * 1024:
                    raise ValueError('Файл больше 20 МБ')
                result = process(content)
                call('complete', job, hash=hashlib.sha256(content).hexdigest(), result=result)
                del content
                logging.info('Задание завершено: %s', job['id'])
        except KeyboardInterrupt:
            break
        except Exception as exc:
            # HTTP exceptions may contain secret URLs; never log exception repr.
            safe = str(exc) if isinstance(exc, ValueError) and not isinstance(exc, httpx.HTTPError) else 'Ошибка обработки или сети'
            safe = safe[:250]
            logging.warning('%s', safe)
            if job:
                try:
                    call('fail', job, error=safe)
                except Exception:
                    logging.warning('Ошибка не записана; задание повторится после окончания аренды')
        finally:
            stop.set()
            if heartbeat:
                heartbeat.join(timeout=5)
        time.sleep(int(os.getenv('POLL_SECONDS', '15')))

if __name__ == '__main__':
    run()
