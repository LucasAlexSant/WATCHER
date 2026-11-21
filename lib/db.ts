import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import postgres from 'postgres';
import { type DeviceLocation, type Incident, type IncidentEvent, type PhotoEvidence, type Report, type VoiceDraft, type VoiceMapEvent, type VoicePurpose } from './incidents';
import { municipality } from './geography';
import type { CentralAction, CentralEvent } from './central-actions';
import { examplesAt } from './seed';
import { InputError, type reviewFrom } from './validation';

type Query = <T>(sql: string, args?: (string | number | null)[]) => Promise<T[]>;
type Database = { query: Query; transaction: <T>(fn: (query: Query) => Promise<T>) => Promise<T> };
type Session = {
  id: string; owner_hash: string; uid: string; channel: string;
  state: 'prepared' | 'starting' | 'active' | 'stopped'; agent_id: string | null;
  purpose: VoicePurpose; device_location: (Partial<Omit<DeviceLocation, 'accuracy'>> & { mapEvent?: VoiceMapEvent }) | null;
  draft: Report | null; revision: number; incident_id: string | null;
};
const globalDb = globalThis as typeof globalThis & { sosDatabase?: Promise<Database> };

async function connect(): Promise<Database> {
  const url = process.env.DATABASE_URL;
  let db: Database;
  if (url) {
    const client = postgres(url, { prepare: false, max: 5, connect_timeout: 8, ssl: 'require' });
    db = {
      query: async (sql, args = []) => Array.from(await client.unsafe(sql, args)) as never[],
      transaction: async (fn) => await client.begin(async (tx) => fn(
        async (sql, args = []) => Array.from(await tx.unsafe(sql, args)) as never[],
      )) as Awaited<ReturnType<typeof fn>>,
    };
  } else {
    const dir = process.env.SOS_DATA_DIR ?? path.join(process.cwd(), 'data', 'postgres');
    if (dir !== 'memory://') await mkdir(path.dirname(dir), { recursive: true });
    const client = new PGlite(dir);
    await client.exec(await readFile(path.join(process.cwd(), 'supabase', '001_sos_live.sql'), 'utf8'));
    await client.exec(await readFile(path.join(process.cwd(), 'supabase', '002_brazil_voice_evidence.sql'), 'utf8'));
    await client.exec(await readFile(path.join(process.cwd(), 'supabase', '003_central_actions.sql'), 'utf8'));
    db = {
      query: async <T>(sql: string, args: (string | number | null)[] = []) => (await client.query<T>(sql, args)).rows,
      transaction: (fn) => client.transaction((tx) => fn(async (sql, args = []) => (await tx.query(sql, args)).rows as never[])),
    };
  }
  if (process.env.SOS_SEED === '1' || (!url && process.env.SOS_SEED !== '0')) {
    await db.transaction(async (query) => {
      for (const example of examplesAt(Date.now())) {
        await insert(query, example, example.id, 'Cenário fictício carregado.', 'simulação');
      }
    });
  }
  return db;
}

function database() {
  return globalDb.sosDatabase ??= connect().catch((error) => {
    delete globalDb.sosDatabase;
    throw error;
  });
}

async function log(query: Query, before: Incident | null, after: Incident, reason: string, actor: string) {
  const event: IncidentEvent = { before, after, reason, actor, at: after.updatedAt };
  await query('insert into sos_live.incident_events (incident_id, event) values ($1, $2::jsonb)',
    [after.id, JSON.stringify(event)]);
}

async function insert(query: Query, incident: Incident, key: string, reason: string, actor: string) {
  const [added] = await query<{ record: Incident }>(
    `insert into sos_live.incidents (id, submission_key, record, created_at) values ($1,$2,$3::jsonb,$4)
     on conflict (submission_key) do nothing returning record`,
    [incident.id, key, JSON.stringify(incident), incident.createdAt],
  );
  if (added) {
    await log(query, null, incident, reason, actor);
    return { incident: added.record, created: true };
  }
  const [existing] = await query<{ record: Incident }>('select record from sos_live.incidents where submission_key=$1', [key]);
  return { incident: existing.record, created: false };
}

function newIncident(report: Report, source: Incident['source']): Incident {
  const now = new Date().toISOString();
  return { ...report, id: randomUUID(), source, verification: 'unverified', operational: 'received',
    createdAt: now, updatedAt: now, version: 1 };
}

