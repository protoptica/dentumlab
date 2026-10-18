# Учёт закупок Дентум

Приложение для учёта закупок зуботехнической лаборатории. React + TypeScript + Vite; общая база и авторизация — Supabase; приём Telegram и архивирование — Edge Functions; PDF/OCR — Python-обработчик.

## Открыть локально

```sh
cd dentumlab
npm ci
npm run dev
```

Адрес: http://127.0.0.1:4173. На Windows можно запустить `scripts/start-windows.cmd`, на macOS — `scripts/start-macos.command`. Требуется Node.js 22 или новее.

Без переменных Supabase открывается отдельный деморежим. База изначально пустая. Кнопка «Посмотреть на примере» создаёт вымышленные данные; изменения сохраняются в IndexedDB этого браузера. Демо не распознаёт загруженные документы. Можно вручную создавать поставщиков, счета и строки, подтверждать счета, исправлять карточки, переносить строки, отменять перенос и выгружать CSV.

`npm run build` собирает `dist/`; `npm test` проверяет расчёты и PostgreSQL-операции в PGlite. Python-тесты: `codex-python -m unittest discover -s worker/tests -v` (или Python виртуальной среды с `worker/requirements.txt` и reportlab).

## Рабочая база

Используйте отдельный тестовый проект Supabase перед рабочим запуском.

1. Выполните миграции `supabase/migrations/001_core.sql` — `005_archive.sql` по порядку в SQL Editor или через Supabase CLI. Они рассчитаны на новый проект.
2. Создайте пользователя в Supabase Auth. Отключите самостоятельную регистрацию. В SQL Editor создайте лабораторию и членство:

```sql
insert into public.lab(name) values ('Лаборатория Дентум') returning id;
-- Замените оба UUID полученными значениями.
insert into public.lab_member(lab_id,user_id,role)
values ('LAB_UUID','AUTH_USER_UUID','admin');
```

3. Скопируйте `.env.example` в `.env`. Укажите только `VITE_SUPABASE_URL` и `VITE_SUPABASE_PUBLISHABLE_KEY`. Перезапустите dev server или пересоберите frontend. Администраторский ключ в frontend не нужен.
4. Войдите почтой и паролем созданного пользователя. Пользователь без членства не получает доступа. Таблицы, отчёты и хранилище закрыты RLS.

Учётные записи создаются в Auth отдельно. Архив базы `public` не содержит пароли и конфигурацию Auth.

## Telegram и облачная очередь

Создайте бота и закрытый архивный чат, добавьте бота с правом отправки документов. Вставьте разрешённый Telegram ID, связанный с участником:

```sql
insert into public.telegram_user(telegram_id,lab_id,user_id)
values (123456789,'LAB_UUID','AUTH_USER_UUID');
```

Задайте серверные secrets в Supabase Dashboard → Edge Functions → Secrets:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET` — отдельная случайная строка
- `TELEGRAM_ARCHIVE_CHAT_ID`
- `DISPATCH_SECRET` — отдельная случайная строка
- `SITE_ORIGIN` — HTTPS-адрес сайта без завершающего `/`

`SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` предоставляются средой Supabase. Не копируйте service_role на компьютер администратора.

Разверните функции:

```sh
supabase functions deploy telegram-webhook
supabase functions deploy dispatch
supabase functions deploy worker-gateway
supabase functions deploy document-access
```

Проверка JWT платформы отключена в `supabase/config.toml`: webhook проверяет секрет Telegram, dispatch — свой секрет, gateway — хеш токена обработчика, document-access — пользователя через Auth и членство. Это отдельные проверки, не публичный доступ к операциям.

Настройте `setWebhook` на `https://PROJECT.supabase.co/functions/v1/telegram-webhook` с `secret_token`, совпадающим с `TELEGRAM_WEBHOOK_SECRET`. В `allowed_updates` передайте `['message']`. Токен передавайте через окружение в `scripts/set-webhook.mjs`; URL с токеном не выводится в журнал.

Настройте вызов `dispatch` каждую минуту: шаблон `supabase/dispatch_schedule.sql`. Он обрабатывает архивирование, отправку подтверждений, повторные попытки и удаляет временные копии просмотра старше часа. Без расписания загрузки с сайта останутся в очереди. После Telegram webhook также выполняется немедленный вызов диспетчера. Один вызов берёт одну задачу ответа и одну архивации; для большего потока увеличьте частоту или вынесите диспетчер на сервер.

Команды бота:

