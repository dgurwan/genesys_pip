// Extraction des participant data du leg client d'un appel, puis filtrage
// selon les prefixes saisis dans le popup (ex: "crm.|customer_").

import { isObject, normalizeFilter } from './utils.js';

export function extractCustomerParticipantData({ interaction, payload, conversation }) {
  const rows = [];
  const seen = new Set();

  const addValue = (key, value, source) => {
    if (!key || value === undefined || value === null || value === '') return;

    let normalizedValue;
    if (typeof value === 'object') {
      try { normalizedValue = JSON.stringify(value); } catch { normalizedValue = String(value); }
    } else {
      normalizedValue = String(value);
    }

    if (!normalizedValue) return;
    const uniqueKey = `${key}::${normalizedValue}::${source || ''}`;
    if (seen.has(uniqueKey)) return;
    seen.add(uniqueKey);

    rows.push({
      key: source ? `${key} (${source})` : key,
      rawKey: key,
      value: normalizedValue,
      source: source || ''
    });
  };

  const addObject = (obj, source) => {
    if (!isObject(obj)) return;
    Object.keys(obj).sort((a, b) => a.localeCompare(b)).forEach((key) => addValue(key, obj[key], source));
  };

  // Les attributs portes par l'interaction du framework sont deja destines a
  // l'agent: on peut les afficher tels quels.
  addObject(interaction?.attributes, 'interaction');
  addObject(interaction?.participantData, 'interaction');
  addObject(interaction?.attachedData, 'interaction');
  addObject(payload?.attributes, 'payload');
  addObject(payload?.participantData, 'payload');
  addObject(payload?.attachedData, 'payload');

  // Une notification de conversation contient tous les legs: on ne garde que
  // celui du client (purpose customer/external).
  const customer = findCustomerParticipant(conversation || interaction?.conversation || payload?.conversation);
  if (customer) {
    addObject(customer.attributes, 'customer');
    addObject(customer.participantData, 'customer');
    addObject(customer.attachedData, 'customer');
  }

  collectSearchStringData(payload?.searchString, addValue);
  return rows.sort((a, b) => a.key.localeCompare(b.key));
}

export function findCustomerParticipant(conversation) {
  const participants = Array.isArray(conversation?.participants) ? conversation.participants : [];
  return participants.find((participant) => {
    const purpose = String(participant.purpose || '').toLowerCase();
    return purpose === 'customer' || purpose === 'external';
  }) || null;
}

export function filterParticipantData(rows, prefixString) {
  const prefixes = String(prefixString || '')
    .split('|')
    .map((item) => normalizeFilter(item))
    .filter(Boolean);

  if (!prefixes.length) return rows;

  return rows.filter((row) => {
    const rawKey = String(row.rawKey || row.key || '').replace(/\s*\([^)]*\)\s*$/, '');
    const displayKey = String(row.key || '');
    const leafKey = rawKey.split('.').pop() || rawKey;

    const normalizedCandidates = [rawKey, displayKey, leafKey].map((value) => normalizeFilter(value));
    return prefixes.some((prefix) => normalizedCandidates.some((candidate) => candidate.startsWith(prefix)));
  });
}

function collectSearchStringData(searchString, addValue) {
  if (!searchString || typeof searchString !== 'string') return;

  addValue('screenPop.searchString', searchString, 'screenPop');

  try {
    const parsed = JSON.parse(searchString);
    if (isObject(parsed)) {
      Object.entries(flattenObject(parsed)).forEach(([key, value]) => addValue(`screenPop.json.${key}`, value, 'screenPop'));
    }
  } catch {
    // La valeur du screen pop n'est pas du JSON.
  }

  if (searchString.includes('=') && searchString.includes('&')) {
    try {
      const params = new URLSearchParams(searchString);
      params.forEach((value, key) => addValue(`screenPop.params.${key}`, value, 'screenPop'));
    } catch {
      // Query string invalide: on ignore.
    }
  }
}

function flattenObject(value, prefix = '', target = {}) {
  if (!isObject(value)) return target;

  Object.entries(value).forEach(([key, itemValue]) => {
    if (itemValue === null || itemValue === undefined) return;
    const nextKey = prefix ? `${prefix}.${key}` : key;

    if (isObject(itemValue)) {
      flattenObject(itemValue, nextKey, target);
      return;
    }

    target[nextKey] = Array.isArray(itemValue) ? JSON.stringify(itemValue) : String(itemValue);
  });

  return target;
}

/**
 * Evaluate highlighting rules against the complete raw participant-data set.
 * This intentionally does NOT use the display prefix filter: highlighting is
 * an independent configuration channel. First matching enabled rule wins.
 */
export function findParticipantDataHighlightColor(rows, rules) {
  if (!Array.isArray(rows) || !Array.isArray(rules)) return '';

  for (const rule of rules) {
    if (!rule?.enabled) continue;
    const participantDataName = String(rule.participantDataName || '').trim();
    if (!participantDataName) continue;

    const expectedValue = String(rule.value ?? '');
    const color = String(rule.color || '');
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) continue;

    const matched = rows.some((row) =>
      String(row?.rawKey || '') === participantDataName &&
      String(row?.value ?? '') === expectedValue
    );

    if (matched) return color;
  }

  return '';
}
