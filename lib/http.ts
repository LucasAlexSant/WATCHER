import { NextResponse } from 'next/server';
import { InputError } from './validation';

export function json<T>(data: T, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function route(fn: () => Promise<NextResponse>) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof InputError) return json({ error: error.message }, error.status);
    console.error('[sos-live] Falha interna', error instanceof Error ? error.name : typeof error,
      error && typeof error === 'object' && 'code' in error ? error.code : '');
    return json({ error: 'Não foi possível concluir a operação. Tente novamente.' }, 500);
  }
}
