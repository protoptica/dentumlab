-- Apply to a dedicated Supabase project, not the clinic website database.
create extension if not exists pgcrypto;
create table public.lab(id uuid primary key default gen_random_uuid(),name text not null);
create table public.lab_member(lab_id uuid references public.lab on delete cascade,user_id uuid references auth.users on delete cascade,role text not null default 'editor' check(role in ('admin','editor')),primary key(lab_id,user_id));
create function public.is_member(p_lab uuid) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from lab_member where lab_id=p_lab and user_id=auth.uid())$$;
create table public.supplier(id uuid primary key default gen_random_uuid(),lab_id uuid not null references public.lab,name text not null check(length(trim(name))>0),inn text not null default '',unique(id,lab_id));
create table public.material(id uuid primary key default gen_random_uuid(),lab_id uuid not null references public.lab,name text not null,category text not null default 'Без категории',manufacturer text not null default '',sku text not null default '',unit text not null default 'шт.',pack text not null default '',properties text not null default '',version integer not null default 1,unique(id,lab_id));
create table public.document(id uuid primary key default gen_random_uuid(),lab_id uuid not null references public.lab,name text not null,status text not null default 'received' check(status in ('received','processing','review','confirmed','error','archived')),source text not null,archive_status text not null default 'pending',error text,created_at timestamptz not null default now(),storage_path text,file_id text,file_unique_id text,archive_chat_id bigint,archive_message_id bigint,chat_id bigint,message_id bigint,sha256 text,extracted jsonb,unique(id,lab_id));
create unique index document_upload_path on public.document(storage_path) where storage_path is not null;
create unique index document_hash on public.document(lab_id,sha256) where sha256 is not null;
create table public.invoice(id uuid primary key default gen_random_uuid(),lab_id uuid not null references public.lab,number text not null,date date not null,supplier_id uuid not null,status text not null default 'review' check(status in ('review','confirmed','archived')),delivery bigint not null default 0 check(delivery between 0 and 1000000000000),vat text not null default 'Не указан',paid bigint not null default 0 check(paid between 0 and 1000000000000),received boolean not null default false,version integer not null default 1,document_id uuid unique,seller text not null default '',marketplace text not null default '',note text not null default '',unique(id,lab_id),foreign key(supplier_id,lab_id) references public.supplier(id,lab_id),foreign key(document_id,lab_id) references public.document(id,lab_id));
create table public.invoice_line(id uuid primary key default gen_random_uuid(),lab_id uuid not null references public.lab,invoice_id uuid not null,name text not null,material_id uuid,quantity numeric(15,3) not null check(quantity>0),unit text not null,unit_price bigint not null check(unit_price between 0 and 1000000000000),total bigint not null check(total between 0 and 1000000000000),factor numeric(15,3) check(factor>0),base_unit text not null default '',category text not null default 'Без категории',page integer not null default 1 check(page>0),foreign key(invoice_id,lab_id) references public.invoice(id,lab_id) on delete cascade,foreign key(material_id,lab_id) references public.material(id,lab_id),check(total=round(quantity*unit_price)));
create table public.supplier_material_alias(id uuid primary key default gen_random_uuid(),lab_id uuid not null references public.lab,supplier_id uuid not null,material_id uuid not null,original_name text not null,foreign key(supplier_id,lab_id) references supplier(id,lab_id),foreign key(material_id,lab_id) references material(id,lab_id));
create table public.audit_event(id uuid primary key default gen_random_uuid(),lab_id uuid not null references public.lab,user_id uuid default auth.uid(),created_at timestamptz not null default now(),action text not null,entity_id uuid not null,before jsonb,after jsonb);
create table public.job(id uuid primary key default gen_random_uuid(),lab_id uuid not null references public.lab,document_id uuid references public.document,kind text not null check(kind in ('archive','extract','reply')),payload jsonb not null default '{}',state text not null default 'pending' check(state in ('pending','running','done','error')),attempts integer not null default 0,available_at timestamptz not null default now(),lease_until timestamptz,lease_token uuid,last_error text,created_at timestamptz not null default now());
create index job_claim on public.job(kind,state,available_at);
create table public.telegram_user(telegram_id bigint primary key,lab_id uuid not null,user_id uuid not null,foreign key(lab_id,user_id) references public.lab_member(lab_id,user_id) on delete cascade);
create table public.telegram_update(update_id bigint primary key,created_at timestamptz not null default now());
create table public.worker_credential(id uuid primary key default gen_random_uuid(),lab_id uuid not null references public.lab,token_hash text unique not null,revoked boolean not null default false);
-- Explicit table privileges and RLS. Privileged writes only through checked functions.
do $$declare t text;begin foreach t in array array['lab','lab_member','supplier','material','document','invoice','invoice_line','supplier_material_alias','audit_event','job','telegram_user','telegram_update','worker_credential'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;foreach t in array array['supplier','material','document','invoice','invoice_line','supplier_material_alias','audit_event'] loop execute format('grant select on public.%I to authenticated',t);execute format('create policy member_read on public.%I for select to authenticated using(public.is_member(lab_id))',t);end loop;end$$;
grant select on lab_member to authenticated;
create policy self_membership on lab_member for select to authenticated using(user_id=auth.uid());
grant insert on supplier to authenticated;
create policy member_supplier_insert on supplier for insert to authenticated with check(public.is_member(lab_id));
create function public.app_snapshot(p_lab uuid) returns jsonb language plpgsql security invoker set search_path=public as $$begin
if not is_member(p_lab) then raise exception 'Нет доступа к лаборатории';end if;
return jsonb_build_object('invoices',coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object('lines',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('quantity',l.quantity::text,'factor',coalesce(l.factor::text,''))) from invoice_line l where l.invoice_id=i.id),'[]'::jsonb))) from invoice i where i.lab_id=p_lab),'[]'::jsonb),'materials',coalesce((select jsonb_agg(m) from material m where lab_id=p_lab),'[]'::jsonb),'suppliers',coalesce((select jsonb_agg(s) from supplier s where lab_id=p_lab),'[]'::jsonb),'documents',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'status',d.status,'source',d.source,'archive_status',d.archive_status,'error',d.error,'created_at',d.created_at)) from document d where lab_id=p_lab),'[]'::jsonb),'audit',coalesce((select jsonb_agg(a order by a.created_at desc) from (select * from audit_event where lab_id=p_lab order by created_at desc limit 200) a),'[]'::jsonb),'synced_at',now());end$$;
create function public.save_invoice(p_lab uuid,p_invoice jsonb,p_confirm boolean default false) returns uuid language plpgsql security definer set search_path=public as $$
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
if (p_invoice->>'paid')::bigint>v_total then raise exception 'Оплата превышает сумму счёта';end if;
insert into invoice(id,lab_id,number,date,supplier_id,status,delivery,vat,paid,received,version,document_id,seller,marketplace,note) values(v_id,p_lab,p_invoice->>'number',(p_invoice->>'date')::date,(p_invoice->>'supplier_id')::uuid,v_status,(p_invoice->>'delivery')::bigint,p_invoice->>'vat',(p_invoice->>'paid')::bigint,(p_invoice->>'received')::boolean,coalesce(old.version,0)+1,(p_invoice->>'document_id')::uuid,coalesce(p_invoice->>'seller',''),coalesce(p_invoice->>'marketplace',''),coalesce(p_invoice->>'note','')) on conflict(id) do update set number=excluded.number,date=excluded.date,supplier_id=excluded.supplier_id,status=excluded.status,delivery=excluded.delivery,vat=excluded.vat,paid=excluded.paid,received=excluded.received,version=excluded.version,seller=excluded.seller,marketplace=excluded.marketplace,note=excluded.note;
delete from invoice_line where invoice_id=v_id;
for item in select * from jsonb_array_elements(p_invoice->'lines') loop
 if coalesce(trim(item->>'name'),'')='' then raise exception 'Укажите название строки';end if;
 mid:=nullif(item->>'material_id','')::uuid;
 if mid is null and v_status='confirmed' then
  if nullif(item->>'factor','')::numeric<>1 and coalesce(trim(item->>'base_unit'),'')='' then raise exception 'Укажите базовую единицу нового материала';end if;
  insert into material(lab_id,name,category,unit) values(p_lab,item->>'name',coalesce(item->>'category','Без категории'),coalesce(nullif(item->>'base_unit',''),item->>'unit')) returning id into mid;
 end if;
 insert into invoice_line(id,lab_id,invoice_id,name,material_id,quantity,unit,unit_price,total,factor,base_unit,category,page) values((item->>'id')::uuid,p_lab,v_id,item->>'name',mid,(item->>'quantity')::numeric,item->>'unit',(item->>'unit_price')::bigint,(item->>'total')::bigint,nullif(item->>'factor','')::numeric,coalesce(item->>'base_unit',''),coalesce(item->>'category','Без категории'),coalesce((item->>'page')::integer,1));
 if mid is not null and not exists(select 1 from supplier_material_alias where lab_id=p_lab and supplier_id=(p_invoice->>'supplier_id')::uuid and material_id=mid and original_name=item->>'name') then insert into supplier_material_alias(lab_id,supplier_id,material_id,original_name) values(p_lab,(p_invoice->>'supplier_id')::uuid,mid,item->>'name');end if;
