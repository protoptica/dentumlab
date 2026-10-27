alter table public.invoice add column discount_percent numeric(5,2) check(discount_percent between 0 and 100);
alter table public.invoice_line add column base_total bigint check(base_total between 0 and 1000000000000),add column discount_amount bigint not null default 0 check(discount_amount between 0 and 1000000000000);
do $$declare c record;begin for c in select conname from pg_constraint where conrelid='public.invoice_line'::regclass and contype='c' and pg_get_constraintdef(oid) like '%total = round%' loop execute format('alter table public.invoice_line drop constraint %I',c.conname);end loop;end$$;
alter table public.invoice_line add constraint invoice_line_discount_total check(case when base_total is null then total=round(quantity*unit_price) and discount_amount=0 else total=base_total-discount_amount and unit_price=round(total/quantity) end);
create or replace function public.save_invoice(p_lab uuid,p_invoice jsonb,p_confirm boolean default false) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid:=(p_invoice->>'id')::uuid;old invoice;item jsonb;mid uuid;v_status text;v_total bigint;v_before jsonb;
begin
if not is_member(p_lab) then raise exception 'Нет доступа к лаборатории';end if;
if coalesce(trim(p_invoice->>'number'),'')='' or jsonb_array_length(p_invoice->'lines')<1 then raise exception 'Укажите номер и строки счёта';end if;
if not exists(select 1 from jsonb_array_elements(p_invoice->'lines') x where x->>'base_total' is null) and
 (select coalesce(sum(coalesce((x->>'discount_amount')::bigint,0)),0) from jsonb_array_elements(p_invoice->'lines') x) <> coalesce((p_invoice->>'discount')::bigint,0)
 then raise exception 'Скидка не совпадает с суммой скидок товаров';end if;
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
insert into invoice(id,lab_id,number,date,supplier_id,status,delivery,vat,paid,received,version,document_id,seller,marketplace,note,discount,discount_percent) values(v_id,p_lab,p_invoice->>'number',(p_invoice->>'date')::date,(p_invoice->>'supplier_id')::uuid,v_status,(p_invoice->>'delivery')::bigint,p_invoice->>'vat',(p_invoice->>'paid')::bigint,(p_invoice->>'received')::boolean,coalesce(old.version,0)+1,(p_invoice->>'document_id')::uuid,coalesce(p_invoice->>'seller',''),coalesce(p_invoice->>'marketplace',''),coalesce(p_invoice->>'note',''),coalesce((p_invoice->>'discount')::bigint,old.discount,0),nullif(p_invoice->>'discount_percent','')::numeric) on conflict(id) do update set number=excluded.number,date=excluded.date,supplier_id=excluded.supplier_id,status=excluded.status,delivery=excluded.delivery,vat=excluded.vat,paid=excluded.paid,received=excluded.received,version=excluded.version,seller=excluded.seller,marketplace=excluded.marketplace,note=excluded.note,discount=excluded.discount,discount_percent=excluded.discount_percent;
delete from invoice_line where invoice_id=v_id;
for item in select * from jsonb_array_elements(p_invoice->'lines') loop
 if coalesce(trim(item->>'name'),'')='' then raise exception 'Укажите название строки';end if;
 mid:=nullif(item->>'material_id','')::uuid;
 if mid is null and v_status='confirmed' then
  if nullif(item->>'factor','')::numeric<>1 and coalesce(trim(item->>'base_unit'),'')='' then raise exception 'Укажите базовую единицу нового материала';end if;
  insert into material(lab_id,name,category,unit,pack) values(p_lab,item->>'name',coalesce(item->>'category','Без категории'),coalesce(nullif(item->>'base_unit',''),item->>'unit'),case when nullif(item->>'factor','') is not null then (item->>'factor')||' '||coalesce(nullif(item->>'base_unit',''),item->>'unit') else '' end) returning id into mid;
 end if;
 insert into invoice_line(id,lab_id,invoice_id,name,material_id,quantity,unit,unit_price,total,factor,base_unit,category,page,base_total,discount_amount) values((item->>'id')::uuid,p_lab,v_id,item->>'name',mid,(item->>'quantity')::numeric,item->>'unit',(item->>'unit_price')::bigint,(item->>'total')::bigint,nullif(item->>'factor','')::numeric,coalesce(item->>'base_unit',''),coalesce(item->>'category','Без категории'),coalesce((item->>'page')::integer,1),nullif(item->>'base_total','')::bigint,coalesce((item->>'discount_amount')::bigint,0));
 if mid is not null and not exists(select 1 from supplier_material_alias where lab_id=p_lab and supplier_id=(p_invoice->>'supplier_id')::uuid and material_id=mid and original_name=item->>'name') then insert into supplier_material_alias(lab_id,supplier_id,material_id,original_name) values(p_lab,(p_invoice->>'supplier_id')::uuid,mid,item->>'name');end if;
