import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import 'maplibre-gl/dist/maplibre-gl.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'SOS Live · Relatos em tempo real',
  description: 'Canal de demonstração para registrar e acompanhar relatos de ocorrências.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <SiteHeader />
        {children}
        <footer className="site-footer"><span>SOS Live · Unmute by Agora</span><span>Ambiente de demonstração</span></footer>
      </body>
    </html>
  );
}
