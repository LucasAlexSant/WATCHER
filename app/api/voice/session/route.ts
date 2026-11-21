import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { limit, prepareVoice } from '@/lib/db';
import { json, route } from '@/lib/http';
import { capability, hash, operator, startGuard } from '@/lib/security';
import { body, deviceFrom, InputError } from '@/lib/validation';
import { audioToken, newUid } from '@/lib/voice';

export async function POST(request: NextRequest) {
  return route(async () => {
    const input = await body(request);
    const purpose = input.purpose ?? 'report';
    if (purpose !== 'report' && purpose !== 'insights') throw new InputError('Tipo de atendimento desconhecido.');
    if (purpose === 'insights') operator(request);
    else startGuard(input.code);
    const id = randomUUID();
    const owner = capability();
    const data = audioToken(newUid(), `sos-${id}`);
    await limit('voice:prepare', 30, 60);
    await prepareVoice(id, hash(owner), data.uid, data.channel, purpose,
      purpose === 'report' ? deviceFrom(input.device) : null);
    return json({ ...data, id, owner }, 201);
  });
}
