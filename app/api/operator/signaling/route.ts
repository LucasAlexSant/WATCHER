import type { NextRequest } from 'next/server';
import { json, route } from '@/lib/http';
import { operator } from '@/lib/security';
import { operatorToken } from '@/lib/voice';

export async function GET(request: NextRequest) {
  return route(async () => {
    operator(request);
    return json(operatorToken());
  });
}
