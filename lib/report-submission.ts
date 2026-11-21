import { body, InputError, object } from './validation';
import { maxPhotoBytes, maxPhotos } from './photos';

export async function reportSubmission(request: Request) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
    return { input: await body(request), photos: [] as string[] };
  }
  const maxBytes = maxPhotos * maxPhotoBytes + 32_768;
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) {
    throw new InputError('As fotos ultrapassam o tamanho permitido.', 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new InputError('Dados ausentes.');
  const parts: ArrayBuffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new InputError('As fotos ultrapassam o tamanho permitido.', 413);
      }
      parts.push(Uint8Array.from(value).buffer);
    }
  } finally {
    reader.releaseLock();
  }
  let form: FormData;
  let input: Record<string, unknown>;
  try {
    form = await new Response(new Blob(parts), { headers: { 'Content-Type': contentType } }).formData();
    const payload = form.get('payload');
    if (typeof payload !== 'string' || payload.length > 16_384) throw new Error('Invalid report');
    input = object(JSON.parse(payload));
  } catch {
    throw new InputError('Relato ou fotos inválidos.');
  }
  const files = form.getAll('photos');
  if (files.length > maxPhotos) throw new InputError('Anexe até três fotos.');
  const photos = await Promise.all(files.map(async (file) => {
    if (typeof file === 'string' || file.type !== 'image/jpeg' || file.size < 32 || file.size > maxPhotoBytes) {
      throw new InputError('Foto inválida. Selecione a imagem novamente.');
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff ||
        bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
      throw new InputError('A foto precisa estar no formato JPEG.');
    }
    return bytes.toString('base64');
  }));
  return { input, photos };
}
