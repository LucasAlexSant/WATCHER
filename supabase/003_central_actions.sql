create table if not exists sos_live.central_actions (
  id bigint generated always as identity primary key,
  session_id uuid not null references sos_live.voice_sessions (id) on delete cascade,
  call_id text,
  action jsonb not null,
  unique (session_id, call_id)
);

create index if not exists sos_central_actions_session on sos_live.central_actions (session_id, id);
