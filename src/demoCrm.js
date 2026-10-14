// Local-only demo CRM used by app.html.
// Keep this module independent from Genesys so the host page remains a safe demo surface.

const customers = [
  {
    id: 'CUST-10042',
    name: 'John Smith',
    initials: 'JS',
    tier: 'Gold',
    since: '2019',
    language: 'English',
    phone: '+33 6 12 34 56 78',
    email: 'john.smith@example.com',
    preferredChannel: 'Voice',
    cases: [
      { id: 'CASE-8472', title: 'Duplicate invoice', category: 'Billing', status: 'Open', priority: 'High', updated: 'Today, 14:32' }
    ],
    activities: [
      { type: 'Call', title: 'Inbound call', detail: 'Billing queue · 6 min', when: 'Today, 14:32' },
      { type: 'Email', title: 'Invoice sent', detail: 'Invoice #INV-2026-0918', when: 'Sep 18' },
      { type: 'Case', title: 'Case created', detail: 'CASE-8472 · Duplicate invoice', when: 'Sep 18' }
    ]
  },
  {
    id: 'CUST-10057',
    name: 'Marie Dupont',
    initials: 'MD',
    tier: 'Standard',
    since: '2022',
    language: 'French',
    phone: '+33 6 44 28 19 05',
    email: 'marie.dupont@example.com',
    preferredChannel: 'Messaging',
    cases: [
      { id: 'CASE-9124', title: 'Contract modification', category: 'Contract', status: 'Open', priority: 'Normal', updated: 'Yesterday, 16:10' },
      { id: 'CASE-8991', title: 'Address update', category: 'Account', status: 'Pending', priority: 'Normal', updated: 'Sep 20, 09:45' }
    ],
    activities: [
      { type: 'Message', title: 'Web messaging', detail: 'Contract information request', when: 'Yesterday' },
      { type: 'Case', title: 'Case updated', detail: 'CASE-9124 · Documents received', when: 'Sep 22' },
      { type: 'Call', title: 'Outbound call', detail: 'Customer follow-up · 4 min', when: 'Sep 20' }
    ]
  },
  {
    id: 'CUST-10083',
    name: 'Robert Martin',
    initials: 'RM',
    tier: 'Platinum',
    since: '2016',
    language: 'French',
    phone: '+33 7 51 80 22 14',
    email: 'robert.martin@example.com',
    preferredChannel: 'Voice',
    cases: [
      { id: 'CASE-9308', title: 'Urgent assistance request', category: 'Assistance', status: 'Open', priority: 'Critical', updated: 'Today, 17:04' }
    ],
    activities: [
      { type: 'Call', title: 'Inbound call', detail: 'Priority assistance queue · 3 min', when: 'Today, 17:04' },
      { type: 'Message', title: 'SMS notification', detail: 'Case confirmation sent', when: 'Today, 17:01' },
      { type: 'Case', title: 'Priority case created', detail: 'CASE-9308 · Urgent assistance', when: 'Today, 16:58' }
    ]
  }
];

const byId = (id) => document.getElementById(id);

const CRM_THEME_STORAGE_KEY = 'demoCrmTheme';
const CRM_THEMES = new Set(['light', 'genesys', 'dark', 'system']);
let systemThemeQuery = null;
let selectedCustomerId = null;

function resolveSystemTheme() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  const selectedTheme = CRM_THEMES.has(theme) ? theme : 'light';
  const resolvedTheme = selectedTheme === 'system' ? resolveSystemTheme() : selectedTheme;

  document.documentElement.dataset.crmTheme = resolvedTheme;
  document.documentElement.dataset.crmThemePreference = selectedTheme;

  const select = byId('crmThemeSelect');
  if (select) select.value = selectedTheme;
}

export function setTheme(theme) {
  const selectedTheme = CRM_THEMES.has(theme) ? theme : 'light';
  localStorage.setItem(CRM_THEME_STORAGE_KEY, selectedTheme);
  applyTheme(selectedTheme);
}

function initTheme() {
  const savedTheme = localStorage.getItem(CRM_THEME_STORAGE_KEY) || 'light';
  applyTheme(savedTheme);

  const select = byId('crmThemeSelect');
  select?.addEventListener('change', () => setTheme(select.value));

  systemThemeQuery = window.matchMedia?.('(prefers-color-scheme: dark)') || null;
  systemThemeQuery?.addEventListener?.('change', () => {
    if ((localStorage.getItem(CRM_THEME_STORAGE_KEY) || 'light') === 'system') {
      applyTheme('system');
    }
  });
}

