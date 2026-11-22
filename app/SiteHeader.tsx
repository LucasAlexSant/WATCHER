import { Activity, Radio, Shield, Users } from 'lucide-react';

export function SiteHeader({ current }: { current: 'monitors' | 'warrooms' }) {
  return <header className="site-header">
    <div className="header-inner">
      <span className="brand"><Activity size={22} /> WATCHER</span>
      <nav className="main-nav" aria-label="Navegação principal">
        <a href="/" aria-current={current === 'monitors' ? 'page' : undefined}><Radio size={16} /> Monitores</a>
        <a href="/warrooms" aria-current={current === 'warrooms' ? 'page' : undefined}><Users size={16} /> War rooms</a>
      </nav>
      <span className="demo-label"><Shield size={16} /> Demonstração</span>
    </div>
  </header>;
}
