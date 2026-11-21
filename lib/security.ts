import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { InputError } from './validation';

const operatorCookie = 'sos_operator';
const globals = globalThis as typeof globalThis & { sosLocalSecret?: string };
export const localCode = 'sos-local';

export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const capability = () => randomBytes(32).toString('base64url');

export function equal(a: string, b: string) {
  return timingSafeEqual(Buffer.from(hash(a), 'hex'), Buffer.from(hash(b), 'hex'));
}

function sign(value: string, key: string) {
  return createHmac('sha256', key).update(value).digest('base64url');
}

export function isLocal(request: NextRequest) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(request.nextUrl.hostname)
    && !process.env.PUBLIC_URL && !process.env.VERCEL
    && !request.headers.has('cf-connecting-ip');
}

function operatorConfig(request: NextRequest) {
  const local = isLocal(request);
  const code = process.env.SOS_OPERATOR_CODE || (local ? localCode : '');
  const key = process.env.SOS_SESSION_SECRET || (local ? (globals.sosLocalSecret ??= capability()) : '');
  if (!code || !key) throw new InputError('Configure o acesso da central no servidor.', 503);
  return { code, key, secure: !local };
}

export function openOperator(request: NextRequest, response: NextResponse, code: string) {
  const config = operatorConfig(request);
  if (!equal(code, config.code)) throw new InputError('Código de acesso inválido.', 401);
  const expires = String(Date.now() + 12 * 3_600_000);
  response.cookies.set(operatorCookie, `${expires}.${sign(expires, config.key)}`, {
    httpOnly: true, sameSite: 'strict', secure: config.secure, maxAge: 12 * 3600, path: '/',
  });
  return response;
}

export function operator(request: NextRequest) {
  const { key } = operatorConfig(request);
  const [expires, signature] = (request.cookies.get(operatorCookie)?.value ?? '').split('.');
  if (!/^\d{13}$/.test(expires) || Number(expires) < Date.now() ||
      !signature || !equal(signature, sign(expires, key))) {
    throw new InputError('Entre na central para continuar.', 401);
  }
  return process.env.SOS_OPERATOR_NAME?.trim() || 'Operador da demonstração';
}

export function startGuard(code: unknown) {
  const configured = process.env.SOS_VOICE_CODE;
  if (configured && (typeof code !== 'string' || !equal(code, configured))) {
    throw new InputError('Informe um código de voz válido.', 403);
  }
}

export function toolToken(id: string) {
  const key = process.env.SOS_SESSION_SECRET || process.env.NEXT_AGORA_APP_CERTIFICATE;
  if (!key) throw new InputError('Voz da Agora indisponível.', 503);
  return sign(`voice-tool:${id}`, key);
}

export function authorizeTool(request: Request, id: string) {
  const header = request.headers.get('authorization') ?? '';
  if (!equal(header, `Bearer ${toolToken(id)}`)) throw new InputError('Chamada não autorizada.', 401);
}

export function voiceOwner(request: Request) {
  const header = request.headers.get('authorization') ?? '';
  if (!/^Bearer [\w-]{43}$/.test(header)) throw new InputError('Sessão não autorizada.', 401);
  return hash(header.slice(7));
}

export function operatorChannel() {
  const key = process.env.SOS_SESSION_SECRET;
  return key ? `sos-ops-${sign('operator-channel', key).slice(0, 32)}` : null;
}