end loop;
insert into audit_event(lab_id,action,entity_id,before,after) values(p_lab,case when p_confirm then 'Счёт подтверждён' else 'Счёт сохранён' end,v_id,v_before,(select to_jsonb(i)||jsonb_build_object('lines',(select jsonb_agg(l) from invoice_line l where invoice_id=v_id)) from invoice i where id=v_id));
update document set status=v_status where id=(select document_id from invoice where id=v_id);
return v_id;end$$;
create function public.save_material(p_lab uuid,p_material jsonb) returns void language plpgsql security definer set search_path=public as $$declare old material;begin
if not is_member(p_lab) then raise exception 'Нет доступа';end if;
select * into old from material where id=(p_material->>'id')::uuid and lab_id=p_lab for update;
if old.id is null then raise exception 'Материал не найден';end if;
if old.version<>(p_material->>'version')::int then raise exception 'Карточка уже изменена. Обновите данные';end if;
if coalesce(trim(p_material->>'name'),'')='' or coalesce(trim(p_material->>'unit'),'')='' then raise exception 'Укажите название и единицу';end if;
-- Base units cannot silently relabel historical prices.
if old.unit<>p_material->>'unit' and exists(select 1 from invoice_line where material_id=old.id) then raise exception 'Нельзя менять базовую единицу материала с историей. Создайте отдельную карточку';end if;
update material set name=p_material->>'name',category=p_material->>'category',manufacturer=p_material->>'manufacturer',sku=p_material->>'sku',unit=p_material->>'unit',pack=p_material->>'pack',properties=p_material->>'properties',version=version+1 where id=old.id;
insert into audit_event(lab_id,action,entity_id,before,after) values(p_lab,'Материал изменён',old.id,to_jsonb(old),(select to_jsonb(m) from material m where id=old.id));end$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('incoming','incoming',false,20971520,array['application/pdf','image/jpeg','image/png']),('previews','previews',false,20971520,array['application/pdf','image/jpeg','image/png']);
create policy member_upload on storage.objects for insert to authenticated with check(bucket_id='incoming' and public.is_member((storage.foldername(name))[1]::uuid));
create policy member_upload_delete on storage.objects for delete to authenticated using(bucket_id='incoming' and owner_id=auth.uid()::text and not exists(select 1 from public.document where storage_path=name));
create function public.register_upload(p_lab uuid,p_path text,p_name text,p_size bigint) returns uuid language plpgsql security definer set search_path=public as $$declare did uuid;begin
if not is_member(p_lab) or split_part(p_path,'/',1)<>p_lab::text then raise exception 'Нет доступа';end if;
if p_size>20971520 or p_size<=0 then raise exception 'Допустим файл до 20 МБ';end if;
if not exists(select 1 from storage.objects where bucket_id='incoming' and name=p_path and owner_id=auth.uid()::text and (metadata->>'size')::bigint=p_size) then raise exception 'Файл не найден или размер не совпадает';end if;
if exists(select 1 from document where storage_path=p_path) then raise exception 'Файл уже зарегистрирован';end if;
insert into document(lab_id,name,source,storage_path) values(p_lab,p_name,'web',p_path) returning id into did;
insert into job(lab_id,document_id,kind) values(p_lab,did,'archive');return did;end$$;
create function public.retry_document(p_lab uuid,p_document uuid) returns void language plpgsql security definer set search_path=public as $$begin
if not is_member(p_lab) then raise exception 'Нет доступа';end if;
update job set state='pending',attempts=0,available_at=now(),lease_until=null,lease_token=null where lab_id=p_lab and document_id=p_document and state='error';update document set status='received',error=null where id=p_document and lab_id=p_lab and status='error';end$$;
-- Queue functions are service-only. Local workers reach these through a scoped gateway.
create function public.claim_job(p_kind text,p_lab uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$declare j job;begin
with expired as (update job set state='error',last_error='Обработчик не завершил задание после 5 попыток',lease_token=null where state='running' and lease_until<now() and attempts>=5 returning document_id) update document set status='error',error='Обработчик не завершил задание после 5 попыток' where id in (select document_id from expired);
select * into j from job where kind=p_kind and (p_lab is null or lab_id=p_lab) and attempts<5 and ((state='pending' and available_at<=now()) or (state='running' and lease_until<now())) order by created_at for update skip locked limit 1;
if j.id is null then return null;end if;
update job set state='running',lease_until=now()+interval '10 minutes',lease_token=gen_random_uuid(),attempts=attempts+1 where id=j.id returning * into j;
if j.document_id is not null then update document set status='processing',error=null where id=j.document_id and status not in ('confirmed','archived');end if;
return to_jsonb(j);end$$;
create function public.finish_job(p_id uuid,p_token uuid,p_error text default null) returns boolean language plpgsql security definer set search_path=public as $$declare j job;begin
select * into j from job where id=p_id and lease_token=p_token and state='running' and lease_until>now() for update;if j.id is null then return false;end if;
update job set state=case when p_error is null then 'done' when attempts>=5 then 'error' else 'pending' end,last_error=p_error,available_at=now()+make_interval(secs=>least(3600,30*power(2,j.attempts)::int)),lease_token=null,lease_until=null where id=j.id;
if p_error is not null and j.document_id is not null then update document set status=case when j.attempts>=5 then 'error' else 'received' end,error=p_error where id=j.document_id;end if;return true;end$$;
create function public.ingest_telegram(p_update bigint,p_telegram bigint,p_chat bigint,p_message bigint,p_file text,p_unique text,p_name text,p_size bigint) returns uuid language plpgsql security definer set search_path=public as $$declare lid uuid;did uuid;begin
select lab_id into lid from telegram_user where telegram_id=p_telegram;if lid is null then raise exception 'Нет доступа';end if;
insert into telegram_update(update_id) values(p_update) on conflict do nothing;if not found then return null;end if;
if p_size>20971520 then insert into job(lab_id,kind,payload) values(lid,'reply',jsonb_build_object('chat_id',p_chat,'text','Файл больше 20 МБ. Отправьте файл меньшего размера.'));return null;end if;
insert into document(lab_id,name,source,file_id,file_unique_id,chat_id,message_id) values(lid,p_name,'telegram',p_file,p_unique,p_chat,p_message) returning id into did;
insert into job(lab_id,document_id,kind) values(lid,did,'archive');
insert into job(lab_id,kind,payload) values(lid,'reply',jsonb_build_object('chat_id',p_chat,'text','Документ принят в очередь. После обработки проверьте счёт на сайте.'));return did;end$$;
-- Default EXECUTE grants apply to new functions too; close every privileged entry point.
do $$declare f record;begin for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('is_member','app_snapshot','save_invoice','save_material','register_upload','retry_document','claim_job','finish_job','ingest_telegram') loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;end$$;
grant execute on function is_member(uuid),app_snapshot(uuid),save_invoice(uuid,jsonb,boolean),save_material(uuid,jsonb),register_upload(uuid,text,text,bigint),retry_document(uuid,uuid) to authenticated;
