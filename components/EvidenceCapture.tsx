'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Images, X } from 'lucide-react';
import { maxPhotoBytes, maxPhotos } from '@/lib/photos';

async function jpeg(canvas: HTMLCanvasElement) {
  for (const quality of [0.86, 0.72, 0.56]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= maxPhotoBytes) return new File([blob], 'evidencia.jpg', { type: 'image/jpeg' });
  }
  throw new Error('A foto ficou grande demais. Tente uma imagem menor.');
}

function copyFrame(source: CanvasImageSource, width: number, height: number) {
  if (!width || !height) throw new Error('A imagem ainda não está disponível.');
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Não foi possível processar a foto.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return jpeg(canvas);
}

function Preview({ file, index, remove, disabled }: { file: File; index: number; remove: () => void; disabled: boolean }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const source = URL.createObjectURL(file);
    setUrl(source);
    return () => URL.revokeObjectURL(source);
  }, [file]);
  return <figure className="evidence-preview">
    {/* eslint-disable-next-line @next/next/no-img-element -- Local previews are generated as Blob URLs. */}
    {url && <img src={url} alt={`Evidência ${index + 1}`} />}
    <button type="button" aria-label={`Remover foto ${index + 1}`} onClick={remove} disabled={disabled}><X size={18} /></button>
  </figure>;
}

export function EvidenceCapture({ files, onChange, disabled }: {
  files: File[]; onChange: React.Dispatch<React.SetStateAction<File[]>>; disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const camera = useRef<MediaStream | null>(null);
  const cameraAttempt = useRef(0);
  const video = useRef<HTMLVideoElement>(null);
  const captureInput = useRef<HTMLInputElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const full = files.length >= maxPhotos;

  useEffect(() => () => {
    cameraAttempt.current++;
    camera.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);

  function closeCamera() {
    cameraAttempt.current++;
    camera.current?.getTracks().forEach((track) => track.stop());
    camera.current = null;
    setStream(null);
    setReady(false);
  }

  async function openCamera() {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) return captureInput.current?.click();
    setWorking(true);
    const attempt = ++cameraAttempt.current;
    try {
      const feed = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (attempt !== cameraAttempt.current) return feed.getTracks().forEach((track) => track.stop());
      camera.current = feed;
      setStream(feed);
    } catch {
      if (attempt === cameraAttempt.current) setError('A câmera está indisponível. Confira a permissão ou envie uma foto.');
    } finally {
      if (attempt === cameraAttempt.current) setWorking(false);
    }
  }

  async function attach(input: File[]) {
    const available = maxPhotos - files.length;
    setError(input.length > available ? 'Você pode anexar até três fotos.' : '');
    setWorking(true);
    const accepted: File[] = [];
    try {
      for (const file of input.slice(0, available)) {
        if (!file.type.startsWith('image/') || file.size > 30_000_000) {
          throw new Error('Selecione uma imagem de até 30 MB.');
        }
        const image = await createImageBitmap(file);
        try { accepted.push(await copyFrame(image, image.width, image.height)); } finally { image.close(); }
      }
    } catch (cause) {
      setError(cause instanceof Error && cause.name === 'Error' ? cause.message : 'Não foi possível abrir a imagem. Tente JPEG ou PNG.');
    } finally {
      onChange((previous) => [...previous, ...accepted].slice(0, maxPhotos));
      setWorking(false);
    }
  }

  async function takePhoto() {
    const frame = video.current;
    if (!frame || !ready || full) return;
    setWorking(true);
    setError('');
    try {
      const file = await copyFrame(frame, frame.videoWidth, frame.videoHeight);
      onChange((previous) => [...previous, file].slice(0, maxPhotos));
      closeCamera();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setWorking(false);
    }
  }

  return <div className="evidence-capture">
    <button type="button" className="button secondary" aria-expanded={open} disabled={disabled || working} onClick={() => {
      if (open) closeCamera();
      setOpen(!open);
    }}><Images size={19} /> {files.length ? `Fotos anexadas (${files.length}/${maxPhotos})` : 'Anexar fotos'}</button>
    {open && <div className="evidence-controls">
      <p className="muted">Mostre a área afetada. As fotos ficam disponíveis apenas na Central.</p>
      <div className="action-row">
        {!stream && <button type="button" className="button secondary" disabled={disabled || working || full} onClick={openCamera}><Camera size={19} /> Tirar foto</button>}
        <button type="button" className="button secondary" disabled={disabled || working || full}
          onClick={() => uploadInput.current?.click()}><ImagePlus size={19} /> Enviar fotos</button>
        <input ref={uploadInput} type="file" accept="image/*" multiple hidden onChange={(event) => {
          const selected = Array.from(event.target.files ?? []); event.target.value = '';
          if (selected.length) void attach(selected);
        }} />
        <input ref={captureInput} type="file" accept="image/*" capture="environment" hidden onChange={(event) => {
          const selected = Array.from(event.target.files ?? []); event.target.value = '';
          if (selected.length) void attach(selected);
        }} />
      </div>
      {stream && <div className="camera-preview">
        <video ref={video} autoPlay playsInline muted aria-label="Prévia da câmera" onLoadedData={() => setReady(true)} />
        <div className="action-row">
          <button type="button" className="button primary" disabled={disabled || !ready || working || full} onClick={takePhoto}><Camera size={19} /> Capturar foto</button>
          <button type="button" className="button secondary" onClick={closeCamera}>Fechar câmera</button>
        </div>
      </div>}
      {files.length > 0 && <div className="evidence-grid">{files.map((file, index) =>
        <Preview key={index} file={file} index={index} disabled={disabled || working}
          remove={() => onChange((previous) => previous.filter((_, item) => item !== index))} />)}</div>}
      {working && <p role="status" className="muted">Preparando…</p>}
      {error && <p role="alert" className="error">{error}</p>}
    </div>}
  </div>;
}
