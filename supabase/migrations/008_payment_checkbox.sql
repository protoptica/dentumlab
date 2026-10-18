create or replace function public.save_invoice(p_lab uuid,p_invoice jsonb,p_confirm boolean default false) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid:=(p_invoice->>'id')::uuid;old invoice;item jsonb;mid uuid;v_status text;v_total bigint;v_before jsonb;
begin
if not is_member(p_lab) then raise exception 'Нет доступа к лаборатории';end if;
if coalesce(trim(p_invoice->>'number'),'')='' or jsonb_array_length(p_invoice->'lines')<1 then raise exception 'Укажите номер и строки счёта';end if;
select * into old from invoice where id=v_id for update;
if found then
 if old.lab_id<>p_lab then raise exception 'Нет доступа';end if;
 if old.version<>(p_invoice->>'version')::integer then raise exception 'Счёт уже изменён. Обновите данные';end if;
 select to_jsonb(old)||jsonb_build_object('lines',(select jsonb_agg(l) from invoice_line l where invoice_id=v_id)) into v_before;
else
 if (p_invoice->>'version')::integer<>0 then raise exception 'Счёт удалён или недоступен';end if;
end if;
v_status:=case when p_confirm or old.status='confirmed' then 'confirmed' else 'review' end;
select coalesce(sum((x->>'total')::bigint),0)+(p_invoice->>'delivery')::bigint into v_total from jsonb_array_elements(p_invoice->'lines') x;
p_invoice:=p_invoice||jsonb_build_object('paid',case when coalesce((p_invoice->>'paid')::bigint,0)>0 then v_total else 0 end);
insert into invoice(id,lab_id,number,date,supplier_id,status,delivery,vat,paid,received,version,document_id,seller,marketplace,note,discount) values(v_id,p_lab,p_invoice->>'number',(p_invoice->>'date')::date,(p_invoice->>'supplier_id')::uuid,v_status,(p_invoice->>'delivery')::bigint,p_invoice->>'vat',(p_invoice->>'paid')::bigint,(p_invoice->>'received')::boolean,coalesce(old.version,0)+1,(p_invoice->>'document_id')::uuid,coalesce(p_invoice->>'seller',''),coalesce(p_invoice->>'marketplace',''),coalesce(p_invoice->>'note',''),coalesce((p_invoice->>'discount')::bigint,old.discount,0)) on conflict(id) do update set number=excluded.number,date=excluded.date,supplier_id=excluded.supplier_id,status=excluded.status,delivery=excluded.delivery,vat=excluded.vat,paid=excluded.paid,received=excluded.received,version=excluded.version,seller=excluded.seller,marketplace=excluded.marketplace,note=excluded.note,discount=excluded.discount;
delete from invoice_line where invoice_id=v_id;
for item in select * from jsonb_array_elements(p_invoice->'lines') loop
 if coalesce(trim(item->>'name'),'')='' then raise exception 'Укажите название строки';end if;
 mid:=nullif(item->>'material_id','')::uuid;
 if mid is null and v_status='confirmed' then
  if nullif(item->>'factor','')::numeric<>1 and coalesce(trim(item->>'base_unit'),'')='' then raise exception 'Укажите базовую единицу нового материала';end if;
  insert into material(lab_id,name,category,unit,pack) values(p_lab,item->>'name',coalesce(item->>'category','Без категории'),coalesce(nullif(item->>'base_unit',''),item->>'unit'),case when nullif(item->>'factor','') is not null then (item->>'factor')||' '||coalesce(nullif(item->>'base_unit',''),item->>'unit') else '' end) returning id into mid;
 end if;
 insert into invoice_line(id,lab_id,invoice_id,name,material_id,quantity,unit,unit_price,total,factor,base_unit,category,page) values((item->>'id')::uuid,p_lab,v_id,item->>'name',mid,(item->>'quantity')::numeric,item->>'unit',(item->>'unit_price')::bigint,(item->>'total')::bigint,nullif(item->>'factor','')::numeric,coalesce(item->>'base_unit',''),coalesce(item->>'category','Без категории'),coalesce((item->>'page')::integer,1));
 if mid is not null and not exists(select 1 from supplier_material_alias where lab_id=p_lab and supplier_id=(p_invoice->>'supplier_id')::uuid and material_id=mid and original_name=item->>'name') then insert into supplier_material_alias(lab_id,supplier_id,material_id,original_name) values(p_lab,(p_invoice->>'supplier_id')::uuid,mid,item->>'name');end if;
