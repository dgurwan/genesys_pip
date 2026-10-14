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
  highlightActionEnabled: document.getElementById(`contextHighlightEnabled${index}`),
  hex: document.getElementById(`highlightColorHex${index}`),
  badgeEnabled: document.getElementById(`contextBadgeEnabled${index}`),
  badge: document.getElementById(`contextBadge${index}`),
  displayEnabled: document.getElementById(`contextDisplayEnabled${index}`),
  displayField: document.getElementById(`contextDisplayField${index}`),
  displayLabel: document.getElementById(`contextDisplayLabel${index}`),
  allowCopy: document.getElementById(`contextAllowCopy${index}`),
  actionEnabled: document.getElementById(`contextActionEnabled${index}`),
  actionFields: document.getElementById(`contextActionFields${index}`),
  actionLabel: document.getElementById(`contextActionLabel${index}`),
  actionUrl: document.getElementById(`contextActionUrl${index}`),
  actionModes: [...document.querySelectorAll(`input[name=\"contextActionMode${index}\"]`)],
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
  const invalidControl = highlightControls.find((control) => !validateActionUrl(control));
  if (invalidControl) { invalidControl.actionUrl.reportValidity(); invalidControl.actionUrl.focus(); return; }
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
    control.highlightActionEnabled.checked = rule?.highlightActionEnabled !== false;
    control.hex.textContent = control.color.value.toUpperCase();
    control.badgeEnabled.checked = Boolean(rule?.badgeEnabled ?? rule?.badge);
    control.badge.value = String(rule?.badge || '');
    control.displayEnabled.checked = Boolean(rule?.displayEnabled ?? rule?.displayField);
    control.displayField.value = String(rule?.displayField || '');
    control.displayLabel.value = String(rule?.displayLabel || '');
    control.allowCopy.checked = Boolean(rule?.allowCopy);
    control.actionLabel.value = String(rule?.actionLabel || '');
    control.actionUrl.value = String(rule?.actionUrl || '');
    control.actionEnabled.checked = Boolean(rule?.actionEnabled ?? rule?.actionUrl);
    const actionMode = rule?.actionMode === 'attached' ? 'attached' : 'quick';
    control.actionModes.forEach((radio) => { radio.checked = radio.value === actionMode; });
    syncActionFields(control);
    syncRuleActionAvailability(control);
    setHighlightRuleExpanded(control, control.enabled.checked);
    updateRulePresentation(control);
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

function updateRulePresentation(control) {
  const index = control.rule?.dataset.highlightRule || '';
  const condition = control.rule?.querySelector(`[data-rule-condition-summary="${index}"]`);
  const actions = control.rule?.querySelector(`[data-rule-action-summary="${index}"]`);
  const preview = control.rule?.querySelector(`[data-rule-preview-card="${index}"]`);
  const name = control.name.value.trim();
  const value = control.value.value.trim();
  if (condition) condition.textContent = name ? `${name} = ${value || '…'}` : t('rules.notConfigured');

  const labels = [];
  if (control.highlightActionEnabled.checked) labels.push(t('rules.summaryHighlight'));
  if (control.badgeEnabled.checked && control.badge.value.trim()) labels.push(t('rules.summaryBadge'));
  if (control.displayEnabled.checked && control.displayField.value.trim()) labels.push(t('rules.summaryData'));
  if (control.actionEnabled.checked) labels.push(t('rules.summaryLink'));
  if (actions) actions.innerHTML = labels.map((label) => `<span>${label}</span>`).join('');

  if (preview) {
    const badge = control.badgeEnabled.checked ? control.badge.value.trim() : '';
    const field = control.displayEnabled.checked ? control.displayField.value.trim() : '';
    const fieldLabel = control.displayLabel.value.trim() || field || t('rules.summaryData');
    const sampleValue = field ? `{{${field}}}` : '';
    const actionMode = control.actionModes.find((radio) => radio.checked)?.value || 'quick';
    const hasAttachedLink = control.actionEnabled.checked && actionMode === 'attached' && field;
    const hasQuickLink = control.actionEnabled.checked && actionMode === 'quick';
    const hasCopy = control.allowCopy.checked && field;
    const parts = [];
    if (badge) parts.push(`<div class="preview-badges"><span>${escapePreview(badge)}</span></div>`);
    if (field) parts.push(`<div class="preview-field"><span>${escapePreview(fieldLabel)}</span><strong>${escapePreview(sampleValue)}</strong>${hasCopy ? '<b>⧉</b>' : ''}${hasAttachedLink ? '<b>↗</b>' : ''}</div>`);
    preview.style.background = control.highlightActionEnabled.checked ? control.color.value : '';
    preview.classList.toggle('has-highlight', control.highlightActionEnabled.checked);
    if (hasQuickLink) parts.push(`<div class="preview-quick-action">↗ ${escapePreview(control.actionLabel.value.trim() || t('rules.open'))}</div>`);
    preview.innerHTML = parts.length ? parts.join('') : `<span class="rule-preview-empty">${escapePreview(t('rules.previewEmpty'))}</span>`;
  }
}

