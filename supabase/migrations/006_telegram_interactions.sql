create function public.telegram_legacy_command(p_update bigint,p_telegram bigint,p_chat bigint,p_text text,p_site text) returns void language plpgsql security definer set search_path=public as $$declare u telegram_user;m material;msg text;arg text;mid uuid;new_value text;field text;version_num int;history text;payload jsonb;begin
select * into u from telegram_user where telegram_id=p_telegram;if u.telegram_id is null then raise exception 'Нет доступа';end if;
insert into telegram_update(update_id) values(p_update) on conflict do nothing;if not found then return;end if;
msg:='Отправьте PDF, JPG или PNG до 20 МБ.'||chr(10)||'/find название — поиск материала'||chr(10)||'/material ID — карточка и история'||chr(10)||'/edit ID версия поле значение — исправление карточки'||chr(10)||'Поля: name, category, manufacturer, sku, properties, unit, pack.';
begin
if p_text like '/find %' then
 arg:=trim(substring(p_text from 7));select string_agg(name||chr(10)||'/material '||id::text,chr(10)||chr(10)) into msg from (select id,name from material where lab_id=u.lab_id and position(lower(arg) in lower(name||' '||sku))>0 order by name limit 10) q;msg:=coalesce(msg,'Материалы не найдены');
elsif p_text like '/material %' then
 mid:=trim(substring(p_text from 11))::uuid;select * into m from material where lab_id=u.lab_id and id=mid;if m.id is null then raise exception 'Материал не найден';end if;
 select string_agg(x,chr(10)) into history from (select i.date::text||' · № '||i.number||' · '||(l.unit_price::numeric/100)::text||' ₽ / '||l.unit as x from invoice_line l join invoice i on i.id=l.invoice_id where l.material_id=m.id and i.status='confirmed' order by i.date desc limit 8) q;
 msg:=m.name||chr(10)||'Категория: '||m.category||chr(10)||'Производитель: '||m.manufacturer||chr(10)||'Артикул: '||m.sku||chr(10)||'Характеристики: '||m.properties||chr(10)||'Единица: '||m.unit||'; фасовка: '||m.pack||chr(10)||'Версия: '||m.version||chr(10)||coalesce(history,'Закупок нет')||chr(10)||'Изменить: /edit '||m.id||' '||m.version||' name Новое название';
elsif p_text like '/edit %' then
 mid:=split_part(p_text,' ',2)::uuid;version_num:=split_part(p_text,' ',3)::int;field:=split_part(p_text,' ',4);new_value:=regexp_replace(p_text,'^/edit\s+\S+\s+\S+\s+\S+\s+','');
 if not field=any(array['name','category','manufacturer','sku','properties','unit','pack']) then raise exception 'Неизвестное поле';end if;
 select * into m from material where lab_id=u.lab_id and id=mid;if m.id is null then raise exception 'Материал не найден';end if;
 perform set_config('request.jwt.claim.sub',u.user_id::text,true);
 perform save_material(u.lab_id,to_jsonb(m)||jsonb_build_object(field,new_value,'version',version_num));
 msg:='Карточка сохранена. /material '||mid;
end if;
exception when others then msg:='Не удалось выполнить команду. Проверьте ID, версию и поле. '||case when sqlstate='P0001' then sqlerrm else '' end;end;
payload:=jsonb_build_object('chat_id',p_chat,'text',left(msg,3900));
if p_site like 'https://%' then payload:=payload||jsonb_build_object('reply_markup',jsonb_build_object('inline_keyboard',jsonb_build_array(jsonb_build_array(jsonb_build_object('text','Открыть учёт закупок','url',p_site)))));end if;
insert into job(lab_id,kind,payload) values(u.lab_id,'reply',payload);end$$;

create or replace function public.ingest_telegram(p_update bigint,p_telegram bigint,p_chat bigint,p_message bigint,p_file text,p_unique text,p_name text,p_size bigint) returns uuid language plpgsql security definer set search_path=public as $$declare lid uuid;did uuid;begin
select lab_id into lid from telegram_user where telegram_id=p_telegram;if lid is null then raise exception 'Нет доступа';end if;
insert into telegram_update(update_id) values(p_update) on conflict do nothing;if not found then return null;end if;
if p_size>20971520 then insert into job(lab_id,kind,payload) values(lid,'reply',jsonb_build_object('chat_id',p_chat,'text','Файл больше 20 МБ. Отправьте файл меньшего размера.'));return null;end if;
insert into document(lab_id,name,source,file_id,file_unique_id,chat_id,message_id) values(lid,p_name,'telegram',p_file,p_unique,p_chat,p_message) returning id into did;
insert into job(lab_id,document_id,kind) values(lid,did,'archive');
insert into job(lab_id,kind,payload) values(lid,'reply',jsonb_build_object('chat_id',p_chat,'text','Документ принят. Распознавание ожидает обработчика. Статус — /status', 'reply_markup', jsonb_build_object('inline_keyboard',jsonb_build_array(jsonb_build_array(jsonb_build_object('text','Статус документа','callback_data','/status '||did::text))))));return did;end$$;

