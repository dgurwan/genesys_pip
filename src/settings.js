// Lecture / observation des preferences dans chrome.storage.local
// (ecrites par popup.js) et resolution du theme clair/dark/systeme.

import { DEFAULT_SETTINGS } from './constants.js';

export async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(DEFAULT_SETTINGS, (items) => {
      resolve({
        participantDataPrefixes: items.participantDataPrefixes || '',
        participantDataHighlightRules: normalizeHighlightRules(items.participantDataHighlightRules),
        theme: items.theme || DEFAULT_SETTINGS.theme,
        language: items.language || DEFAULT_SETTINGS.language
      });
    });
  });
}

export function watchSettings(callback) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    const patch = {};
    if (changes.participantDataPrefixes) patch.participantDataPrefixes = changes.participantDataPrefixes.newValue || '';
    if (changes.participantDataHighlightRules) patch.participantDataHighlightRules = normalizeHighlightRules(changes.participantDataHighlightRules.newValue);
    if (changes.theme) patch.theme = changes.theme.newValue || DEFAULT_SETTINGS.theme;
    if (changes.language) patch.language = changes.language.newValue || DEFAULT_SETTINGS.language;

    if (Object.keys(patch).length) callback(patch);
  });
}

export function resolveTheme(theme) {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  return theme === 'dark' ? 'dark' : 'light';
}

export function normalizeHighlightRules(rules) {
  const source = Array.isArray(rules) ? rules : [];
  return DEFAULT_SETTINGS.participantDataHighlightRules.map((defaultRule, index) => {
    const rule = source[index] && typeof source[index] === 'object' ? source[index] : {};
    const color = /^#[0-9a-fA-F]{6}$/.test(String(rule.color || '')) ? String(rule.color) : defaultRule.color;
    return {
      participantDataName: String(rule.participantDataName || '').trim(),
      value: String(rule.value || ''),
      color,
      highlightActionEnabled: rule.highlightActionEnabled !== false,
      enabled: Boolean(rule.enabled),
      badgeEnabled: Boolean(rule.badgeEnabled ?? rule.badge),
      badge: String(rule.badge || "").trim(),
      displayEnabled: Boolean(rule.displayEnabled ?? rule.displayField),
      displayField: String(rule.displayField || "").trim(),
      displayLabel: String(rule.displayLabel || "").trim(),
      allowCopy: Boolean(rule.allowCopy),
      actionEnabled: Boolean(rule.actionEnabled ?? rule.actionUrl),
      actionLabel: String(rule.actionLabel || "").trim(),
      actionUrl: String(rule.actionUrl || "").trim(),
      actionMode: rule.actionMode === "attached" ? "attached" : "quick"
    };
  });
}
