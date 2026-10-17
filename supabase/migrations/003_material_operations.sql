-- Explicit selection and optimistic locking for merge, split and historical packaging fixes.
create function public.move_material_lines(p_lab uuid,p_source uuid,p_target uuid,p_new_name text,p_lines uuid[],p_versions jsonb,p_factor numeric default null) returns uuid language plpgsql security definer set search_path=public as $$
declare src material;dest material;inv invoice;old_rows jsonb;new_rows jsonb;event_id uuid;versions jsonb;
begin
if not is_member(p_lab) then raise exception 'Нет доступа';end if;
if coalesce(array_length(p_lines,1),0)=0 then raise exception 'Выберите строки';end if;
select * into src from material where id=p_source and lab_id=p_lab for update;if src.id is null then raise exception 'Материал не найден';end if;
if p_factor is not null and p_factor<=0 then raise exception 'Коэффициент должен быть больше нуля';end if;
for inv in select i.* from invoice i where i.lab_id=p_lab and exists(select 1 from invoice_line l where l.invoice_id=i.id and l.id=any(p_lines)) order by i.id for update loop
 if inv.version<>coalesce((p_versions->>inv.id::text)::int,-1) then raise exception 'Счёт уже изменён. Обновите данные';end if;
end loop;
if (select count(*) from invoice_line where lab_id=p_lab and material_id=p_source and id=any(p_lines))<>array_length(p_lines,1) then raise exception 'Строки изменены или недоступны';end if;
if p_target is null then
 if coalesce(trim(p_new_name),'')='' then raise exception 'Укажите название нового материала';end if;
 insert into material(lab_id,name,category,manufacturer,sku,unit,pack,properties) values(p_lab,p_new_name,src.category,src.manufacturer,src.sku,src.unit,src.pack,src.properties) returning * into dest;
else select * into dest from material where id=p_target and lab_id=p_lab;if dest.id is null or dest.unit<>src.unit then raise exception 'Материалы должны иметь одинаковую базовую единицу';end if;end if;
select jsonb_agg(to_jsonb(l) order by l.id) into old_rows from invoice_line l where l.id=any(p_lines);
update invoice_line set material_id=dest.id,category=dest.category,factor=coalesce(p_factor,factor) where id=any(p_lines);
update invoice set version=version+1 where id in (select invoice_id from invoice_line where id=any(p_lines));
select jsonb_agg(to_jsonb(l) order by l.id) into new_rows from invoice_line l where l.id=any(p_lines);
select jsonb_object_agg(id,version) into versions from invoice where id in (select invoice_id from invoice_line where id=any(p_lines));
insert into audit_event(lab_id,action,entity_id,before,after) values(p_lab,'Связи материалов и фасовка изменены',src.id,jsonb_build_object('lines',old_rows),jsonb_build_object('lines',new_rows,'versions',versions)) returning id into event_id;
return event_id;end$$;
create function public.undo_material_move(p_lab uuid,p_event uuid) returns void language plpgsql security definer set search_path=public as $$declare a audit_event;i invoice;l jsonb;begin
if not is_member(p_lab) then raise exception 'Нет доступа';end if;
select * into a from audit_event where id=p_event and lab_id=p_lab and action='Связи материалов и фасовка изменены' for update;if a.id is null then raise exception 'Операция не найдена';end if;
if exists(select 1 from audit_event where lab_id=p_lab and action='Связи восстановлены' and entity_id=p_event) then raise exception 'Операция уже отменена';end if;
for i in select * from invoice where id::text in (select jsonb_object_keys(a.after->'versions')) order by id for update loop
if i.version<>(a.after->'versions'->>i.id::text)::int then raise exception 'После операции счёт изменился. Автоматическая отмена недоступна';end if;
end loop;
for l in select * from jsonb_array_elements(a.before->'lines') loop update invoice_line set material_id=(l->>'material_id')::uuid,factor=(l->>'factor')::numeric,category=l->>'category' where id=(l->>'id')::uuid and lab_id=p_lab;end loop;
update invoice set version=version+1 where id::text in (select jsonb_object_keys(a.after->'versions'));
insert into audit_event(lab_id,action,entity_id,before,after) values(p_lab,'Связи восстановлены',p_event,a.after,a.before);end$$;
revoke all on function move_material_lines(uuid,uuid,uuid,text,uuid[],jsonb,numeric),undo_material_move(uuid,uuid) from public,anon;
grant execute on function move_material_lines(uuid,uuid,uuid,text,uuid[],jsonb,numeric),undo_material_move(uuid,uuid) to authenticated;