- `/find цирконий` — поиск по названию и артикулу;
- `/material UUID` — карточка, версия и последние покупки;
- `/edit UUID ВЕРСИЯ name Новое название` — изменение поля карточки. Поля: `name`, `category`, `manufacturer`, `sku`, `properties`, `unit`, `pack`;
- проверка и редактирование строк счёта — на сайте по кнопке в ответе.

Текстовые команды и документы записываются идемпотентно по `update_id`. Копии оригиналов отправляются в архив независимо от локального OCR. При сбое между отправкой в Telegram и записью ответа возможна дополнительная архивная копия; повторная закупка из идентичного файла блокируется хешем. Документы с одинаковыми реквизитами, но разным содержимым остаются для проверки версии.

## Локальный обработчик

Создайте случайный токен (не service_role), сохраните его в `worker/.env`, а SHA-256 — в `worker_credential`. Шаблон `.env`: `worker/.env.example`.

```sql
insert into public.worker_credential(lab_id,token_hash)
values ('LAB_UUID','SHA256_ОТ_ТОКЕНА');
-- Отзыв:
-- update public.worker_credential set revoked=true where id='CREDENTIAL_UUID';
```

Обработчику доступны только задания распознавания своей лаборатории и завершение действующей аренды. Задание арендуется на 10 минут, продлевается каждые 2 минуты. После пяти неудачных попыток показывается ошибка с кнопкой повтора.

