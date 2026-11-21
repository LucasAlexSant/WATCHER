'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity } from 'lucide-react';

const links = [
  { href: '/', label: 'Relatar ocorrência' },
  { href: '/panorama', label: 'Panorama público' },
  { href: '/central', label: 'Central' },
];

export function SiteHeader({ workspace = false, children }: { workspace?: boolean; children?: ReactNode }) {
  const pathname = usePathname();
  if (!workspace && pathname === '/central') return null;

  return <header className="site-header">
    <div className="header-inner">
      <Link className="brand" href="/">
        <Activity size={22} aria-hidden="true" /> SOS Live
      </Link>
      <nav className="site-nav" aria-label="Navegação principal">
        {links.map(({ href, label }) => <Link key={href} href={href}
          aria-current={pathname === href ? 'page' : undefined}>{label}</Link>)}
      </nav>
      <div className="site-header-actions">
        <span className="site-demo">Demonstração</span>
        {children}
      </div>
    </div>
  </header>;
}
