import type { NextRequest } from 'next/server';
import { regionalInsights } from '@/lib/insights';
import { json, route } from '@/lib/http';
import { operator } from '@/lib/security';
import { body } from '@/lib/validation';

export async function POST(request: NextRequest) {
  return route(async () => {
    operator(request);
    return json(await regionalInsights(await body(request)));
  });
}
