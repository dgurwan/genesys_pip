// Tout ce qui concerne le statut agent: couleur de la pastille, libelle
// affiche, normalisation des payloads Genesys et synchronisation On/Off Queue.
//
// Genesys melange deux notions qu'il faut distinguer:
//   - la presence (Available, Break, Meal...) choisie par l'agent
//   - le routing status (IDLE, INTERACTING, NOT_RESPONDING...) impose par la file
// ROUTING_KEYS sert a ignorer les seconds quand on cherche le premier.

import { normalizeKey, titleCase } from './utils.js';

const ROUTING_KEYS = new Set(['associated', 'idle', 'interacting', 'notresponding', 'communicating', 'offqueue']);

// Accepte plusieurs candidats (systemPresence, label, id) pour eviter un point
// gris quand un seul des champs est renseigne par Genesys.
export function getPresenceDotClass(...candidates) {
  const key = normalizeKey(candidates.filter(Boolean).join(' '));
  if (key.includes('onqueue')) return 'onqueue';
  if (key.includes('offqueue')) return 'offqueue';
  if (key.includes('available')) return 'available';
  if (key.includes('away')) return 'away';
  if (key.includes('break')) return 'break';
  if (key.includes('busy')) return 'busy';
  if (key.includes('meal')) return 'meal';
  if (key.includes('training')) return 'training';
  if (key.includes('offline')) return 'offline';
  return 'default';
}

// Genesys renvoie parfois le token systeme brut (ON_QUEUE, ON_BREAK) comme
// libelle. On l'affiche en Title Case plutot que tel quel.
export function formatPresenceLabel(label) {
  const value = String(label ?? '').trim();
  if (!value) return '';
  return /^[A-Z0-9][A-Z0-9_\s-]*$/.test(value) && /[_]|^[A-Z0-9]+$/.test(value) ? titleCase(value.replace(/[-\s]+/g, '_')) : value;
}

function normalizePresencePayload(value) {
  if (!value) return null;

  if (typeof value === 'string') {
    if (isIgnoredRoutingStatus(value)) return null;
    return { label: value, id: null, systemPresence: value, raw: value };
  }

  if (typeof value !== 'object') return null;

  const presenceDefinition = value.presenceDefinition || value.organizationPresence || null;
  const label = value.name || value.label || value.systemPresence || presenceDefinition?.name || presenceDefinition?.systemPresence || value.id;
  const systemPresence = value.systemPresence || presenceDefinition?.systemPresence || value.name || null;

  if (isIgnoredRoutingStatus(label) && !value.systemPresence && !presenceDefinition) {
    return null;
  }

  return {
    label: label || 'Inconnu',
    id: value.id || presenceDefinition?.id || null,
    systemPresence,
    raw: value
  };
}

export function extractAgentPresence(message) {
  const data = message.data?.data || message.data || {};

  if (message.type === 'genesys:user:presence') {
    return normalizePresencePayload(data.presence || data);
  }

  const candidates = [
    data.presence,
    data.userPresence,
    data.organizationPresence,
    data.primaryPresence,
    data.data?.presence,
    data.data?.userPresence
  ];

  for (const candidate of candidates) {
    const normalized = normalizePresencePayload(candidate);
    if (normalized) return normalized;
  }

  return null;
}

function isIgnoredRoutingStatus(value) {
  const key = normalizeKey(value);
  return ROUTING_KEYS.has(key) || key === 'routingstatus';
}

export function isQueuePresence(status) {
  const key = normalizeKey([status?.id, status?.systemPresence, status?.label].join(' '));
  return key.includes('onqueue') || key.includes('offqueue');
}

export function enrichPresence(status, grouped, queue) {
  if (!status) return status;

  const byId = findPresenceById(status.id, grouped, queue);
  if (byId) return { ...status, ...byId };

  const bySystem = grouped.find((item) => normalizeKey(item.systemPresence) === normalizeKey(status.systemPresence || status.label));
  if (bySystem) {
    return {
      ...status,
      label: status.label || bySystem.label,
      id: status.id || bySystem.id,
      systemPresence: bySystem.systemPresence
    };
  }

  return status;
}

export function findPresenceById(id, grouped, queue) {
  if (!id) return null;
  if (queue?.onQueue?.id === id) return queue.onQueue;
  if (queue?.offQueue?.id === id) return queue.offQueue;

  for (const primary of grouped || []) {
    if (primary.id === id) return primary;
    for (const secondary of primary.children || []) {
      if (secondary.id === id) return secondary;
    }
  }

  return null;
}

export function getSelectedPresenceForPrimary(primary, currentStatus) {
  if (!primary || !currentStatus) return null;

  const currentId = currentStatus.id || null;
  const selectedChild = (primary.children || []).find((secondary) => secondary.id === currentId);
  if (selectedChild) return selectedChild;
  if (primary.id === currentId) return primary;

  if (normalizeKey(currentStatus.systemPresence) === normalizeKey(primary.systemPresence)) {
    return primary;
  }

  return null;
}

export function syncSelectedPrimary(state) {
  const grouped = state.presence.grouped;
  if (!grouped.length) return;

  const current = state.agentStatus;
  const fromSystem = grouped.find((item) => normalizeKey(item.systemPresence) === normalizeKey(current.systemPresence));
  if (fromSystem) {
    state.presence.selectedPrimary = fromSystem.systemPresence;
    if (!state.presence.expandedPrimary) state.presence.expandedPrimary = fromSystem.systemPresence;
    return;
  }

  const fromId = findPresenceById(current.id, grouped, state.presence.queue);
  if (fromId && !isQueuePresence(fromId)) {
    state.presence.selectedPrimary = fromId.systemPresence;
    if (!state.presence.expandedPrimary) state.presence.expandedPrimary = fromId.systemPresence;
    return;
  }

  if (!state.presence.selectedPrimary) {
    state.presence.selectedPrimary = grouped[0].systemPresence;
    state.presence.expandedPrimary = grouped[0].systemPresence;
  }
}

export function syncQueueState(state) {
  const status = state.agentStatus;
  const queue = state.presence.queue;
  const key = normalizeKey(status.systemPresence || status.label);

  if (status.id && queue?.onQueue?.id === status.id) {
    state.presence.queueState = 'on';
    return;
  }

  if (key.includes('onqueue')) {
    state.presence.queueState = 'on';
    return;
  }

  state.presence.queueState = 'off';

  const currentPresence = findPresenceById(status.id, state.presence.grouped, queue);
  if (currentPresence && !isQueuePresence(currentPresence)) {
    state.presence.lastOffQueue = currentPresence;
  }
}

export function findDefaultOffQueuePresence(grouped) {
  const order = ['available', 'busy', 'away', 'break', 'meal', 'training'];

  for (const wanted of order) {
    const match = grouped.find((item) => normalizeKey(item.systemPresence) === wanted || normalizeKey(item.label) === wanted);
    if (match) return match;
  }

  return grouped[0] || null;
}

export function getDisplayAgentStatus(state) {
  const status = state.agentStatus;
  if (!status?.label) return { label: 'Inconnu', systemPresence: null };

  if (isIgnoredRoutingStatus(status.label) || isIgnoredRoutingStatus(status.systemPresence)) {
    const fallback = state.presence.lastOffQueue || findDefaultOffQueuePresence(state.presence.grouped);
    return fallback || { label: 'Inconnu', systemPresence: null };
  }

  return status;
}
