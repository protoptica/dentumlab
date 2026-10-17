create function public.ingest_telegram_command(p_update bigint,p_telegram bigint,p_chat bigint,p_text text,p_site text) returns void language plpgsql security definer set search_path=public as $$declare u telegram_user;m material;msg text;arg text;mid uuid;new_value text;field text;version_num int;history text;payload jsonb;begin
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
revoke all on function ingest_telegram_command(bigint,bigint,bigint,text,text) from public,anon,authenticated;
grant execute on function ingest_telegram_command(bigint,bigint,bigint,text,text) to service_role;
