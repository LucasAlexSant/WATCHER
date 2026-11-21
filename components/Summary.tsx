'use client';

import { useEffect, useState } from 'react';
import { categories, type Category, type UF } from '@/lib/incidents';
import { api } from '@/lib/browser-api';

type Group = { city: string; uf: UF; category: Category; total: number };

export function Summary() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const data = await api<{ groups: Group[] }>('/api/public/summary', { signal: controller.signal });
        setGroups(data.groups);
        setFailed(false);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
      if (!controller.signal.aborted) timer = setTimeout(refresh, 5000);
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);
  return <div className="public-content">
    {failed && <p className="error" role="status">Não foi possível atualizar o panorama.</p>}
    {groups === null ? <p className="muted">Carregando…</p> : !groups.length ? <p className="muted">Nenhum relato verificado nos municípios da demonstração.</p> :
      <table><thead><tr><th>Município</th><th>Categoria</th><th>Relatos</th></tr></thead>
        <tbody>{groups.map(({ city, uf, category, total }) => <tr key={`${city}:${uf}:${category}`}><td>{city} ({uf})</td><td>{categories[category]}</td><td>{total}</td></tr>)}</tbody></table>}
  </div>;
}
