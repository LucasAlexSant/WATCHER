import { Globe2 } from 'lucide-react';
import { Summary } from '@/components/Summary';

export default function Panorama() {
  return <main className="wrap operations-page">
    <div className="page-heading"><div><div className="eyebrow"><span className="pulse-dot" /> DEMONSTRAÇÃO</div>
      <h1>Panorama público</h1><p>Relatos verificados na simulação, agrupados por município.</p></div></div>
    <section className="panel public-panel"><header className="panel-header"><h2><Globe2 size={20} /> Resumo por município</h2></header><Summary /></section>
  </main>;
}