create table public.telegram_edit_session(
 telegram_id bigint references public.telegram_user on delete cascade,
 chat_id bigint, entity_id uuid not null, version integer not null,
 field text not null, expires_at timestamptz not null default now()+interval '15 minutes',
 primary key(telegram_id,chat_id));
alter table public.telegram_edit_session enable row level security;
revoke all on public.telegram_edit_session from public,anon,authenticated;
grant all on public.telegram_edit_session to service_role;

create or replace function public.ingest_telegram_command(p_update bigint,p_telegram bigint,p_chat bigint,p_text text,p_site text) returns void
language plpgsql security definer set search_path=public as $$
declare u telegram_user; d document; m material; i invoice; r record; s telegram_edit_session;
 msg text:=''; buttons jsonb:='[]'; payload jsonb; mid uuid; jid uuid; field_name text; cmd text; arg text; data jsonb; hist text;
begin
select * into u from telegram_user where telegram_id=p_telegram;
if u.telegram_id is null then raise exception 'Нет доступа';end if;
-- Serialize update handling and edit prompts for this user/chat.
perform pg_advisory_xact_lock(hashtextextended(p_telegram::text||':'||p_chat::text,0));
if exists(select 1 from telegram_update where update_id=p_update) then return;end if;
p_text:=regexp_replace(trim(p_text),'^(/[a-z_]+)@[A-Za-z0-9_]+','\1');
cmd:=split_part(p_text,' ',1);arg:=trim(substring(p_text from length(cmd)+2));
perform set_config('request.jwt.claim.sub',u.user_id::text,true);
begin
select * into s from telegram_edit_session where telegram_id=p_telegram and chat_id=p_chat and expires_at>now();
if cmd='/cancel' then
 delete from telegram_edit_session where telegram_id=p_telegram and chat_id=p_chat;msg:='Изменение отменено.';
elsif s.entity_id is not null and left(p_text,1)<>'/' then
 select * into m from material where id=s.entity_id and lab_id=u.lab_id;
 if m.id is null then raise exception 'Материал не найден';end if;
 perform save_material(u.lab_id,to_jsonb(m)||jsonb_build_object(s.field,case when p_text='-' then '' else p_text end,'version',s.version));
 delete from telegram_edit_session where telegram_id=p_telegram and chat_id=p_chat;
 msg:='Карточка сохранена.';buttons:=jsonb_build_array(jsonb_build_array(jsonb_build_object('text','Открыть карточку','callback_data','/material '||m.id)));
elsif cmd in ('/status','/queue') then
 if arg<>'' then select * into d from document where id=arg::uuid and lab_id=u.lab_id;
 else select * into d from document where lab_id=u.lab_id order by created_at desc limit 1;end if;
 if d.id is null then msg:='Документов пока нет. Отправьте PDF, JPG или PNG.';
 else
 msg:=d.name||chr(10)||'Статус: '||case d.status when 'received' then 'получен, ожидает обработчика' when 'processing' then 'обрабатывается' when 'review' then 'требует проверки' when 'confirmed' then 'подтверждён' when 'error' then 'ошибка' when 'archived' then 'архивирован' else d.status end||chr(10)||'Оригинал: '||case when d.archive_status='saved' then 'сохранён в Telegram-архиве' else 'архивация не завершена' end;
 for r in select kind,state,attempts,last_error from job where document_id=d.id and kind in ('extract','archive') order by created_at loop
 msg:=msg||chr(10)||case r.kind when 'extract' then 'Распознавание' else 'Архивация' end||': '||case r.state when 'pending' then 'в очереди' when 'running' then 'в работе' when 'done' then 'завершено' else 'ошибка' end||'; попыток: '||r.attempts||case when r.last_error is not null then '; '||r.last_error else '' end;end loop;
 msg:=msg||case when d.error is not null then chr(10)||d.error else '' end;
 buttons:=jsonb_build_array(jsonb_build_array(jsonb_build_object('text','Обновить статус','callback_data','/status '||d.id)));
 select * into i from invoice where document_id=d.id and lab_id=u.lab_id;
 if i.id is not null then buttons:=buttons||jsonb_build_array(jsonb_build_array(jsonb_build_object('text','Открыть счёт','callback_data','/invoice '||i.id)));end if;
 if d.status='error' then buttons:=buttons||jsonb_build_array(jsonb_build_array(jsonb_build_object('text','Повторить обработку','callback_data','/retry '||d.id)));end if;
 end if;
