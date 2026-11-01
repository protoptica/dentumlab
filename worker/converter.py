"""Local office/image conversion. Source bytes remain the deduplication identity."""
import os, shutil, subprocess, tempfile
from pathlib import Path
from io import BytesIO
from PIL import Image

OFFICE = {'.xls','.xlsx','.doc','.docx','.odt','.ods','.rtf'}
def office_binary():
    options=[os.getenv('SOFFICE_PATH'),shutil.which('soffice'),'/Applications/LibreOffice.app/Contents/MacOS/soffice',str(Path(os.getenv('ProgramFiles','C:/Program Files'))/'LibreOffice/program/soffice.exe')]
    for value in options:
        if value and Path(value).is_file():return value
    raise ValueError('Для конвертации нужен LibreOffice на компьютере обработчика')

def to_pdf(content:bytes, filename:str) -> bytes:
    if content.startswith(b'%PDF'): return content
    ext=Path(filename).suffix.lower()
    if ext in {'.jpg','.jpeg','.png'}:
        with Image.open(BytesIO(content)) as image:
            output=BytesIO(); image.convert('RGB').save(output,format='PDF');return output.getvalue()
    if ext not in OFFICE:
        raise ValueError('Неподдерживаемый формат. Используйте PDF, Excel, Word, ODT, ODS, RTF, JPG или PNG')
    with tempfile.TemporaryDirectory(prefix='dentum-convert-') as folder:
        root=Path(folder); profile=root/'profile'; profile.mkdir()
        (profile/'user').mkdir()
        (profile/'user/registrymodifications.xcu').write_text('''<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Calc/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item></oor:items>''')
        source=root/('document'+ext);source.write_bytes(content)
        try:
            subprocess.run([office_binary(),'-env:UserInstallation='+profile.as_uri(),'--headless','--nologo','--nodefault','--norestore','--convert-to','pdf','--outdir',str(root),str(source)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=120,check=True)
        except subprocess.TimeoutExpired as e:raise ValueError('Конвертация в PDF превысила 2 минуты') from e
        except subprocess.CalledProcessError as e:raise ValueError('Не удалось конвертировать документ в PDF') from e
        target=root/'document.pdf'
        if not target.exists():raise ValueError('Не удалось создать PDF. Проверьте формат и пароль документа')
        result=target.read_bytes()
        if not result.startswith(b'%PDF') or len(result)>20*1024*1024:raise ValueError('PDF не создан или превышает 20 МБ')
        return result
