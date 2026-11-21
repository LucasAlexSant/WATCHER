import { NextResponse, type NextRequest } from 'next/server';
import { incidentPhoto } from '@/lib/db';
import { route } from '@/lib/http';
import { operator } from '@/lib/security';
import { uuid } from '@/lib/validation';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  return route(async () => {
    operator(request);
    const { id, photoId } = await params;
    const content = await incidentPhoto(uuid(id), uuid(photoId));
    return new NextResponse(Uint8Array.from(Buffer.from(content, 'base64')), { headers: {
      'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    } });
  });
}
