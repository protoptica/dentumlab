alter table public.job add column retry_round integer not null default 0 check(retry_round between 0 and 2);
create function public.schedule_extraction_retries(p_lab uuid default null) returns void language plpgsql security definer set search_path=public as $$declare j job; delay interval;begin
for j in select q.* from job q join document d on d.id=q.document_id where q.kind='extract' and q.state='error' and q.retry_round<2 and coalesce(q.payload->>'retryable','true')<>'false' and (p_lab is null or q.lab_id=p_lab) and d.status not in ('confirmed','archived','declined') and not exists(select 1 from invoice i where i.document_id=d.id) for update of q skip locked loop
 delay:=case when j.retry_round=0 then interval '15 minutes' else interval '2 hours' end;
 update job set state='pending',attempts=0,retry_round=retry_round+1,available_at=now()+delay,lease_token=null,lease_until=null where id=j.id;
 update document set status='received',error='Автоповтор '||(j.retry_round+1)||'/2 после '||to_char((now()+delay) at time zone 'Europe/Moscow','DD.MM HH24:MI')||' МСК'||'. Причина: '||coalesce(j.last_error,'Обработчик не завершил задание') where id=j.document_id;
end loop;end$$;
create or replace function public.claim_job(p_kind text,p_lab uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$declare j job;begin
with expired as (update job set state='error',last_error='Обработчик не завершил задание после 5 попыток',lease_token=null where kind=p_kind and (p_lab is null or lab_id=p_lab) and state='running' and lease_until<now() and attempts>=5 returning document_id) update document set status='error',error='Обработчик не завершил задание после 5 попыток' where id in (select document_id from expired) and status not in ('confirmed','archived','declined');
perform schedule_extraction_retries(p_lab);
select * into j from job where kind=p_kind and (p_lab is null or lab_id=p_lab) and (kind<>'extract' or exists(select 1 from document d where d.id=job.document_id and d.status not in ('confirmed','archived','declined') and not exists(select 1 from invoice i where i.document_id=d.id))) and attempts<5 and ((state='pending' and available_at<=now()) or (state='running' and lease_until<now())) order by created_at for update skip locked limit 1;
if j.id is null then return null;end if;
update job set state='running',lease_until=now()+interval '10 minutes',lease_token=gen_random_uuid(),attempts=attempts+1 where id=j.id returning * into j;
if j.document_id is not null then update document set status='processing',error=null where id=j.document_id and status not in ('confirmed','archived','declined');end if;
return to_jsonb(j);end$$;
create or replace function public.finish_job(p_id uuid,p_token uuid,p_error text default null) returns boolean language plpgsql security definer set search_path=public as $$declare j job;begin
select * into j from job where id=p_id and lease_token=p_token and state='running' and lease_until>now() for update;if j.id is null then return false;end if;
update job set state=case when p_error is null then 'done' when attempts>=5 then 'error' else 'pending' end,last_error=p_error,available_at=now()+make_interval(secs=>least(3600,30*power(2,j.attempts)::int)),lease_token=null,lease_until=null where id=j.id;
if p_error is not null and j.document_id is not null then update document set status=case when j.attempts>=5 then 'error' else 'received' end,error=p_error where id=j.document_id and status not in ('confirmed','archived','declined');end if;
if p_error is not null and j.kind='extract' then perform schedule_extraction_retries(j.lab_id);end if;return true;end$$;

create function public.fail_extraction(p_id uuid,p_token uuid,p_error text,p_retryable boolean default true) returns boolean language plpgsql security definer set search_path=public as $$declare j job;begin
select * into j from job where id=p_id and kind='extract' and state='running' and lease_token=p_token and lease_until>now() for update;
if j.id is null then return false;end if;
update job set payload=payload||jsonb_build_object('retryable',p_retryable),attempts=case when p_retryable then attempts else 5 end where id=j.id;
return finish_job(p_id,p_token,p_error);end$$;
revoke all on function schedule_extraction_retries(uuid),fail_extraction(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function schedule_extraction_retries(uuid),fail_extraction(uuid,uuid,text,boolean) to service_role;
