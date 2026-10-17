create function public.complete_archive(p_job uuid,p_token uuid,p_file text,p_chat bigint,p_message bigint) returns boolean language plpgsql security definer set search_path=public as $$declare j job;begin
select * into j from job where id=p_job and lease_token=p_token and state='running' and kind='archive' and lease_until>now() for update;if j.id is null then return false;end if;
update document set file_id=p_file,archive_chat_id=p_chat,archive_message_id=p_message,archive_status='saved',status='received',error=null where id=j.document_id;
insert into job(lab_id,document_id,kind) values(j.lab_id,j.document_id,'extract');perform finish_job(p_job,p_token);return true;end$$;
create function public.complete_extraction(p_job uuid,p_token uuid,p_hash text,p_result jsonb) returns boolean language plpgsql security definer set search_path=public as $$declare j job;d document;sid uuid;iid uuid;x jsonb;duplicate_id uuid;note_text text;begin
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
note_text:=coalesce(p_result->>'note','');
if exists(select 1 from invoice where lab_id=j.lab_id and supplier_id=sid and number=p_result->>'number' and date=(p_result->>'date')::date) then note_text:='Возможная новая версия существующего счёта. Сравните документы. '||note_text;end if;
insert into invoice(lab_id,number,date,supplier_id,document_id,delivery,vat,seller,marketplace,note) values(j.lab_id,coalesce(nullif(p_result->>'number',''),'Без номера'),(p_result->>'date')::date,sid,d.id,coalesce((p_result->>'delivery')::bigint,0),coalesce(p_result->>'vat','Не указан'),coalesce(p_result->>'seller',''),coalesce(p_result->>'marketplace',''),note_text) returning id into iid;
for x in select * from jsonb_array_elements(p_result->'lines') loop
insert into invoice_line(lab_id,invoice_id,name,quantity,unit,unit_price,total,factor,base_unit,category,page) values(j.lab_id,iid,x->>'name',(x->>'quantity')::numeric,coalesce(x->>'unit','шт.'),(x->>'unit_price')::bigint,(x->>'total')::bigint,nullif(x->>'factor','')::numeric,coalesce(x->>'base_unit',''),coalesce(x->>'category','Без категории'),coalesce((x->>'page')::integer,1));
end loop;
insert into audit_event(lab_id,action,entity_id,after) values(j.lab_id,'Документ распознан, требуется проверка',iid,jsonb_build_object('document_id',d.id));
perform finish_job(p_job,p_token);return true;end$$;
revoke all on function complete_archive(uuid,uuid,text,bigint,bigint),complete_extraction(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function complete_archive(uuid,uuid,text,bigint,bigint),complete_extraction(uuid,uuid,text,jsonb) to service_role;
