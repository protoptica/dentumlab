"""Local health endpoint; run only on loopback. Accounting lives in Supabase."""
from fastapi import FastAPI
app = FastAPI(title='Дентум · локальные инструменты')
@app.get('/api/v1/health')
def health():
    return {'status': 'ok', 'mode': 'local-tools'}
