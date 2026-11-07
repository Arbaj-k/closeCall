-- Five-character room codes (letters and digits excluding ambiguous characters).
create table if not exists public.closecall_join_limits (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists closecall_join_limits_ip_created_idx
  on public.closecall_join_limits(ip_hash, created_at desc);
alter table public.closecall_join_limits enable row level security;
revoke all on public.closecall_join_limits from anon, authenticated;
grant all on public.closecall_join_limits to service_role;

create or replace function public.closecall_allow_join(p_ip_hash text)
returns boolean
language plpgsql
set search_path = ''
as $function$
declare v_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('join:' || p_ip_hash, 0));
  delete from public.closecall_join_limits where created_at < now() - interval '1 day';
  select count(*) into v_count from public.closecall_join_limits
   where ip_hash=p_ip_hash and created_at > now() - interval '15 minutes';
  if v_count >= 20 then return false; end if;
  insert into public.closecall_join_limits(ip_hash) values (p_ip_hash);
  return true;
end;
$function$;
revoke all on function public.closecall_allow_join(text) from public, anon, authenticated;
grant execute on function public.closecall_allow_join(text) to service_role;

alter table public.closecall_rooms drop constraint if exists closecall_rooms_room_code_check;
alter table public.closecall_rooms add constraint closecall_rooms_room_code_check
 check (room_code ~ '^([A-Z0-9]{5}|[A-Z0-9]{8}|[A-F0-9]{32})$');
