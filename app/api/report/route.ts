import { after } from 'next/server';
import { createText, limit } from '@/lib/db';
import { json, route } from '@/lib/http';
import { protocol } from '@/lib/incidents';
import { InputError, reportFrom, uuid } from '@/lib/validation';
import { reportSubmission } from '@/lib/report-submission';
import { signalChange } from '@/lib/voice';

export async function POST(request: Request) {
  return route(async () => {
    const { input, photos } = await reportSubmission(request);
    if (input.confirmed !== true) throw new InputError('Confirme o resumo antes do envio.');
    const key = uuid(input.key);
    const report = reportFrom(input.report);
    await limit('text:submit', 60, 60);
    const result = await createText(report, key, photos);
    if (result.created) after(signalChange);
    return json({ protocol: protocol(result.incident.id) }, result.created ? 201 : 200);
  });
}
