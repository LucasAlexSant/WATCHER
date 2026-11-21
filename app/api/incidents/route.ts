import type { NextRequest } from 'next/server';
import { listIncidents } from '@/lib/db';
import { json, route } from '@/lib/http';
import { operator } from '@/lib/security';

export async function GET(request: NextRequest) {
  return route(async () => {
    operator(request);
    return json({ incidents: await listIncidents() });
  });
}
