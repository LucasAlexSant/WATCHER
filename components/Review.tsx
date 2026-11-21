'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Images, X } from 'lucide-react';
import { api, send } from '@/lib/browser-api';
import { operationalLabels, protocol, verificationLabels, type Incident, type IncidentEvent, type PhotoEvidence } from '@/lib/incidents';
import { ReportFields } from './ReportFields';
import { LocationPicker } from './LocationPicker';
import { dateTime } from './Operations';

type RecordView = { incident: Incident; history: IncidentEvent[]; photos: PhotoEvidence[] };

export function Review({ id, close, saved }: {
  id: string; close: () => void; saved: (incident: Incident) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [record, setRecord] = useState<RecordView | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    const controller = new AbortController();
    element?.showModal();
    void api<RecordView>(`/api/incidents/${id}`, { signal: controller.signal })
      .then(setRecord).catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => { controller.abort(); element?.close(); };
  }, [id]);

  const incident = record?.incident;
  const update = (patch: Partial<Incident>) => setRecord((previous) => previous
    ? { ...previous, incident: { ...previous.incident, ...patch } } : previous);

  async function store(event: React.FormEvent) {
    event.preventDefault();
    if (!incident) return;
    setSaving(true);
    setError('');
    try {
      const result = await api<{ incident: Incident }>(`/api/incidents/${id}`, send('PATCH', {
        report: incident, verification: incident.verification, operational: incident.operational,
        version: incident.version, reason,
      }));
      saved(result.incident);
      close();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return <dialog ref={dialog} className="review-dialog" aria-labelledby="review-title"
    onCancel={(event) => { event.preventDefault(); if (!saving) close(); }}>
    <div className="dialog-heading"><div><h2 id="review-title">Revisar ocorrência</h2><p>{protocol(id)}</p></div>
      <button type="button" className="icon-button" aria-label="Fechar" disabled={saving} onClick={close}><X size={22} /></button></div>
    {incident ? <form onSubmit={store} className="dialog-body fields">
      <p className="muted">Origem {incident.source === 'voice' ? 'por voz' : incident.source === 'text' ? 'por texto' : 'simulada'} · {dateTime.format(new Date(incident.createdAt))}</p>
      {record.photos.length > 0 && <section className="review-evidence">
        <h3><Images size={19} /> Fotos da ocorrência</h3>
        <div className="evidence-grid">{record.photos.map((photo, index) => {
          const src = `/api/incidents/${id}/photos/${photo.id}`;
          return <a key={photo.id} href={src} target="_blank" rel="noreferrer" aria-label={`Abrir foto ${index + 1} em outra aba`}>
            <Image src={src} alt={`Evidência ${index + 1} da ocorrência`} unoptimized width={220} height={150} />
          </a>;
        })}</div>
      </section>}
      <ReportFields value={incident} onChange={update} />
      <LocationPicker key={`${incident.city}:${incident.uf}:${incident.address}`} location={incident.coordinates}
        fallback={incident.coordinates?.precision === 'approximate' ? incident.coordinates : null} report={incident}
        onChange={(coordinates) => update({ coordinates })} />
      <div className="fields-row">
        <label>Verificação<select value={incident.verification} onChange={(e) => update({ verification: e.target.value as Incident['verification'] })}>
          {Object.entries(verificationLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select></label>
        <label>Situação operacional<select value={incident.operational} onChange={(e) => update({ operational: e.target.value as Incident['operational'] })}>
          {Object.entries(operationalLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select></label>
      </div>
      <label>Justificativa<textarea minLength={4} maxLength={500} rows={2} required value={reason}
        onChange={(e) => setReason(e.target.value)} placeholder="Descreva o motivo da alteração." /></label>
      {error && <p role="alert" className="error">{error}</p>}
      <button className="button primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar revisão'}</button>
      {Boolean(record.history.length) && <section className="history"><h3>Histórico</h3>{record.history.map((event) =>
        <article key={event.after.version}><strong>{event.actor}</strong><span>{dateTime.format(new Date(event.at))} · {verificationLabels[event.after.verification]}</span><p>{event.reason}</p></article>)}</section>}
    </form> : <div className="dialog-body">{error ? <p className="error" role="alert">{error}</p> : <p role="status">Carregando…</p>}</div>}
  </dialog>;
}
