'use client';

import { useId, type ReactNode } from 'react';
import { ArrowUpRight, X } from 'lucide-react';

export function EvidenceCard({ title, caption, children }: {
  title: string; caption: string; children: ReactNode;
}) {
  const id = useId();
  const heading = `${id}-heading`;
  return <div className="evidence-card">
    <button type="button" className="evidence-trigger" popoverTarget={id}>
      <span><small>{caption}</small><strong>{title}</strong></span>
      <ArrowUpRight size={16} aria-hidden="true" />
    </button>
    <section id={id} popover="auto" className="evidence-popover" aria-labelledby={heading}>
      <header>
        <div><p>{caption}</p><h3 id={heading}>{title}</h3></div>
        <button type="button" className="icon-button" aria-label="Fechar detalhes" popoverTarget={id} popoverTargetAction="hide"><X size={19} /></button>
      </header>
      <div className="evidence-detail">{children}</div>
    </section>
  </div>;
}