function renderCases(customer) {
  const target = byId('crmCases');
  if (!target) return;
  byId('crmCaseCount').textContent = String(customer.cases.length);
  target.innerHTML = customer.cases.map((item) => `
    <button class="crm-case" type="button" data-case-id="${item.id}">
      <div class="crm-case-top"><strong>${item.id}</strong><span class="crm-status crm-status-${item.status.toLowerCase()}">${item.status}</span></div>
      <h3>${item.title}</h3>
      <div class="crm-case-meta"><span>${item.category}</span><span>${item.priority} priority</span><span>${item.updated}</span></div>
    </button>
  `).join('');
}

function renderActivities(customer) {
  const target = byId('crmActivities');
  if (!target) return;
  target.innerHTML = customer.activities.map((item) => `
    <div class="crm-activity">
      <span class="crm-activity-icon">${item.type.slice(0, 1)}</span>
      <div><strong>${item.title}</strong><span>${item.detail}</span></div>
      <time>${item.when}</time>
    </div>
  `).join('');
}

export function selectCustomer(customerId, options = {}) {
  const customer = customers.find((item) => item.id === customerId) || customers[0];
  if (!customer) return;
  selectedCustomerId = customer.id;

  byId('crmCustomerName').textContent = customer.name;
  byId('crmCustomerNameCard').textContent = customer.name;
  byId('crmCustomerAvatar').textContent = customer.initials;
  byId('crmCustomerTier').textContent = customer.tier;
  byId('crmCustomerSubtitle').textContent = `Customer since ${customer.since} · ${customer.language}`;
  byId('crmCustomerId').textContent = customer.id;
  byId('crmCustomerPhone').textContent = customer.phone;
  byId('crmCustomerEmail').textContent = customer.email;
  byId('crmPreferredChannel').textContent = customer.preferredChannel;

  const select = byId('crmCustomerSelect');
  if (select) select.value = customer.id;

  renderCases(customer);
  renderActivities(customer);

  if (options.caseId) {
    requestAnimationFrame(() => focusCase(options.caseId));
  }
}

function normalizeDataKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findParticipantValue(rows, aliases) {
  const wanted = new Set(aliases.map(normalizeDataKey));
  const row = (Array.isArray(rows) ? rows : []).find((item) => {
    const rawKey = String(item?.rawKey || item?.key || '').replace(/\s*\([^)]*\)\s*$/, '');
    const leafKey = rawKey.split('.').pop();
    return wanted.has(normalizeDataKey(rawKey)) || wanted.has(normalizeDataKey(leafKey));
  });
  return row ? String(row.value || '').trim() : '';
}


export function getDemoCrmContext(rows) {
  const customerId = findParticipantValue(rows, ['CustomerId', 'CustomerID', 'customer.id', 'crm.customerId']);
  const caseId = findParticipantValue(rows, ['CaseId', 'CaseID', 'case.id', 'crm.caseId']);

  let customer = customerId ? customers.find((item) => item.id === customerId) : null;
  if (!customer && caseId) customer = customers.find((item) => item.cases.some((caseItem) => caseItem.id === caseId));
  if (!customer) return null;

  const resolvedCase = caseId ? customer.cases.find((caseItem) => caseItem.id === caseId) : null;
  return { customerId: customer.id, customerName: customer.name, caseId: resolvedCase?.id || '' };
}

export function openDemoCrmCustomer(customerId) {
  const customer = customers.find((item) => item.id === customerId);
  if (!customer) return false;
  selectCustomer(customer.id);
  byId('crmCustomerName')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return true;
}

export function openDemoCrmCase(customerId, caseId) {
  const customer = customers.find((item) => item.id === customerId)
    || customers.find((item) => item.cases.some((caseItem) => caseItem.id === caseId));
  if (!customer || !customer.cases.some((caseItem) => caseItem.id === caseId)) return false;
  selectCustomer(customer.id, { caseId });
  return true;
}

function focusCase(caseId) {
  if (!caseId) return;
  document.querySelectorAll('.crm-case.is-screen-pop').forEach((node) => node.classList.remove('is-screen-pop'));
  const target = [...document.querySelectorAll('.crm-case')].find((node) => node.dataset.caseId === caseId);
  if (!target) return;
  target.classList.add('is-screen-pop');
  target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/**
 * Demo screen pop driven by Genesys participant data.
 * Supported keys are deliberately tolerant so a demo flow can use CustomerId,
 * customer.id, crm.customerId, CaseId, case.id, etc.
 */
export function screenPopFromParticipantData(rows) {
  const context = getDemoCrmContext(rows);
  if (!context) return false;

  if (selectedCustomerId !== context.customerId || context.caseId) {
    selectCustomer(context.customerId, { caseId: context.caseId });
  }
  return true;
}

export function initDemoCrm() {
  initTheme();

  const select = byId('crmCustomerSelect');
  if (!select) return;

  select.innerHTML = customers.map((customer) =>
    `<option value="${customer.id}">${customer.name} · ${customer.id}</option>`
  ).join('');
  select.addEventListener('change', () => selectCustomer(select.value));

  selectCustomer(customers[0].id);
}