async function storePhotos(query: Query, incidentId: string, photos: string[]) {
  for (const content of photos) {
    await query("insert into sos_live.incident_photos (id, incident_id, content) values ($1, $2, decode($3,'base64'))",
      [randomUUID(), incidentId, content]);
  }
}

export async function createText(report: Report, key: string, photos: string[] = []) {
  return (await database()).transaction(async (query) => {
    const result = await insert(query, newIncident(report, 'text'), key, 'Resumo confirmado pelo cidadão.', 'cidadão');
    if (result.created) await storePhotos(query, result.incident.id, photos);
    return result;
  });
}

export async function listIncidents() {
  const rows = await (await database()).query<{ record: Incident }>(
    'select record from sos_live.incidents order by created_at desc, id desc limit 300');
  return rows.map(({ record }) => withLegacyState(record));
}

function withLegacyState(incident: Incident): Incident {
  if (incident.uf) return incident;
  const place = municipality(incident.city);
  return place ? { ...incident, uf: place.uf } : incident;
}

export async function incidentDetail(id: string) {
  const db = await database();
  return db.transaction(async (query) => {
    const [row] = await query<{ record: Incident }>('select record from sos_live.incidents where id=$1 for share', [id]);
    if (!row) throw new InputError('Ocorrência não encontrada.', 404);
    const history = await query<{ event: IncidentEvent }>(
      'select event from sos_live.incident_events where incident_id=$1 order by id desc limit 50', [id]);
    const photos = await query<PhotoEvidence>(`select id, created_at as "createdAt"
      from sos_live.incident_photos where incident_id=$1 order by created_at,id`, [id]);
    return { incident: withLegacyState(row.record), history: history.map(({ event }) => event), photos };
  });
}

export async function incidentPhoto(incidentId: string, photoId: string) {
  const [photo] = await (await database()).query<{ base64: string }>(
    "select encode(content,'base64') as base64 from sos_live.incident_photos where incident_id=$1 and id=$2",
    [incidentId, photoId]);
  if (!photo) throw new InputError('Foto não encontrada.', 404);
  return photo.base64;
}

export async function reviewIncident(id: string, edit: ReturnType<typeof reviewFrom>, actor: string) {
  return (await database()).transaction(async (query) => {
    const [row] = await query<{ record: Incident }>('select record from sos_live.incidents where id=$1 for update', [id]);
    if (!row) throw new InputError('Ocorrência não encontrada.', 404);
    const before = row.record;
    if (before.version !== edit.version) throw new InputError('O relato mudou. Reabra a revisão para ver a versão atual.', 409);
    const after: Incident = { ...before, ...edit.report, verification: edit.verification,
      operational: edit.operational, updatedAt: new Date().toISOString(), version: before.version + 1 };
    await query('update sos_live.incidents set record=$2::jsonb where id=$1', [id, JSON.stringify(after)]);
    await log(query, before, after, edit.reason, actor);
    return after;
  });
}

export async function limit(key: string, max: number, seconds: number) {
  const [row] = await (await database()).query<{ hits: number }>(
    `insert into sos_live.rate_limits (key, expires_at, hits) values ($1, now() + $2 * interval '1 second', 1)
     on conflict (key) do update set
       hits=case when sos_live.rate_limits.expires_at <= now() then 1 else sos_live.rate_limits.hits+1 end,
       expires_at=case when sos_live.rate_limits.expires_at <= now() then excluded.expires_at else sos_live.rate_limits.expires_at end
     returning hits`, [key, seconds],
  );
  if (row.hits > max) throw new InputError('Muitas tentativas. Aguarde um pouco e tente novamente.', 429);
}

export async function prepareVoice(id: string, ownerHash: string, uid: string, channel: string,
  purpose: VoicePurpose = 'report', device: DeviceLocation | null = null) {
  const db = await database();
  await db.transaction(async (query) => {
    await query('delete from sos_live.voice_sessions where expires_at <= now()');
    await query('delete from sos_live.rate_limits where expires_at <= now()');
    await query(`insert into sos_live.voice_sessions (id,owner_hash,uid,channel,purpose,device_location,expires_at)
      values ($1,$2,$3,$4,$5,$6::jsonb,now()+interval '20 minutes')`,
      [id, ownerHash, uid, channel, purpose, locationHint(device)]);
  });
}