```sh
cd worker
python -m venv .venv
# macOS/Linux:
. .venv/bin/activate
# Windows: .venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

Для OCR нужен Tesseract с языками `rus` и `eng`. Контейнер содержит его. Для текстовых PDF Tesseract не вызывается. `MODEL_API_URL`, `MODEL_API_KEY` и `MODEL_NAME` задают провайдера с OpenAI-совместимым Chat Completions API и JSON-ответами. Модель нужно выбрать и проверить на реальных счетах. Интерфейс `Provider` позволяет подключить другой или локальный разбор.

Облачный провайдер получает извлечённый текст. При отсутствии ключа и модели задание получает явную ошибку, а не фиктивный результат. Платёжные поручения не создают закупку: в очереди будет указание отметить оплату существующего счёта. Подозрительные итоги строк отклоняются для проверки. Распознанные строки всегда требуют подтверждения человеком.

`worker/api.py` — локальная проверка работоспособности: `uvicorn api:app --host 127.0.0.1 --port 8010`. Учётные операции выполняются в Supabase.

## Docker

```sh
docker compose up --build -d web
# После заполнения worker/.env:
docker compose --profile processing up --build -d
```

Сайт: http://127.0.0.1:4173. Порт открыт только на loopback. База остаётся общей в Supabase. `restart: unless-stopped` перезапускает контейнеры при запуске Docker. Для запуска после входа в macOS/Windows включите автозапуск Docker Desktop. На Linux включите службу Docker.

## GitHub Pages

Шаблон workflow: `.github/workflows/pages.yml` внутри `procurement`. Если публикуете отдельный репозиторий приложения, используйте его как есть. Если приложение остаётся в текущем большом репозитории, перенесите workflow в корневую `.github/workflows/` и установите `working-directory: procurement` в шагах `run`, `cache-dependency-path: procurement/package-lock.json` и `path: procurement/dist` для артефакта.

Задайте repository variables `VITE_SUPABASE_URL` и `VITE_SUPABASE_PUBLISHABLE_KEY`; в Settings → Pages выберите GitHub Actions. Workflow задаёт base path по имени репозитория. Публикация в этой сессии не выполнялась.

## Резервное копирование

`scripts/backup.mjs` запускает `pg_dump` для схемы `public` в отдельный закрытый каталог. Нужен PostgreSQL client той же или более новой основной версии. Передайте `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGSSLMODE=require`, `BACKUP_DIR` через защищённое окружение планировщика. Пароль не передаётся аргументом процесса.

```sh
node scripts/backup.mjs
```

Планировщик должен запускать команду ежедневно. Примеры — `scripts/backup.launchd.plist.example` и `scripts/backup-windows.ps1`. `status.json` в каталоге копий содержит дату последнего успеха или ошибки; его возраст позволяет заметить пропущенный запуск. Скрипт не удаляет старые копии автоматически. Закрытый каталог можно синхронизировать с отдельным приватным хранилищем. Копии не следует хранить в GitHub или общедоступной папке.

Проверьте восстановление в отдельный тестовый Supabase-проект: сначала создайте Auth-пользователей с нужными ID и инфраструктуру проекта, затем восстановите дамп `pg_restore --no-owner --no-acl --dbname TEST_DATABASE backup.dump`. При существующей схеме применяйте согласованный план восстановления (не запускайте `--clean` на рабочей базе). После восстановления сравните количество счетов, строк и суммы, проверьте RLS под пользователем и отсутствие доступа у постороннего. Экспорт `public` содержит идентификаторы Telegram, но не оригиналы, Auth, secrets, расписания и Storage.

## Границы текущей проверки

Проверены production-сборка, тесты финансовых расчётов и SQL-операций, извлечение текстового PDF, интерфейс и сохранение демонстрационных данных в браузере. SQL выполняется в тестовом PostgreSQL PGlite с имитацией схем Auth/Storage — это не заменяет проверку в Supabase.

Пока не проверены: реальный Supabase Auth/Storage, доставка Telegram, облачная модель, OCR сканов, восстановление реального дампа, работа двух компьютеров, запуск Docker и Windows. Для этого нужны настроенный проект, бот, архивный чат, учётная запись и тестовые документы.

Офлайн: оболочка кешируется в production-сборке; просмотренные данные — в IndexedDB с привязкой к пользователю и лаборатории. Вход впервые и документы без прежнего кеша требуют сети. При выходе кеш удаляется. Оригиналы не кешируются. Изменения офлайн отключены. Dev server не регистрирует service worker.

Фасовка хранится в строках: изменение карточки не меняет старые закупки. Перенос строк и исправление коэффициента показывают предварительный расчёт; отмена доступна в журнале до следующего изменения затронутых счетов. Базовую единицу карточки с историей нельзя менять незаметно для отчётов. Суммы фильтра по категории относятся к целым счетам, содержащим эту категорию; диаграмма показывает состав выбранных счетов.

Технические источники: [RLS Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security), [защита Edge Functions](https://supabase.com/docs/guides/functions/auth), [Telegram Bot API](https://core.telegram.org/bots/api#getfile).

## Работа в Telegram

`/start` открывает меню. `/status` показывает состояние последнего документа, очередь распознавания и сохранение оригинала отдельно. `/documents` выводит последние документы, `/invoices` — счета. В карточке короткого счёта можно проверить строки и подтвердить его; длинные счета проверяются на сайте, чтобы не подтверждать скрытые за лимитом сообщения строки.

`/materials` и `/find название` открывают карточки материалов с историей закупок. Кнопка «Изменить карточку» предлагает поле, затем бот ждёт новое значение сообщением в том же чате. Ожидание действует 15 минут; `/cancel` отменяет его. Поля: название, категория, производитель, артикул, характеристики, единица и фасовка. Проверка версии защищает от перезаписи изменений с сайта. Цена и количество относятся к строкам счёта; их редактирование пока доступно на сайте.

Webhook должен принимать `message` и `callback_query`. Миграция `006_telegram_interactions.sql` добавляет диалоги редактирования, статусы и уведомления о завершении обработки. Для существующего проекта применяйте только новые миграции. Доступ проверяется по `telegram_user` при каждом сообщении и нажатии кнопки.

## Локальная модель Ollama

Для проверенной Qwen3-14B задайте в `worker/.env`: `MODEL_API_URL=http://127.0.0.1:11434/v1/chat/completions`, `MODEL_API_KEY=ollama`, `MODEL_NAME=qwen3:14b`, `MODEL_REASONING_EFFORT=none`. Значение `ollama` — заглушка, локальный сервер не требует платного ключа. Текст счёта передаётся модели на этом компьютере; результат записывается в Supabase.

На настроенном Mac обработчик запускается службой `ru.dentum.procurement-worker` после входа пользователя. Рабочая копия установлена в `~/Library/Application Support/DentumProcurement/worker`, журнал — в `~/Library/Application Support/DentumProcurement/worker.log`. После изменения исходников нужно обновить рабочую копию и перезапустить службу. Ollama должна быть запущена. Во время сна или выключения Mac задания остаются в облачной очереди. Остановка службы: `launchctl bootout gui/$(id -u)/ru.dentum.procurement-worker`. Запуск: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ru.dentum.procurement-worker.plist`.

## Компьютер администратора на Windows

Инструкция: [WINDOWS.md](WINDOWS.md). Для работы с сайтом достаточно браузера. Для локального распознавания подготовлены `SETUP-WINDOWS.cmd`, `START-WORKER.cmd`, `ENABLE-AUTOSTART.cmd` и `DISABLE-AUTOSTART.cmd`. Приватный `worker-config.env` передаётся отдельно и в репозиторий не входит.
