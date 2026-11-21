'use client';

import type { ReactNode } from 'react';
import { PhoneOff } from 'lucide-react';

type LayoutProps = {
  audioError: boolean;
  statusPanel: ReactNode;
  pipelineMetrics: ReactNode;
  transcriptPanel: ReactNode;
  visualizer: ReactNode;
  controls: ReactNode;
  onEndConversation: () => void;
};

export function QuickstartConversationLayout({
  audioError, statusPanel, pipelineMetrics, transcriptPanel, visualizer, controls, onEndConversation,
}: LayoutProps) {
  return <div className="live-call">
    <header>
      {statusPanel}
      <strong>Conversa com SOS Live</strong>
      <button type="button" className="button secondary" onClick={onEndConversation}><PhoneOff size={17} /> Encerrar</button>
    </header>
    {audioError && <p role="alert" className="error">O áudio falhou. Verifique a conexão ou continue por texto.</p>}
    <div className="call-grid">
      <div className="transcript-wrap">{transcriptPanel}</div>
      <div className="audio-dock">{visualizer}{controls}</div>
    </div>
    {pipelineMetrics}
  </div>;
}