end loop;
insert into audit_event(lab_id,action,entity_id,before,after) values(p_lab,case when p_confirm then 'Счёт подтверждён' else 'Счёт сохранён' end,v_id,v_before,(select to_jsonb(i)||jsonb_build_object('lines',(select jsonb_agg(l) from invoice_line l where invoice_id=v_id)) from invoice i where id=v_id));
update document set status=v_status where id=(select document_id from invoice where id=v_id);
return v_id;end$$;

create or replace function public.complete_extraction(p_job uuid,p_token uuid,p_hash text,p_result jsonb) returns boolean language plpgsql security definer set search_path=public as $$declare j job;d document;sid uuid;iid uuid;x jsonb;duplicate_id uuid;note_text text;begin
select * into j from job where id=p_job and lease_token=p_token and state='running' and kind='extract' and lease_until>now() for update;if j.id is null then return false;end if;
select * into d from document where id=j.document_id for update;
perform pg_advisory_xact_lock(hashtextextended(j.lab_id::text||p_hash,0));
select id into duplicate_id from document where lab_id=j.lab_id and sha256=p_hash and id<>d.id;
if duplicate_id is not null then update document set status='archived',error='Повтор файла: '||duplicate_id::text where id=d.id;perform finish_job(p_job,p_token);return true;end if;
update document set sha256=p_hash,extracted=p_result,status='review',error=null where id=d.id;
if p_result->>'kind'='payment' then update document set status='review',error='Платёжное поручение: отметьте оплату в существующем счёте. Новая закупка не создана.' where id=d.id;perform finish_job(p_job,p_token);return true;end if;
if jsonb_array_length(p_result->'lines')<1 then raise exception 'В документе не найдены строки';end if;
select id into sid from supplier where lab_id=j.lab_id and lower(name)=lower(p_result->>'supplier') limit 1;
if sid is null then insert into supplier(lab_id,name) values(j.lab_id,coalesce(nullif(p_result->>'supplier',''),'Неизвестный поставщик')) returning id into sid;end if;
note_text:='';
if exists(select 1 from invoice where lab_id=j.lab_id and supplier_id=sid and number=p_result->>'number' and date=(p_result->>'date')::date) then note_text:='Возможная новая версия существующего счёта. Сравните документы. '||note_text;end if;
insert into invoice(lab_id,number,date,supplier_id,document_id,delivery,vat,seller,marketplace,note,discount) values(j.lab_id,coalesce(nullif(p_result->>'number',''),'Без номера'),(p_result->>'date')::date,sid,d.id,coalesce((p_result->>'delivery')::bigint,0),coalesce(p_result->>'vat','Не указан'),coalesce(p_result->>'seller',''),coalesce(p_result->>'marketplace',''),note_text,coalesce((p_result->>'discount')::bigint,0)) returning id into iid;
for x in select * from jsonb_array_elements(p_result->'lines') loop
insert into invoice_line(lab_id,invoice_id,name,quantity,unit,unit_price,total,factor,base_unit,category,page,base_total,discount_amount) values(j.lab_id,iid,x->>'name',(x->>'quantity')::numeric,coalesce(x->>'unit','шт.'),(x->>'unit_price')::bigint,(x->>'total')::bigint,nullif(x->>'factor','')::numeric,coalesce(x->>'base_unit',''),coalesce(x->>'category','Без категории'),coalesce((x->>'page')::integer,1),nullif(x->>'base_total','')::bigint,coalesce((x->>'discount_amount')::bigint,0));
end loop;
insert into audit_event(lab_id,action,entity_id,after) values(j.lab_id,'Документ распознан, требуется проверка',iid,jsonb_build_object('document_id',d.id));
perform finish_job(p_job,p_token);return true;end$$;

alter table invoice_line add constraint delivery_no_discount check(name !~* '(доставк|транспортн.*услуг|shipping|delivery)' or discount_amount=0);