function escapePreview(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function setHighlightRuleExpanded(control, expanded) {
  control.body.hidden = !expanded;
  control.toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  control.rule.classList.toggle('is-expanded', expanded);
  control.chevron.classList.toggle('open', expanded);
}

function syncRuleActionAvailability(control) {
  const badgeOn = Boolean(control.badgeEnabled?.checked);
  const dataOn = Boolean(control.displayEnabled?.checked);
  if (control.badge) control.badge.disabled = !badgeOn;
  [control.displayField, control.displayLabel, control.allowCopy].forEach((el) => { if (el) el.disabled = !dataOn; });
  const attached = control.actionModes?.find((radio) => radio.value === 'attached');
  if (attached) {
    attached.disabled = !dataOn;
    const label = attached.closest('label');
    if (label) {
      label.classList.toggle('is-disabled', !dataOn);
      label.title = dataOn ? '' : t('rules.attachRequiresData');
    }
    if (!dataOn && attached.checked) {
      const quick = control.actionModes.find((radio) => radio.value === 'quick');
      if (quick) quick.checked = true;
    }
  }
}

function syncActionFields(control) {
  const enabled = Boolean(control.actionEnabled?.checked);
  if (control.actionFields) control.actionFields.hidden = !enabled;
}

highlightControls.forEach((control) => {
  const presentationInputs = [control.name, control.value, control.color, control.highlightActionEnabled, control.badgeEnabled, control.badge, control.displayEnabled, control.displayField, control.displayLabel, control.allowCopy, control.actionEnabled, control.actionLabel, control.actionUrl, ...control.actionModes];
  presentationInputs.forEach((input) => input?.addEventListener('input', () => updateRulePresentation(control)));
  presentationInputs.forEach((input) => input?.addEventListener('change', () => updateRulePresentation(control)));
  control.actionEnabled?.addEventListener('change', () => { syncActionFields(control); validateActionUrl(control); updateRulePresentation(control); });
  control.badgeEnabled?.addEventListener('change', () => { syncRuleActionAvailability(control); updateRulePresentation(control); });
  control.displayEnabled?.addEventListener('change', () => { syncRuleActionAvailability(control); updateRulePresentation(control); });
  control.actionUrl?.addEventListener('blur', () => {
    const normalized = normalizeHttpsUrl(control.actionUrl.value);
    if (normalized && /^https:\/\//i.test(normalized)) control.actionUrl.value = normalized;
    validateActionUrl(control);
  });
  control.enabled.addEventListener('change', () => {
    setHighlightRuleExpanded(control, control.enabled.checked);
    updateRulePresentation(control);
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

function normalizeHttpsUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (/^https:\/\//i.test(trimmed)) return trimmed;
  if (/^(www\.|[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/:?#]|$))/i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function validateActionUrl(control) {
  if (!control.actionEnabled?.checked) return true;
  const value = normalizeHttpsUrl(control.actionUrl.value);
  const valid = !value || /^https:\/\//i.test(value);
  control.actionUrl.classList.toggle('input-error', !valid);
  control.actionUrl.setCustomValidity(valid ? '' : (languageSelect.value === 'fr' ? 'Utilisez une URL HTTPS.' : 'Use an HTTPS URL.'));
  return valid;
}

function collectHighlightRules() {
  return getHighlightRulesInDomOrder().map((control) => ({
    participantDataName: control.name.value.trim(),
    value: control.value.value,
    color: control.color.value.toUpperCase(),
    highlightActionEnabled: control.highlightActionEnabled.checked,
    enabled: control.enabled.checked,
    badgeEnabled: control.badgeEnabled.checked,
    badge: control.badge.value.trim(),
    displayEnabled: control.displayEnabled.checked,
    displayField: control.displayField.value.trim(),
    displayLabel: control.displayLabel.value.trim(),
    allowCopy: control.allowCopy.checked,
    actionEnabled: control.actionEnabled.checked,
    actionLabel: control.actionLabel.value.trim(),
    actionUrl: control.actionEnabled.checked ? normalizeHttpsUrl(control.actionUrl.value) : '',
    actionMode: control.actionModes.find((radio) => radio.checked)?.value || 'quick'
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
