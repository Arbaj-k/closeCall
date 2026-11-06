create table if not exists public.closecall_signals (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.closecall_rooms(id) on delete cascade,
  from_participant_id uuid not null references public.closecall_participants(id) on delete cascade,
  to_participant_id uuid not null references public.closecall_participants(id) on delete cascade,
  signal_type text not null check (signal_type in ('offer','answer','ice','hangup')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  constraint closecall_signals_no_self check (from_participant_id <> to_participant_id)
);
create index if not exists closecall_signals_pending_idx
  on public.closecall_signals (to_participant_id, created_at)
  where consumed_at is null;
create index if not exists closecall_signals_room_created_idx
  on public.closecall_signals (room_id, created_at);
alter table public.closecall_signals enable row level security;
revoke all on public.closecall_signals from anon, authenticated;
grant all on public.closecall_signals to service_role;

 
-- The room-code generator now issues 32-character hexadecimal credentials.
-- Preserve compatibility with existing 8-character room codes/invitation URLs.
alter table public.closecall_rooms
  drop constraint if exists closecall_rooms_room_code_check;
alter table public.closecall_rooms
  add constraint closecall_rooms_room_code_check
  check (room_code ~ '^([A-Z0-9]{8}|[A-F0-9]{32})$');
