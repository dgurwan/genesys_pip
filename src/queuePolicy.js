/**
 * Queue policy is the source of truth for wrap-up behavior.
 * We load it as soon as the queueId is known so the hang-up decision can be
 * made from queue configuration instead of the live interaction state.
 */
export function markQueuePolicyLoading(queuePolicyState, queueId) {
  if (!queuePolicyState || !queueId) return;

  queuePolicyState.loadingQueueIds.add(queueId);
  queuePolicyState.activeQueueId = queueId;
  queuePolicyState.error = null;
}

export function markQueuePolicyError(queuePolicyState, queueId, message) {
  if (!queuePolicyState || !queueId) return;

  queuePolicyState.loadingQueueIds.delete(queueId);
  queuePolicyState.activeQueueId = queueId;
  queuePolicyState.error = message || 'Impossible de charger la configuration de la queue.';
}

export function storeQueuePolicy(queuePolicyState, payload) {
  if (!queuePolicyState || !payload) return null;

  const policy = normalizeQueuePolicy(payload);
  if (!policy.queueId) return null;

  queuePolicyState.byQueueId.set(policy.queueId, policy);
  queuePolicyState.loadingQueueIds.delete(policy.queueId);
  queuePolicyState.activeQueueId = policy.queueId;
  queuePolicyState.error = null;

  return policy;
}

export function getQueuePolicy(queuePolicyState, queueId) {
  if (!queuePolicyState || !queueId) return null;
  return queuePolicyState.byQueueId.get(queueId) || null;
}

export function getQueueWrapupCodes(queuePolicyState, queueId) {
  return getQueuePolicy(queuePolicyState, queueId)?.wrapupCodes || [];
}

export function shouldRequireWrapupForInteraction(queuePolicyState, interaction) {
  if (!interaction) return false;

  const queueId = interaction.queueId || null;
  const policy = queueId ? getQueuePolicy(queuePolicyState, queueId) : null;

  if (policy) return Boolean(policy.requiresWrapup);
  return Boolean(interaction.wrapupRequired);
}

function normalizeQueuePolicy(payload) {
  const queue = payload.queue || null;
  const rawWrapupCodes = Array.isArray(payload.wrapupCodes) ? payload.wrapupCodes : [];
  const wrapupCodes = rawWrapupCodes
    .map(normalizeWrapupCode)
    .filter(Boolean)
    .sort((a, b) => a.label.localeCompare(b.label));

  const queueId = payload.queueId || queue?.id || null;
  const requiresWrapup = typeof payload.requiresWrapup === 'boolean'
    ? payload.requiresWrapup
    : inferWrapupRequired(queue, wrapupCodes);

  return {
    queueId,
    queue: queue ? {
      id: queue.id || queueId,
      name: queue.name || queue.label || '',
      wrapupRequired: queue.wrapupRequired,
      wrapupPrompt: queue.wrapupPrompt,
      wrapupTimeoutMs: queue.wrapupTimeoutMs,
      queueMediaSettings: queue.queueMediaSettings || null,
      raw: queue
    } : null,
    requiresWrapup,
    wrapupCodes,
    loadedAt: payload.loadedAt || new Date().toISOString()
  };
}

function inferWrapupRequired(queue, wrapupCodes) {
  if (!queue || typeof queue !== 'object') {
    return wrapupCodes.length > 0;
  }

  const queueFlags = [
    queue.wrapupRequired,
    queue.wrapUpRequired,
    queue.queueMediaSettings?.wrapupRequired,
    queue.queueMediaSettings?.wrapUpRequired,
    queue.mediaSettings?.wrapupRequired,
    queue.mediaSettings?.wrapUpRequired
  ];

  if (queueFlags.some((flag) => flag === true)) return true;
  return wrapupCodes.length > 0;
}

function normalizeWrapupCode(code) {
  if (!code || typeof code !== 'object') return null;

  return {
    id: code.id || code.wrapupCodeId || code.code || null,
    label: code.name || code.label || code.description || code.id || 'Wrap-up',
    code: code.code || code.id || code.wrapupCodeId || null,
    raw: code
  };
}
