create function public.material_key(value text) returns text language sql immutable set search_path=public as $$
select lower(regexp_replace(trim(coalesce(value,'')),'\s+',' ','g'))
$$;
create function public.reuse_material(p_lab uuid,p_supplier uuid,p_name text,p_unit text,p_factor numeric) returns uuid language plpgsql security definer set search_path=public as $$
declare matches uuid[];
begin
perform pg_advisory_xact_lock(hashtextextended(p_lab::text,0));
select array_agg(m.id) into matches from material m
where m.lab_id=p_lab and (material_key(m.name)=material_key(p_name) or exists(select 1 from supplier_material_alias a where a.material_id=m.id and a.lab_id=p_lab and a.supplier_id=p_supplier and material_key(a.original_name)=material_key(p_name))) and material_key(m.unit)=material_key(p_unit)
and (case when p_factor is null then trim(m.pack)=''
else case when m.pack ~ '^\s*[0-9]+([.,][0-9]+)?\s+'
then replace(substring(m.pack from '^\s*([0-9]+(?:[.,][0-9]+)?)'),',','.')::numeric=p_factor
and material_key(regexp_replace(m.pack,'^\s*[0-9]+([.,][0-9]+)?\s+',''))=material_key(p_unit)
else false end end);
if cardinality(matches)>1 then raise exception 'Найдено несколько одинаковых карточек. Выберите материал в строке счёта';end if;
return matches[1];
end$$;
revoke all on function reuse_material(uuid,uuid,text,text,numeric) from public,anon,authenticated;
grant execute on function reuse_material(uuid,uuid,text,text,numeric) to service_role;
do $$
declare definition text; old_text text;
begin
definition:=pg_get_functiondef('public.save_invoice(uuid,jsonb,boolean)'::regprocedure);
old_text:='  insert into material(lab_id,name,category,unit,pack) values';
if position(old_text in definition)=0 then raise exception 'save_invoice changed: patch unavailable';end if;
definition:=replace(definition,old_text,
'  mid:=reuse_material(p_lab,(p_invoice->>''supplier_id'')::uuid,item->>''name'',coalesce(nullif(item->>''base_unit'',''''),item->>''unit''),nullif(item->>''factor'','''')::numeric);
  if mid is null then
  insert into material(lab_id,name,category,unit,pack) values');
definition:=replace(definition,'returning id into mid;','returning id into mid; end if;');
execute definition;
end$$;

create function public.delete_material(p_lab uuid,p_id uuid,p_version integer) returns void language plpgsql security definer set search_path=public as $$
declare old material;
begin
if not exists(select 1 from lab_member where lab_id=p_lab and user_id=auth.uid() and role='admin') then raise exception 'Удаление доступно только администратору';end if;
select * into old from material where id=p_id and lab_id=p_lab for update;
if old.id is null then raise exception 'Карточка не найдена';end if;
if old.version<>p_version then raise exception 'Карточка изменена. Обновите данные';end if;
if exists(select 1 from invoice_line where material_id=p_id) then raise exception 'Сначала перенесите все строки закупок в другую карточку';end if;
delete from supplier_material_alias where material_id=p_id and lab_id=p_lab;
delete from material where id=p_id and lab_id=p_lab;
insert into audit_event(lab_id,action,entity_id,before) values(p_lab,'Карточка материала удалена',p_id,to_jsonb(old));
end$$;
revoke all on function delete_material(uuid,uuid,integer) from public,anon;
grant execute on function delete_material(uuid,uuid,integer) to authenticated;
