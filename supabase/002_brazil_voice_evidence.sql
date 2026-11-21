alter table sos_live.voice_sessions
  add column if not exists purpose text not null default 'report' check (purpose in ('report','insights')),
  add column if not exists device_location jsonb;

create table if not exists sos_live.incident_photos (
  id uuid primary key,
  incident_id uuid not null references sos_live.incidents (id) on delete cascade,
  content bytea not null check (octet_length(content) between 32 and 900000),
  created_at timestamptz not null default now()
);
create index if not exists sos_incident_photos on sos_live.incident_photos (incident_id, created_at);
create index if not exists sos_incident_created on sos_live.incidents (created_at desc);