elsif cmd='/retry' then
 perform retry_document(u.lab_id,arg::uuid);msg:='Повторная обработка поставлена в очередь.';
 buttons:=jsonb_build_array(jsonb_build_array(jsonb_build_object('text','Статус','callback_data','/status '||arg)));
elsif cmd='/documents' then
 msg:='Последние документы:';
 for r in select id,name from document where lab_id=u.lab_id order by created_at desc limit 10 loop buttons:=buttons||jsonb_build_array(jsonb_build_array(jsonb_build_object('text',left(r.name,55),'callback_data','/status '||r.id)));end loop;
 if buttons='[]'::jsonb then msg:='Документов пока нет.';end if;
elsif cmd='/invoices' then
 msg:='Последние счета:';
 for r in select id,number,date from invoice where lab_id=u.lab_id order by date desc limit 10 loop buttons:=buttons||jsonb_build_array(jsonb_build_array(jsonb_build_object('text','№ '||r.number||' · '||r.date,'callback_data','/invoice '||r.id)));end loop;
 if buttons='[]'::jsonb then msg:='Счетов пока нет. Статус присланного документа: /status';end if;
elsif cmd='/invoice' then
 select * into i from invoice where id=arg::uuid and lab_id=u.lab_id;if i.id is null then raise exception 'Счёт не найден';end if;
 msg:='Счёт № '||i.number||' от '||i.date||chr(10)||'Статус: '||case i.status when 'review' then 'требует проверки' when 'confirmed' then 'подтверждён' else 'архивирован' end||chr(10)||'Поставщик: '||(select name from supplier where id=i.supplier_id)||chr(10)||'Оплачено: '||(i.paid::numeric/100)||' ₽; товар '||case when i.received then 'получен' else 'не получен' end;
 for r in select * from invoice_line where invoice_id=i.id order by page,id loop msg:=msg||chr(10)||r.name||' · '||r.quantity||' '||r.unit||' × '||(r.unit_price::numeric/100)||' ₽ = '||(r.total::numeric/100)||' ₽';end loop;
 msg:=msg||chr(10)||'Доставка: '||(i.delivery::numeric/100)||' ₽'||chr(10)||'Итого: '||((i.delivery+(select coalesce(sum(total),0) from invoice_line where invoice_id=i.id))::numeric/100)||' ₽'||chr(10)||i.note;
 if length(msg)>3800 then msg:='В счёте много строк. Откройте полную карточку на сайте для проверки всех позиций.'||chr(10)||left(msg,3500);
 elsif i.status='review' then buttons:=jsonb_build_array(jsonb_build_array(jsonb_build_object('text','Подтвердить счёт','callback_data','/confirm '||i.id||' '||i.version)));end if;
elsif cmd='/confirm' then
 select * into i from invoice where id=split_part(arg,' ',1)::uuid and lab_id=u.lab_id;if i.id is null then raise exception 'Счёт не найден';end if;
 if i.status<>'review' then raise exception 'Счёт уже подтверждён или архивирован';end if;
 data:=to_jsonb(i)||jsonb_build_object('version',split_part(arg,' ',2)::int,'lines',(select jsonb_agg(l) from invoice_line l where invoice_id=i.id));
 perform save_invoice(u.lab_id,data,true);msg:='Счёт подтверждён. Материалы доступны в /materials.';
 buttons:=jsonb_build_array(jsonb_build_array(jsonb_build_object('text','Открыть счёт','callback_data','/invoice '||i.id)));
elsif cmd in ('/materials','/find') then
 msg:='Материалы. Поиск: /find название';
 for r in select id,name from material where lab_id=u.lab_id and (cmd='/materials' or position(lower(arg) in lower(name||' '||sku))>0) order by name limit 15 loop
 buttons:=buttons||jsonb_build_array(jsonb_build_array(jsonb_build_object('text',left(r.name,55),'callback_data','/material '||r.id)));end loop;
 if buttons='[]'::jsonb then msg:='Материалов не найдено. Новые карточки создаются после подтверждения счёта.';end if;
elsif cmd='/material' then
 select * into m from material where id=arg::uuid and lab_id=u.lab_id;if m.id is null then raise exception 'Материал не найден';end if;
 select string_agg(x,chr(10)) into hist from (select ih.date||' · № '||ih.number||' · '||(l.unit_price::numeric/100)||' ₽ / '||l.unit x from invoice_line l join invoice ih on ih.id=l.invoice_id where l.material_id=m.id and ih.status='confirmed' order by ih.date desc limit 8) q;
 msg:=m.name||chr(10)||'Категория: '||m.category||chr(10)||'Производитель: '||m.manufacturer||chr(10)||'Артикул: '||m.sku||chr(10)||'Характеристики: '||m.properties||chr(10)||'Единица: '||m.unit||'; фасовка: '||m.pack||chr(10)||'История закупок:'||chr(10)||coalesce(hist,'Закупок нет');
 buttons:=jsonb_build_array(jsonb_build_array(jsonb_build_object('text','Изменить карточку','callback_data','/change '||m.id)));