export async function requireToolSession(id: string, purpose: VoicePurpose) {
  const [session] = await (await database()).query<Session>(`select * from sos_live.voice_sessions
    where id=$1 and purpose=$2 and state in ('starting','active') and expires_at>now()`, [id, purpose]);
  if (!session) throw new InputError('A ferramenta não pertence a uma sessão ativa.', 403);
  return session;
}

export async function saveCentralAction(id: string, callId: string | null, action: CentralAction) {
  await (await database()).transaction(async (query) => {
    // Assign cursors in commit order within a session, including when tools run concurrently.
    const [active] = await query<{ id: string }>(`select id from sos_live.voice_sessions
      where id=$1 and purpose='insights' and state in ('starting','active') and expires_at>now() for update`, [id]);
    if (!active) throw new InputError('A sessão da Central terminou.', 403);
    await query(`insert into sos_live.central_actions (session_id,call_id,action) values ($1,$2,$3::jsonb)
      on conflict (session_id,call_id) do nothing`, [id, callId, JSON.stringify(action)]);
  });
}

export async function centralActions(id: string, cursor: string) {
  return (await database()).query<CentralEvent>(`select id::text as cursor, action
    from sos_live.central_actions where session_id=$1 and id>$2::bigint order by id limit 20`, [id, cursor]);
}

export async function lookupIncidentProtocol(suffix: string) {
  const rows = await (await database()).query<{ record: Incident }>(`select record from sos_live.incidents
    where upper(right(replace(id::text,'-',''),length($1)))=$1 order by created_at desc limit 2`, [suffix]);
  return rows.map(({ record }) => withLegacyState(record));
}

export async function changeDevice(id: string, ownerHash: string, device: DeviceLocation | null) {
  await (await database()).query(`update sos_live.voice_sessions set device_location=case
      when device_location ? 'mapEvent'
        and device_location->'mapEvent'->'point'->'latitude' = $3::jsonb->'coordinates'->'latitude'
        and device_location->'mapEvent'->'point'->'longitude' = $3::jsonb->'coordinates'->'longitude'
        and $3::jsonb->'confirmedForIncident' = 'false'::jsonb
      then device_location || ($3::jsonb - 'coordinates' - 'confirmedForIncident')
      else $3::jsonb end
    where id=$1 and owner_hash=$2 and purpose='report' and incident_id is null`,
    [id, ownerHash, locationHint(device)]);
}

function locationHint(device: DeviceLocation | null) {
  if (!device) return null;
  return JSON.stringify({ city: device.city, uf: device.uf, coordinates: device.coordinates,
    street: device.street ?? null, neighborhood: device.neighborhood ?? null, houseNumber: device.houseNumber ?? null,
    confirmedForIncident: device.confirmedForIncident === true && device.coordinates.precision === 'confirmed' });
}

export async function decideVoiceLocation(id: string, location: Session['device_location'], decision: 'consultar' | 'confirmar' | 'descartar') {
  if (!location?.coordinates) return location;
  const confirmed = decision === 'confirmar' || location.confirmedForIncident === true;
  const kind = decision === 'descartar' ? 'discarded' : confirmed ? 'confirmed' : 'shown';
  const point = { ...location.coordinates, precision: confirmed ? 'confirmed' as const : location.coordinates.precision };
  const mapEvent: VoiceMapEvent = { id: randomUUID(), kind, point };
  const result = kind === 'discarded' ? { mapEvent } : { ...location, coordinates: point, confirmedForIncident: confirmed, mapEvent };
  const [session] = await (await database()).query<Session>(
    `update sos_live.voice_sessions set device_location=$3::jsonb,
       draft=case
         when draft is not null and ($4 = 'confirmar' or ($4 = 'descartar' and draft->'coordinates' = device_location->'coordinates'))
         then jsonb_set(draft, '{coordinates}', coalesce($3::jsonb->'coordinates', 'null'::jsonb))
         else draft end,
       revision=revision+case
         when draft is not null and ($4 = 'confirmar' or ($4 = 'descartar' and draft->'coordinates' = device_location->'coordinates'))
         then 1 else 0 end
     where id=$1 and device_location=$2::jsonb and purpose='report'
     and state in ('starting','active') and incident_id is null and expires_at>now() returning device_location`,
    [id, JSON.stringify(location), JSON.stringify(result), decision],
  );
  if (!session) throw new InputError('O ponto mudou. Consulte a localização novamente.', 409);
  return session.device_location;
}

