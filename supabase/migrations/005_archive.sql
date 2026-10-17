create function public.archive_invoice(p_lab uuid,p_id uuid,p_version integer) returns void language plpgsql security definer set search_path=public as $$declare old invoice;begin
if not is_member(p_lab) then raise exception 'Нет доступа';end if;
select * into old from invoice where id=p_id and lab_id=p_lab for update;
if old.id is null then raise exception 'Счёт не найден';end if;
if old.version<>p_version then raise exception 'Счёт уже изменён. Обновите данные';end if;
update invoice set status='archived',version=version+1 where id=p_id;
update document set status='archived' where id=old.document_id;
insert into audit_event(lab_id,action,entity_id,before,after) values(p_lab,'Счёт архивирован',p_id,to_jsonb(old),(select to_jsonb(i) from invoice i where id=p_id));end$$;
revoke all on function archive_invoice(uuid,uuid,integer) from public,anon;
grant execute on function archive_invoice(uuid,uuid,integer) to authenticated;
