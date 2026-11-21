import { NextRequest } from 'next/server';
import { POST as sessionAction } from '../route';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return sessionAction(new NextRequest(request.url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: request.headers.get('authorization') ?? '' },
    body: JSON.stringify({ action: 'stop' }),
  }), context);
}