export async function requireVoice(id: string, ownerHash: string) {
  const [session] = await (await database()).query<Session>(
    'select * from sos_live.voice_sessions where id=$1 and owner_hash=$2 and expires_at>now()', [id, ownerHash]);
  if (!session) throw new InputError('Sessão de voz expirada ou inválida.', 404);
  return session;
}

export async function changeVoice(id: string, from: Session['state'], to: Session['state'], agentId: string | null = null) {
  const [session] = await (await database()).query<Session>(
    `update sos_live.voice_sessions set state=$3, agent_id=coalesce($4,agent_id)
     where id=$1 and state=$2 returning *`, [id, from, to, agentId]);
  return session;
}

export async function stageDraft(id: string, report: Report): Promise<VoiceDraft> {
  const [row] = await (await database()).query<{ revision: number; draft: Report }>(
    `update sos_live.voice_sessions set draft=case
       when device_location->'confirmedForIncident' = 'true'::jsonb and device_location ? 'coordinates'
       then jsonb_set($2::jsonb, '{coordinates}', device_location->'coordinates')
       else $2::jsonb end, revision=revision+1
     where id=$1 and purpose='report' and state in ('starting','active') and incident_id is null and expires_at>now() returning revision, draft`,
    [id, JSON.stringify(report)]);
  if (!row) throw new InputError('O relato já foi confirmado ou a sessão terminou.', 409);
  return { report: row.draft, revision: row.revision };
}

export async function voiceReceipt(id: string) {
  const [row] = await (await database()).query<{ incident_id: string | null }>(
    'select incident_id from sos_live.voice_sessions where id=$1 and expires_at>now()', [id]);
  return row?.incident_id ?? null;
}

export async function confirmVoice(id: string, ownerHash: string, revision: number, coordinates: Report['coordinates'], photos: string[] = []) {
  return (await database()).transaction(async (query) => {
    const [session] = await query<Session>(
      'select * from sos_live.voice_sessions where id=$1 and owner_hash=$2 and expires_at>now() for update', [id, ownerHash]);
    if (!session?.draft || session.purpose !== 'report' || session.revision !== revision) {
      throw new InputError('O resumo mudou ou expirou. Confira a versão exibida.', 409);
    }
    const report = { ...session.draft, coordinates: coordinates ?? session.draft.coordinates };
    const result = await insert(query, newIncident(report, 'voice'), id, 'Resumo de voz confirmado na tela.', 'cidadão');
    if (result.created) await storePhotos(query, result.incident.id, photos);
    await query('update sos_live.voice_sessions set incident_id=$2 where id=$1', [id, result.incident.id]);
    return { ...result, agentId: session.state === 'active' ? session.agent_id : null, channel: session.channel };
  });
}

export async function publicSummary() {
  const rows = await (await database()).query<{ city: string; uf: Report['uf']; category: Incident['category']; total: number }>(
    `select trim(record->>'city') as city, record->>'uf' as uf, record->>'category' as category, count(*)::integer as total
     from sos_live.incidents where record->>'verification'='verified' and nullif(trim(record->>'city'),'') is not null
     group by 1,2,3 order by 4 desc,1`,
  );
  const groups = new Map<string, { city: string; uf: NonNullable<Report['uf']>; category: Incident['category']; total: number }>();
  for (const row of rows) {
    const place = municipality(row.city, row.uf);
    if (!place) continue;
    const key = `${place.id}:${row.category}`;
    const known = groups.get(key);
    if (known) known.total += row.total;
    else groups.set(key, { city: place.name, uf: place.uf, category: row.category, total: row.total });
  }
  return [...groups.values()].sort((a, b) => b.total - a.total);
}

export type InsightRecord = Pick<Incident, 'id' | 'city' | 'uf' | 'category' | 'verification' | 'createdAt'>;

export async function incidentsSince(since: string) {
  return (await database()).query<InsightRecord>(`select id, record->>'city' as city, record->>'uf' as uf,
    record->>'category' as category, record->>'verification' as verification, record->>'createdAt' as "createdAt"
    from sos_live.incidents where created_at >= $1 order by created_at desc, id desc`, [since]);
}
