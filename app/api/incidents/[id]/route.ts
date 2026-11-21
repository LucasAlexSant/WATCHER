import { after, type NextRequest } from 'next/server';
import { incidentDetail, reviewIncident } from '@/lib/db';
import { json, route } from '@/lib/http';
import { operator } from '@/lib/security';
import { body, reviewFrom, uuid } from '@/lib/validation';
import { signalChange } from '@/lib/voice';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  return route(async () => {
    operator(request);
    return json(await incidentDetail(uuid((await context.params).id)));
  });
}

export async function PATCH(request: NextRequest, context: Context) {
  return route(async () => {
    const actor = operator(request);
    const edit = reviewFrom(await body(request));
    const incident = await reviewIncident(uuid((await context.params).id), edit, actor);
    after(signalChange);
    return json({ incident });
  });
}
