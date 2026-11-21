import { publicSummary } from '@/lib/db';
import { json, route } from '@/lib/http';

export async function GET() {
  return route(async () => json({ simulation: true, groups: await publicSummary() }));
}
