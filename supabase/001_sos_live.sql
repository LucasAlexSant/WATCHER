create schema if not exists sos_live;

create table if not exists sos_live.incidents (
  id uuid primary key,
  submission_key uuid not null unique,
  created_at timestamptz not null default now(),
  record jsonb not null
);

create table if not exists sos_live.incident_events (
  id bigint generated always as identity primary key,
  incident_id uuid not null references sos_live.incidents (id),
  event jsonb not null
);
create index if not exists sos_incident_history on sos_live.incident_events (incident_id, id desc);

create table if not exists sos_live.voice_sessions (
  id uuid primary key,
  owner_hash text not null,
  uid text not null,
  channel text not null unique,
  state text not null default 'prepared' check (state in ('prepared','starting','active','stopped')),
  agent_id text,
  draft jsonb,
  revision integer not null default 0,
  incident_id uuid references sos_live.incidents (id),
  expires_at timestamptz not null
);
create index if not exists sos_voice_expiration on sos_live.voice_sessions (expires_at);

create table if not exists sos_live.rate_limits (
  key text primary key,
  expires_at timestamptz not null,
  hits integer not null
);

revoke all on schema sos_live from public;