end loop;
insert into audit_event(lab_id,action,entity_id,before,after) values(p_lab,case when p_confirm then 'Счёт подтверждён' else 'Счёт сохранён' end,v_id,v_before,(select to_jsonb(i)||jsonb_build_object('lines',(select jsonb_agg(l) from invoice_line l where invoice_id=v_id)) from invoice i where id=v_id));
update document set status=v_status where id=(select document_id from invoice where id=v_id);
return v_id;end$$;
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
 msg:='Счёт № '||i.number||' от '||i.date||chr(10)||'Статус: '||case i.status when 'review' then 'требует проверки' when 'confirmed' then 'подтверждён' else 'архивирован' end||chr(10)||'Поставщик: '||(select name from supplier where id=i.supplier_id)||chr(10)||'Оплачено: '||case when i.paid>0 then 'да' else 'нет' end||'; товар '||case when i.received then 'получен' else 'не получен' end;
 for r in select * from invoice_line where invoice_id=i.id order by page,id loop msg:=msg||chr(10)||r.name||' · '||replace(to_char(r.quantity,'FM999999999990.00'),'.',',')||' '||r.unit||' × '||telegram_money(r.unit_price)||' ₽ = '||telegram_money(r.total)||' ₽';end loop;
 msg:=msg||chr(10)||'Доставка: '||telegram_money(i.delivery)||' ₽'||chr(10)||'Итого: '||telegram_money(i.delivery+(select coalesce(sum(total),0) from invoice_line where invoice_id=i.id))||' ₽'||chr(10)||'Скидка (учтена в ценах): '||telegram_money(i.discount)||' ₽'||case when i.note<>'' then chr(10)||i.note else '' end;
 if length(msg)>3800 then msg:='В счёте много строк. Откройте полную карточку на сайте для проверки всех позиций.'||chr(10)||left(msg,3500);
 elsif i.status='review' then buttons:=jsonb_build_array(jsonb_build_array(jsonb_build_object('text','Подтвердить счёт','callback_data','/confirm '||i.id||' '||i.version)));end if;
buttons:=buttons||jsonb_build_array(jsonb_build_array(jsonb_build_object('text',case when i.paid>0 then '☑ Оплачено' else '☐ Оплачено' end,'callback_data','/paid '||i.id||' '||i.version),jsonb_build_object('text',case when i.received then '☑ Получено' else '☐ Получено' end,'callback_data','/received '||i.id||' '||i.version)));
elsif cmd in ('/paid','/received') then
 select * into i from invoice where id=split_part(arg,' ',1)::uuid and lab_id=u.lab_id;
 if i.id is null then raise exception 'Счёт не найден';end if;
 if i.status='archived' then raise exception 'Счёт архивирован';end if;
 data:=to_jsonb(i)||jsonb_build_object('version',split_part(arg,' ',2)::int,'lines',(select jsonb_agg(l) from invoice_line l where invoice_id=i.id));
 if cmd='/paid' then data:=data||jsonb_build_object('paid',case when i.paid>0 then 0 else i.delivery+(select coalesce(sum(total),0) from invoice_line where invoice_id=i.id) end);
 else data:=data||jsonb_build_object('received',not i.received);end if;
 perform save_invoice(u.lab_id,data,false);msg:='Отметка сохранена.';
 buttons:=jsonb_build_array(jsonb_build_array(jsonb_build_object('text','Открыть счёт','callback_data','/invoice '||i.id)));
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
 select string_agg(x,chr(10)) into hist from (select ih.date||' · № '||ih.number||' · '||telegram_money(l.unit_price)||' ₽ / '||l.unit x from invoice_line l join invoice ih on ih.id=l.invoice_id where l.material_id=m.id and ih.status='confirmed' order by ih.date desc limit 8) q;
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