elsif cmd='/change' then
 select * into m from material where id=arg::uuid and lab_id=u.lab_id;if m.id is null then raise exception 'Материал не найден';end if;
 msg:='Выберите поле: '||m.name;
 for r in select * from (values ('name','Название'),('category','Категория'),('manufacturer','Производитель'),('sku','Артикул'),('properties','Характеристики'),('unit','Единица учёта'),('pack','Фасовка')) as fields(key,label) loop
 buttons:=buttons||jsonb_build_array(jsonb_build_array(jsonb_build_object('text',r.label,'callback_data','/set '||m.id||' '||r.key||' '||m.version)));end loop;
elsif cmd='/set' then
 mid:=split_part(arg,' ',1)::uuid;field_name:=split_part(arg,' ',2);
 if not field_name=any(array['name','category','manufacturer','sku','properties','unit','pack']) then raise exception 'Неизвестное поле';end if;
 select * into m from material where id=mid and lab_id=u.lab_id;if m.id is null then raise exception 'Материал не найден';end if;
 if m.version<>split_part(arg,' ',3)::int then raise exception 'Карточка уже изменена. Откройте её заново';end if;
 insert into telegram_edit_session(telegram_id,chat_id,entity_id,version,field) values(p_telegram,p_chat,mid,m.version,field_name) on conflict(telegram_id,chat_id) do update set entity_id=excluded.entity_id,version=excluded.version,field=excluded.field,expires_at=now()+interval '15 minutes';
 msg:='Текущее значение: '||(to_jsonb(m)->>field_name)||chr(10)||'Отправьте новое значение одним сообщением. «-» — очистить поле. /cancel — отменить. Ожидание 15 минут.';
elsif cmd='/edit' then
 perform telegram_legacy_command(p_update,p_telegram,p_chat,p_text,p_site);return;
else
 msg:='Отправьте PDF, JPG или PNG до 20 МБ.'||chr(10)||'/status — статус последнего документа'||chr(10)||'/documents — документы'||chr(10)||'/invoices — счета'||chr(10)||'/materials — карточки материалов'||chr(10)||'/find название — поиск'||chr(10)||'/cancel — отменить изменение';
 buttons:=jsonb_build_array(jsonb_build_array(jsonb_build_object('text','Статус','callback_data','/status'),jsonb_build_object('text','Документы','callback_data','/documents')),jsonb_build_array(jsonb_build_object('text','Счета','callback_data','/invoices'),jsonb_build_object('text','Материалы','callback_data','/materials')));
end if;
exception when others then msg:=case when sqlstate='P0001' then sqlerrm else 'Не удалось выполнить команду. Откройте карточку заново и проверьте введённое значение.' end;buttons:='[]';end;
insert into telegram_update values(p_update,now()) on conflict do nothing;
if p_site like 'https://%' then buttons:=buttons||jsonb_build_array(jsonb_build_array(jsonb_build_object('text','Открыть сайт','url',p_site)));end if;
payload:=jsonb_build_object('chat_id',p_chat,'text',left(msg,3900),'reply_markup',jsonb_build_object('inline_keyboard',buttons));
insert into job(lab_id,kind,payload) values(u.lab_id,'reply',payload);
end$$;
revoke all on function telegram_legacy_command(bigint,bigint,bigint,text,text) from public,anon,authenticated;
grant execute on function telegram_legacy_command(bigint,bigint,bigint,text,text) to service_role;

-- Notify the sender when processing finishes or fails; the durable queue handles delivery.
create function public.notify_telegram_document_status() returns trigger language plpgsql security definer set search_path=public as $$
declare message text;
begin
if new.chat_id is null or new.status=old.status or new.status not in ('review','error','confirmed','archived') then return new;end if;
message:=new.name||chr(10)||case new.status when 'review' then 'Обработка завершена. Проверьте данные счёта.' when 'error' then 'Ошибка обработки. Откройте статус для подробностей.' when 'confirmed' then 'Счёт подтверждён.' else 'Документ архивирован.' end;
insert into job(lab_id,kind,payload) values(new.lab_id,'reply',jsonb_build_object('chat_id',new.chat_id,'text',left(message,3900),'reply_markup',jsonb_build_object('inline_keyboard',jsonb_build_array(jsonb_build_array(jsonb_build_object('text','Открыть статус и счёт','callback_data','/status '||new.id))))));
return new;end$$;
revoke all on function notify_telegram_document_status() from public,anon,authenticated;
create trigger telegram_document_status after update of status on public.document for each row execute function notify_telegram_document_status();
