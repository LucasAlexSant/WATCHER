export type RollbackStage = 'planned' | 'in_progress' | 'completed';
export type RollbackUpdate = { stage: RollbackStage; reportedAt: string; changeId?: string };

export const rollbackLabels: Record<RollbackStage, string> = {
  planned: 'Rollback planejado',
  in_progress: 'Rollback em andamento',
  completed: 'Rollback concluído segundo o plantão',
};

export function rollbackFromSpeech(text: string, at: string): RollbackUpdate | undefined {
  const normalized = text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/\b(preciso|precisamos|vou|vamos)(?=(?:iniciar|executar|fazer|realizar)\b)/g, '$1 ');
  const change = normalized.match(/\bgmud[\s-]*(\d{3,})\b/);
  const target = '(?:rollback|roll back|reversao)';
  const clauses = normalized.split(/(?<=[.!?,;])/);
  let stage: RollbackStage | undefined;
  for (const clause of clauses) {
    if (clause.includes('?') || /\b(?:nao|talvez|se|quando|hipotese)\b/.test(clause) || !new RegExp(target).test(clause)) continue;
    if (new RegExp(`\\b(?:terminei|conclui|concluimos|executei|executamos|finalizei|finalizamos|fiz|fizemos) (?:de |o |a |um )?${target}\\b|\\b${target} (?:ja )?(?:foi |esta )?(?:feito|feita|concluido|concluida|realizado|realizada|finalizado|finalizada)\\b`).test(clause)) {
      stage = 'completed';
    } else if (new RegExp(`\\b(?:iniciei|iniciamos|comecei|comecamos|estou fazendo|estamos fazendo|estou executando|estamos executando) (?:o |a |um )?${target}\\b|\\b${target} (?:ja )?(?:esta )?em andamento\\b`).test(clause)) {
      stage = 'in_progress';
    } else if (new RegExp(`\\b(?:preciso|precisamos|e preciso|vamos|vou|iremos|decidi|decidimos|planejamos) .{0,65}${target}\\b`).test(clause)) {
      stage = 'planned';
    }
  }
  return stage ? { stage, reportedAt: at, ...(change ? { changeId: `GMUD-${change[1]}` } : {}) } : undefined;
}

export function mergeRollback(previous: RollbackUpdate | undefined, current: RollbackUpdate | undefined) {
  if (!previous || !current) return current ?? previous;
  if (Date.parse(current.reportedAt) < Date.parse(previous.reportedAt)) return previous;
  const sameChange = !previous.changeId || !current.changeId || previous.changeId === current.changeId;
  if (sameChange && previous.stage === 'completed' && current.stage !== 'completed') return previous;
  if (sameChange && previous.stage === 'in_progress' && current.stage === 'planned') return previous;
  return { ...current, changeId: current.changeId ?? previous.changeId };
}
