export const ECONOMIC_REFRESH_MS = 10 * 60 * 1000;
export const ECONOMIC_FULL_REFRESH_MS = 24 * 60 * 60 * 1000;

export function billedQueryReads(returnedDocuments) {
  return Math.max(1, Number(returnedDocuments || 0));
}

export function shouldRunFullRefresh(lastCompletedAt, now = Date.now()) {
  const previous = Number(lastCompletedAt || 0);
  return previous <= 0 || now - previous >= ECONOMIC_FULL_REFRESH_MS;
}

export function estimateEconomicReads({
  users,
  hours,
  baseDocuments,
  progressDocuments,
  changedProgressDocumentsPerCycle,
  changedBucketDocumentsPerCycle = 0,
  refreshMs = ECONOMIC_REFRESH_MS,
}) {
  const people = Math.max(0, Number(users || 0));
  const cycles = Math.ceil((Math.max(0, Number(hours || 0)) * 60 * 60 * 1000) / refreshMs);
  const initialPerUser = 1 + Math.max(0, Number(baseDocuments || 0))
    + Math.max(0, Number(progressDocuments || 0));
  const cyclePerUser = 1
    + billedQueryReads(changedProgressDocumentsPerCycle)
    + billedQueryReads(changedBucketDocumentsPerCycle);
  return {
    users: people,
    cycles,
    initialPerUser,
    cyclePerUser,
    totalReads: people * (initialPerUser + cycles * cyclePerUser),
  };
}
