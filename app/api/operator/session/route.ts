import type { NextRequest } from 'next/server';
import { limit } from '@/lib/db';
import { json, route } from '@/lib/http';
import { isLocal, openOperator, operator } from '@/lib/security';
import { body, content, InputError } from '@/lib/validation';

export async function GET(request: NextRequest) {
  return route(async () => {
    try {
      return json({ actor: operator(request) });
    } catch (error) {
      if (error instanceof InputError && error.status === 401) {
        return json({ actor: null, local: isLocal(request) && !process.env.SOS_OPERATOR_CODE });
      }
      throw error;
    }
  });
}

export async function POST(request: NextRequest) {
  return route(async () => {
    const input = await body(request);
    await limit('operator:login', 20, 300);
    return openOperator(request, json({ ok: true }), content(input.code, 'Código', 1, 200));
  });
}

export async function DELETE() {
  const response = json({ ok: true });
  response.cookies.delete('sos_operator');
  return response;
}
