import { json } from '@/lib/http';

export function GET() {
  return json({ ok: true, simulation: true,
    voiceCodeRequired: Boolean(process.env.SOS_VOICE_CODE),
    voiceConfigured: Boolean(process.env.NEXT_PUBLIC_AGORA_APP_ID && process.env.NEXT_AGORA_APP_CERTIFICATE && process.env.PUBLIC_URL?.startsWith('https://')) });
}
