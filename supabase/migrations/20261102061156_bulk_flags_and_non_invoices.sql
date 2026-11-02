create function public.mark_invoices(p_lab uuid,p_ids uuid[],p_field text) returns void
language plpgsql security definer set search_path=public as $$
declare old invoice; n integer:=0;
begin
if not is_member(p_lab) then raise exception 'Нет доступа';end if;
if p_field not in ('paid','received') or p_field is null then raise exception 'Неизвестная отметка';end if;
if coalesce(cardinality(p_ids),0)=0 then return;end if;
for old in select * from invoice where lab_id=p_lab and id=any(p_ids) order by id for update loop
 if old.status in ('archived','declined') then raise exception 'Нельзя отметить архивный или отклонённый счёт';end if;
 update invoice set paid=case when p_field='paid' then delivery+(select coalesce(sum(total),0) from invoice_line where invoice_id=old.id) else paid end,
 received=case when p_field='received' then true else received end,version=version+1 where id=old.id;
 insert into audit_event(lab_id,action,entity_id,before,after) values(p_lab,case when p_field='paid' then 'Отмечена оплата' else 'Отмечено получение' end,old.id,to_jsonb(old),(select to_jsonb(i) from invoice i where id=old.id));
 n:=n+1;
end loop;
if n<>(select count(distinct x) from unnest(p_ids) x) then raise exception 'Счёт не найден или недоступен';end if;
end$$;
revoke all on function mark_invoices(uuid,uuid[],text) from public,anon;
grant execute on function mark_invoices(uuid,uuid[],text) to authenticated;

create function public.archive_non_invoice(p_job uuid,p_token uuid) returns boolean
language plpgsql security definer set search_path=public as $$
declare j job; d document;
begin
select * into j from job where id=p_job and kind='extract' and state='running' and lease_token=p_token and lease_until>now() for update;
if j.id is null then return false;end if;
select * into d from document where id=j.document_id for update;
if d.status in ('confirmed','declined','archived') or exists(select 1 from invoice where document_id=d.id) then return false;end if;
perform set_config('dentum.telegram_card','1',true);
update document set status='archived',error=null,extracted=coalesce(extracted,'{}'::jsonb)||'{"kind":"not_invoice"}'::jsonb where id=d.id;
perform set_config('dentum.telegram_card','0',true);
update job set state='done',lease_token=null,lease_until=null,last_error=null where id=j.id;
insert into audit_event(lab_id,action,entity_id,before,after) values(d.lab_id,'Документ не является счётом — архивирован без обработки',d.id,to_jsonb(d),(select to_jsonb(x) from document x where id=d.id));
if d.chat_id is not null then
 insert into job(lab_id,kind,payload) values(d.lab_id,'reply',jsonb_build_object('chat_id',d.chat_id,'text',left(d.name,3500)||chr(10)||'Документ не является счётом, поэтому архивирован без обработки. Оригинал сохранён.'));
end if;
return true;
end$$;
revoke all on function archive_non_invoice(uuid,uuid) from public,anon,authenticated;
grant execute on function archive_non_invoice(uuid,uuid) to service_role;
