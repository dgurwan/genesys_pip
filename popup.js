// Popup de la barre d'outils Chrome.
// Deux roles: ouvrir l'onglet client (app.html) et enregistrer les preferences
// dans chrome.storage.local. src/app.js ecoute ce storage et se met a jour.

import { DEFAULT_SETTINGS } from './src/constants.js';
import { setLanguage, t, translateDocument } from './src/i18n/index.js';

const openAppButton = document.getElementById('openApp');
const prefixesInput = document.getElementById('participantDataPrefixes');
const languageSelect = document.getElementById('languageSelect');
const highlightControls = [1, 2, 3].map((index) => ({
  enabled: document.getElementById(`highlightEnabled${index}`),
  name: document.getElementById(`highlightName${index}`),
  value: document.getElementById(`highlightValue${index}`),
  color: document.getElementById(`highlightColor${index}`),
  hex: document.getElementById(`highlightColorHex${index}`),
  toggle: document.querySelector(`[data-highlight-toggle=\"${index}\"]`),
  body: document.querySelector(`[data-highlight-body=\"${index}\"]`),
  rule: document.querySelector(`[data-highlight-rule=\"${index}\"]`),
  chevron: document.querySelector(`[data-highlight-rule=\"${index}\"] .highlight-rule-chevron`)
}));
const themeSelect = document.getElementById('themeSelect');
const saveConfigButton = document.getElementById('saveConfig');
const saveStatus = document.getElementById('saveStatus');
let draggedRule = null;

openAppButton.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
});

chrome.storage.local.get(DEFAULT_SETTINGS, (items) => {
  prefixesInput.value = items.participantDataPrefixes || '';
  applyHighlightRules(items.participantDataHighlightRules);
  themeSelect.value = items.theme || DEFAULT_SETTINGS.theme;
  languageSelect.value = items.language || DEFAULT_SETTINGS.language;
  applyLanguage();
});

// Le popup se traduit immediatement, sans attendre l'enregistrement.
languageSelect.addEventListener('change', applyLanguage);

saveConfigButton.addEventListener('click', () => {
  chrome.storage.local.set({
    participantDataPrefixes: prefixesInput.value.trim(),
    participantDataHighlightRules: collectHighlightRules(),
    theme: themeSelect.value || DEFAULT_SETTINGS.theme,
    language: languageSelect.value || DEFAULT_SETTINGS.language
  }, () => {
    saveStatus.textContent = t('popup.saved');
    setTimeout(() => {
      saveStatus.textContent = '';
    }, 1800);
  });
});

function applyLanguage() {
  setLanguage(languageSelect.value);
  translateDocument();
  prefixesInput.setAttribute('placeholder', t('popup.filterPlaceholder'));
}

function applyHighlightRules(rules) {
  const source = Array.isArray(rules) ? rules : DEFAULT_SETTINGS.participantDataHighlightRules;
  highlightControls.forEach((control, index) => {
    const rule = source[index] || DEFAULT_SETTINGS.participantDataHighlightRules[index];
    control.enabled.checked = Boolean(rule?.enabled);
    control.name.value = String(rule?.participantDataName || '');
    control.value.value = String(rule?.value || '');
    control.color.value = /^#[0-9a-fA-F]{6}$/.test(String(rule?.color || '')) ? rule.color : DEFAULT_SETTINGS.participantDataHighlightRules[index].color;
    control.hex.textContent = control.color.value.toUpperCase();
    setHighlightRuleExpanded(control, control.enabled.checked);
  });
}


function refreshRuleLabels() {
  [...document.querySelectorAll('.highlight-rule')].forEach((ruleElement, index) => {
    const label = ruleElement.querySelector('.highlight-rule-toggle strong');
    if (!label) return;
    label.dataset.i18n = `popup.highlight.rule${index + 1}`;
    label.textContent = t(`popup.highlight.rule${index + 1}`);
    ruleElement.dataset.priority = String(index + 1);
  });
}

function setHighlightRuleExpanded(control, expanded) {
  control.body.hidden = !expanded;
  control.toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  control.rule.classList.toggle('is-expanded', expanded);
  control.chevron.textContent = expanded ? '⌄' : '›';
}

highlightControls.forEach((control) => {
  control.enabled.addEventListener('change', () => {
    setHighlightRuleExpanded(control, control.enabled.checked);
  });

  control.toggle.addEventListener('click', () => {
    // A disabled rule is intentionally always collapsed. Enabling the rule
    // expands it so the configured values are immediately visible.
    if (!control.enabled.checked) {
      setHighlightRuleExpanded(control, false);
      return;
    }

    const expanded = control.body.hidden;
    setHighlightRuleExpanded(control, expanded);
  });
});

function getHighlightRulesInDomOrder() {
  const byId = new Map(highlightControls.map((control) => [control.rule.dataset.highlightRule, control]));
  return [...document.querySelectorAll('.highlight-rule')]
    .map((ruleElement) => byId.get(ruleElement.dataset.highlightRule))
    .filter(Boolean);
}

function collectHighlightRules() {
  return getHighlightRulesInDomOrder().map((control) => ({
    participantDataName: control.name.value.trim(),
    value: control.value.value,
    color: control.color.value.toUpperCase(),
    enabled: control.enabled.checked
  }));
}


function clearDropIndicators() {
  document.querySelectorAll('.highlight-rule').forEach((rule) => {
    rule.classList.remove('drop-before', 'drop-after', 'is-dragging');
  });
}

function initializeRulePriority() {
  const rules = [...document.querySelectorAll('.highlight-rule')];
  rules.forEach((ruleElement) => {
    const dragHandle = ruleElement.querySelector('.highlight-rule-drag-handle');
    if (!dragHandle) return;

    dragHandle.addEventListener('dragstart', (event) => {
      draggedRule = ruleElement;
      ruleElement.classList.add('is-dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', ruleElement.dataset.highlightRule || '');
      }
    });

    dragHandle.addEventListener('dragend', () => {
      clearDropIndicators();
      draggedRule = null;
    });

    dragHandle.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      const current = dragHandle.closest('.highlight-rule');
      const container = current?.parentElement;
      if (!current || !container) return;
      if (event.key === 'ArrowUp') {
        const previous = current.previousElementSibling;
        if (previous) container.insertBefore(current, previous);
      } else {
        const next = current.nextElementSibling;
        if (next) container.insertBefore(current, next.nextElementSibling);
      }
      refreshRuleLabels();
      dragHandle.focus();
    });

    ruleElement.addEventListener('dragover', (event) => {
      if (!draggedRule || draggedRule === ruleElement) return;
      event.preventDefault();
      const rect = ruleElement.getBoundingClientRect();
      const before = event.clientY < rect.top + rect.height / 2;
      clearDropIndicators();
      draggedRule.classList.add('is-dragging');
      ruleElement.classList.add(before ? 'drop-before' : 'drop-after');
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    });

    ruleElement.addEventListener('drop', (event) => {
      event.preventDefault();
      if (!draggedRule || draggedRule === ruleElement) return;
      const rect = ruleElement.getBoundingClientRect();
      const before = event.clientY < rect.top + rect.height / 2;
      const container = ruleElement.parentElement;
      if (before) container.insertBefore(draggedRule, ruleElement);
      else container.insertBefore(draggedRule, ruleElement.nextElementSibling);
      refreshRuleLabels();
      clearDropIndicators();
      draggedRule = null;
    });
  });
  refreshRuleLabels();
}

initializeRulePriority();

highlightControls.forEach((control) => {
  control.color.addEventListener('input', () => {
    control.hex.textContent = control.color.value.toUpperCase();
  });
});
