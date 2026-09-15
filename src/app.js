// Chef d'orchestre de l'extension (charge par app.html).
//
// Responsabilites:
//  1. lire les preferences et le theme (settings.js)
//  2. recevoir les messages postes par framework.js et mettre a jour `state`
//  3. rendre la fenetre PiP (pipView.js) et brancher les clics sur l'adapter
//
// Regle: le coeur de l'application ne connait pas l'implementation Genesys.
// Les commandes passent par l'adapter d'integration courant.

import { INTERACTION_ACTIONS, PIP_WINDOW_OPTIONS, TIMERS } from './constants.js';
import { parseWindowMessage } from './messageUtils.js';
import { createIntegrationAdapter } from './adapters/index.js';
import { createInitialState } from './state.js';
import { loadSettings, resolveTheme, watchSettings } from './settings.js';
import {
  enrichPresence,
  extractAgentPresence,
  findDefaultOffQueuePresence,
  findPresenceById,
  isQueuePresence,
  syncQueueState,
  syncSelectedPrimary
} from './presence.js';
import {
  ACTIVE_PHASES,
  extractEndedInteractionId,
  extractInteractionFromMessage,
  isWrapupPending,
  isWrapupRequiredValue,
  mergeInteraction
} from './interactions.js';
import { copyStylesToPip, renderPipHtml } from './pipView.js';
import { formatDuration, normalizeKey } from './utils.js';
import { setLanguage, t, translateDocument } from './i18n/index.js';

const softphone = document.getElementById('softphone');
const openPipButton = document.getElementById('openPip');
const pipSupport = document.getElementById('pipSupport');
const integrationKind = document.body.dataset.integrationAdapter || 'embeddable-framework';
const integrationAdapter = createIntegrationAdapter(integrationKind, softphone);
const state = createInitialState();
const ENDED_INTERACTION_TTL_MS = 60000;

bootstrap();

async function bootstrap() {
  state.settings = await loadSettings();
  setLanguage(state.settings.language);
  translateDocument();
  applyThemeToDocument();

  watchSettings((patch) => {
    state.settings = { ...state.settings, ...patch };
    setLanguage(state.settings.language);
    translateDocument();
    applyThemeToDocument();
    renderPip();
  });

  if (!('documentPictureInPicture' in window)) {
    pipSupport.textContent = t('app.pipUnsupported');
    openPipButton.disabled = true;
  }

  softphone.addEventListener('load', () => {
    state.frameworkReady = false;
    startFrameworkPing();
  });

  openPipButton.addEventListener('click', openPipWindow);
  window.addEventListener('message', handleGenesysMessage);

  // Le chrono met a jour le seul noeud concerne. Un renderPip() chaque seconde
  // reconstruirait tout le HTML et ferait perdre le focus dans le formulaire
  // wrap-up en cours de saisie.
  state.callTimerInterval = setInterval(updateCallTimer, 1000);
}

function updateCallTimer() {
  const element = state.pipWindow?.document?.getElementById('callTimer');
  if (!element || !state.interaction?.startTime) return;

  element.textContent = formatDuration(Date.now() - state.interaction.startTime);
}

async function openPipWindow() {
  state.pipWindow = await window.documentPictureInPicture.requestWindow(PIP_WINDOW_OPTIONS);
  copyStylesToPip(state.pipWindow);

  state.pipWindow.addEventListener('pagehide', () => {
    state.pipWindow = null;
  });

  if (state.frameworkReady) {
    integrationAdapter.requestPresenceDefinitions();
  } else {
    startFrameworkPing();
  }

  renderPip();
}

function startFrameworkPing() {
  if (state.frameworkReady) return;

  clearInterval(state.frameworkPingInterval);
  state.frameworkPingAttempts = 0;
  state.presence.error = null;

  state.frameworkPingInterval = setInterval(() => {
    if (state.frameworkReady) {
      clearInterval(state.frameworkPingInterval);
      state.frameworkPingInterval = null;
      return;
    }

    state.frameworkPingAttempts += 1;
    if (state.frameworkPingAttempts > TIMERS.frameworkMaxPings) {
      clearInterval(state.frameworkPingInterval);
      state.frameworkPingInterval = null;

      if (!state.presence.grouped.length) {
        state.presence.error = t('presence.frameworkSilent');
        renderPip();
      }
      return;
    }

    integrationAdapter.ping();
  }, TIMERS.frameworkPingIntervalMs);
}

function markFrameworkReady() {
  state.frameworkReady = true;
  state.presence.error = null;
  clearInterval(state.frameworkPingInterval);
  state.frameworkPingInterval = null;
}

function handleGenesysMessage(event) {
  const rawMessage = parseWindowMessage(event);
  if (!rawMessage?.type) return;

  const message = integrationAdapter.normalizeInboundMessage(rawMessage);
  if (!message?.type) return;

  console.debug('[PiP] message', message.type, message);

  switch (message.type) {
    case 'genesys:framework:ready':
      markFrameworkReady();
      integrationAdapter.requestPresenceDefinitions();
      renderPip();
      return;

    case 'genesys:presence:loading':
      state.presence.error = null;
      renderPip();
      return;

    case 'genesys:presence:definitions':
      applyPresenceDefinitions(message.data || {});
      return;

    case 'genesys:presence:definitions:error':
      state.presence.error = message.data?.message || t('presence.loadError');
      renderPip();
      return;

    case 'genesys:user:presence':
    case 'userActionSubscription':
    case 'notificationSubscription':
      applyPresenceMessage(message);
      return;

    case 'genesys:conversation:notification:ready':
      state.routing.userId = message.data?.userId || state.routing.userId;
      state.notifications.ready = true;
      state.notifications.error = null;
      renderPip();
      return;

    case 'genesys:conversation:notification:error':
      state.notifications.ready = false;
      state.notifications.error = t('notifications.error', { message: message.data?.message || t('notifications.unknownError') });
      renderPip();
      return;

    case 'genesys:routing:notification':
      applyRoutingMessage(message);
      return;

    case 'genesys:routing:update:success':
      state.routing.updatePending = false;
      state.routing.error = null;
      state.routing.noAnswer = false;
      state.presence.queueState = 'on';
      state.agentStatus = {
        label: state.presence.queue.onQueue?.label || t('queue.on'),
        id: state.presence.queue.onQueue?.id || 'ON_QUEUE',
        systemPresence: state.presence.queue.onQueue?.systemPresence || 'ON_QUEUE',
        raw: null
      };
      renderPip();
      return;

    case 'genesys:routing:update:error':
      state.routing.updatePending = false;
      state.routing.error = message.data?.message || t('noAnswer.error');
      renderPip();
      return;

    case 'genesys:wrapup:codes':
      applyWrapupCodes(message.data || {});
      return;

    case 'genesys:wrapup:codes:error':
      state.wrapup.loading = false;
      state.wrapup.error = message.data?.message || t('wrapup.loadError');
      renderPip();
      return;

    case 'genesys:wrapup:submit:success':
      finalizeWrapupSuccess();
      return;

    case 'genesys:wrapup:submit:error':
      state.wrapup.submitting = false;
      state.wrapup.error = message.data?.message || t('wrapup.submitError');
      renderPip();
      return;

    case 'genesys:conversation:notification':
    case 'interactionSubscription':
    case 'screenPop':
      applyInteractionMessage(message);
      return;

    default:
      return;
  }
}

function applyPresenceDefinitions(data) {
  state.presence.grouped = Array.isArray(data.groupedStatuses) ? data.groupedStatuses : [];
  state.presence.queue = data.queuePresence || { onQueue: null, offQueue: null };
  state.presence.error = null;

  syncQueueState(state);
  syncSelectedPrimary(state);
  renderPip();
}

function applyPresenceMessage(message) {
  const status = extractAgentPresence(message);
  if (!status) return;

  const enriched = enrichPresence(status, state.presence.grouped, state.presence.queue);
  state.presence.updating = false;
  state.presence.loaded = true;

  // ON_QUEUE / OFF_QUEUE renseignent l'etat de file, pas la presence choisie
  // par l'agent. On ne les ecrase donc pas sur une presence deja connue, mais
  // au premier chargement il vaut mieux les afficher que rester sur "Inconnu".
  if (isQueuePresence(enriched)) {
    state.presence.queueState = normalizeKey(enriched.systemPresence || enriched.label).includes('onqueue') ? 'on' : 'off';
    if (!state.agentStatus?.id) state.agentStatus = enriched;
    renderPip();
    return;
  }

  state.agentStatus = enriched;
  syncQueueState(state);
  syncSelectedPrimary(state);
  renderPip();
}

function applyRoutingMessage(message) {
  const routingStatus = extractRoutingStatus(message);
  if (!routingStatus) return;

  state.routing.status = routingStatus;
  const key = normalizeKey(routingStatus);

  if (key.includes('notresponding')) {
    state.routing.error = null;

    // NOT_RESPONDING peut arriver alors que le Framework EF affiche encore
    // l'interaction ALERTING. Ne pas effacer un appel actif sur ce seul signal :
    // l'interaction reste pilotee par ses evenements conversationnels jusqu'a
    // reception d'un etat terminal explicite.
    if (state.interaction && ACTIVE_PHASES.includes(state.interaction.phase)) {
      state.routing.noAnswer = false;
      renderPip();
      return;
    }

    state.routing.noAnswer = true;
    clearInteractionAction();
    renderPip();
    return;
  }

  // Le routing status est la source la plus fiable pour l'etat de file, et il
  // est rafraichi toutes les 3 s: OFF_QUEUE doit donc etre traite ici aussi.
  if (key.includes('offqueue')) {
    state.presence.queueState = 'off';
    state.presence.loaded = true;
    state.routing.noAnswer = false;
    renderPip();
    return;
  }

  if (key.includes('idle') || key.includes('interacting') || key.includes('communicating')) {
    state.presence.loaded = true;
    state.routing.noAnswer = false;
    state.routing.updatePending = false;
    state.routing.error = null;
    if (key.includes('idle') || key.includes('interacting')) state.presence.queueState = 'on';
    renderPip();
  }
}

function applyInteractionMessage(message) {
  const endedId = extractEndedInteractionId(message, state.routing.userId, state.interaction);
  if (endedId) {
    // Regression guard: a terminal notification can arrive without carrying
    // wrapupRequired, even though the active interaction state already knows
    // that the queue requires ACW. Never drop that interaction in that case.
    // Move it to wrap-up and keep the PiP visible until the code is submitted.
    if (state.interaction?.id === endedId && isWrapupPending(state.interaction)) {
      state.interaction = {
        ...state.interaction,
        phase: 'wrapup',
        state: 'wrapup'
      };
      clearInteractionAction();

      if (state.wrapup.sendAfterDisconnect && state.wrapup.selectedCodeId) {
        state.wrapup.sendAfterDisconnect = false;
        submitWrapup();
        return;
      }

      if (!state.wrapup.codes.length && !state.wrapup.loading) {
        loadWrapupCodes();
        return;
      }

      renderPip();
      return;
    }

    markInteractionEnded(endedId);
    if (state.interaction?.id === endedId) state.interaction = null;
    if (state.interactionAction?.id === endedId) clearInteractionAction();
    resetWrapup();
    renderPip();
    return;
  }

  const nextInteraction = extractInteractionFromMessage(message, state.routing.userId);
  if (!nextInteraction) return;

  // Un etat actif est toujours prioritaire sur un ancien marquage "termine":
  // Genesys peut re-proposer la meme conversation au meme agent.
  if (ACTIVE_PHASES.includes(nextInteraction.phase)) {
    state.endedInteractions.delete(nextInteraction.id);
  } else if (isInteractionEnded(nextInteraction.id)) {
    return;
  }

  state.routing.noAnswer = false;
  state.interaction = mergeInteraction(state.interaction, nextInteraction, state.interactionAction);

  // Si Genesys n'a transmis aucune date exploitable, le chrono part du moment
  // ou l'extension a vu l'appel pour la premiere fois.
  if (!state.interaction.startTime) state.interaction.startTime = Date.now();

  // Les parametres ACW de la file sont resolus des l'arrivee de l'appel.
  // Cela permet d'afficher le wrap-up des que la file le rend obligatoire,
  // sans attendre le raccrochage. Le choix du code reste local jusqu'au
  // disconnect, puis le code est soumis a Genesys.
  if (state.interaction?.id && state.interaction.agentParticipantId &&
      state.wrapup.loadedForInteractionId !== state.interaction.id && !state.wrapup.loading) {
    loadWrapupCodes();
    return;
  }

  // Le raccrochage vient d'aboutir et un code avait ete choisi: on l'envoie
  // maintenant que le participant est deconnecte, comme Genesys l'attend.
  if (state.wrapup.sendAfterDisconnect && state.interaction.phase === 'wrapup') {
    state.wrapup.sendAfterDisconnect = false;
    submitWrapup();
    return;
  }

  renderPip();
}

function markInteractionEnded(interactionId) {
  const now = Date.now();
  state.endedInteractions.set(interactionId, now);

  for (const [id, endedAt] of state.endedInteractions) {
    if (now - endedAt > ENDED_INTERACTION_TTL_MS) state.endedInteractions.delete(id);
  }
}

function isInteractionEnded(interactionId) {
  const endedAt = state.endedInteractions.get(interactionId);
  if (!endedAt) return false;

  if (Date.now() - endedAt > ENDED_INTERACTION_TTL_MS) {
    state.endedInteractions.delete(interactionId);
    return false;
  }

  return true;
}

function applyWrapupCodes(data) {
  const codes = Array.isArray(data.codes) ? data.codes : [];

  // framework.js peut retrouver la file via la conversation API. On conserve
  // l'information pour les rechargements suivants.
  if (data.queueId && state.interaction && !state.interaction.queueId) {
    state.interaction.queueId = data.queueId;
  }

  if (state.interaction) {
    const requiredFromQueue = Boolean(data.wrapupRequired);
    const requiredFromInteraction = isWrapupRequiredValue(state.interaction);
    state.interaction = {
      ...state.interaction,
      wrapupRequired: requiredFromQueue || requiredFromInteraction
    };
    state.wrapup.loadedForInteractionId = state.interaction.id;
  }

  state.wrapup.loading = false;
  state.wrapup.codes = codes;
  state.wrapup.error = codes.length ? null : t('wrapup.noCodes');
  renderPip();
}

function renderPip() {
  if (!state.pipWindow || state.pipWindow.closed) return;

  const resolvedTheme = resolveTheme(state.settings.theme);
  state.pipWindow.document.documentElement.dataset.theme = resolvedTheme;
  state.pipWindow.document.body.innerHTML = renderPipHtml(state, resolvedTheme);
  bindPipEvents();
}

function bindPipEvents() {
  const doc = state.pipWindow?.document;
  if (!doc) return;

  doc.getElementById('queueToggle')?.addEventListener('click', toggleQueueState);
  doc.getElementById('presenceMenuToggle')?.addEventListener('click', togglePresenceMenu);
  doc.querySelector('.presence-menu')?.addEventListener('click', handlePresenceMenuClick);

  doc.getElementById('answerCall')?.addEventListener('click', () => startInteractionAction(INTERACTION_ACTIONS.pickup, t('action.answering')));
  doc.getElementById('rejectCall')?.addEventListener('click', () => startInteractionAction(INTERACTION_ACTIONS.disconnect, t('action.rejecting')));
  doc.getElementById('holdCall')?.addEventListener('click', () => startInteractionAction(INTERACTION_ACTIONS.hold, t('action.holding')));
  doc.getElementById('resumeCall')?.addEventListener('click', () => startInteractionAction(INTERACTION_ACTIONS.resume, t('action.resuming')));
  doc.getElementById('hangupCall')?.addEventListener('click', handleHangupClick);

  doc.getElementById('toggleCallData')?.addEventListener('click', () => {
    state.callDataOpen = !state.callDataOpen;
    renderPip();
  });

  doc.getElementById('goBackOnQueue')?.addEventListener('click', makeEligibleForInteractions);
  doc.getElementById('goOffQueue')?.addEventListener('click', goOffQueue);
  doc.getElementById('backToTab')?.addEventListener('click', focusOriginalTab);

  doc.getElementById('wrapupCodeSelect')?.addEventListener('change', (event) => {
    state.wrapup.selectedCodeId = event.target.value;
    renderPip();
  });

  doc.getElementById('wrapupNotes')?.addEventListener('input', (event) => {
    state.wrapup.notes = event.target.value;
  });

  doc.getElementById('retryWrapupCodes')?.addEventListener('click', loadWrapupCodes);
  doc.getElementById('submitWrapup')?.addEventListener('click', submitWrapup);
}

/**
 * Bring the original app.html tab/window to the foreground without closing
 * the Picture-in-Picture companion. The native Chrome PiP return button is
 * disabled via PIP_WINDOW_OPTIONS because this action is intentionally part
 * of the companion UI.
 */
async function focusOriginalTab() {
  try {
    if (chrome?.tabs?.getCurrent && chrome?.tabs?.update) {
      const currentTab = await chrome.tabs.getCurrent();

      if (currentTab?.id != null) {
        if (chrome.windows?.update && currentTab.windowId != null) {
          await chrome.windows.update(currentTab.windowId, { focused: true });
        }

        await chrome.tabs.update(currentTab.id, { active: true });
        return;
      }
    }
  } catch (error) {
    console.warn('[PiP] Unable to focus original tab through Chrome APIs:', error);
  }

  // Fallback for environments where extension tab APIs are unavailable.
  try {
    window.focus();
  } catch {
    // Nothing else to do: the PiP must remain open.
  }
}

function toggleQueueState() {
  if (state.presence.queueState === 'on') {
    goOffQueue();
    return;
  }

  const onQueue = state.presence.queue.onQueue;
  if (!onQueue?.id) return;

  const currentPresence = findPresenceById(state.agentStatus.id, state.presence.grouped, state.presence.queue);
  if (currentPresence && !isQueuePresence(currentPresence)) {
    state.presence.lastOffQueue = currentPresence;
  }

  state.presence.queueState = 'on';
  state.agentStatus = {
    label: onQueue.label || t('queue.on'),
    id: onQueue.id,
    systemPresence: onQueue.systemPresence || 'ON_QUEUE',
    raw: null
  };
  state.presence.selectedPrimary = '';
  state.presence.expandedPrimary = '';
  integrationAdapter.updatePresence(onQueue.id);
  renderPip();
}

function goOffQueue() {
  const target = state.presence.lastOffQueue || findDefaultOffQueuePresence(state.presence.grouped);
  if (!target?.id) return;

  state.routing.noAnswer = false;
  state.presence.queueState = 'off';
  state.agentStatus = {
    label: target.label,
    id: target.id,
    systemPresence: target.systemPresence,
    raw: null
  };
  state.presence.selectedPrimary = target.systemPresence;
  state.presence.expandedPrimary = target.systemPresence;
  integrationAdapter.updatePresence(target.id);
  renderPip();
}

function makeEligibleForInteractions() {
  state.routing.updatePending = true;
  state.routing.error = null;
  integrationAdapter.requestMakeEligibleForInteractions();
  renderPip();

  setTimeout(() => {
    if (!state.routing.updatePending) return;
    state.routing.updatePending = false;
    renderPip();
  }, TIMERS.routingPendingMs);
}

function togglePresenceMenu() {
  state.presence.menuOpen = !state.presence.menuOpen;
  if (state.presence.menuOpen && !state.presence.expandedPrimary) {
    state.presence.expandedPrimary = state.presence.selectedPrimary || state.presence.grouped[0]?.systemPresence || '';
  }
  renderPip();
}

function handlePresenceMenuClick(event) {
  const secondaryButton = event.target.closest('[data-presence-id]');
  const primaryButton = event.target.closest('[data-presence-primary]');

  if (secondaryButton) {
    const statusId = secondaryButton.getAttribute('data-presence-id');
    const systemPresence = secondaryButton.getAttribute('data-presence-primary-key');
    const label = secondaryButton.getAttribute('data-presence-label');
    setPresence(statusId, systemPresence, label);
    return;
  }

  if (primaryButton) {
    const primaryKey = primaryButton.getAttribute('data-presence-primary');
    const primary = state.presence.grouped.find((item) => normalizeKey(item.systemPresence) === normalizeKey(primaryKey));
    if (!primary) return;

    state.presence.selectedPrimary = primary.systemPresence;

    if (primary.children?.length) {
      state.presence.expandedPrimary = state.presence.expandedPrimary === primary.systemPresence ? '' : primary.systemPresence;
      state.presence.menuOpen = true;
      renderPip();
      return;
    }

    setPresence(primary.id, primary.systemPresence, primary.label);
  }
}

function setPresence(statusId, systemPresence, label) {
  if (!statusId) return;

  state.routing.noAnswer = false;
  state.presence.updating = true;
  state.agentStatus = { label: label || t('presence.unknown'), id: statusId, systemPresence, raw: null };
  state.presence.selectedPrimary = systemPresence || state.presence.selectedPrimary;
  state.presence.expandedPrimary = systemPresence || state.presence.expandedPrimary;
  state.presence.menuOpen = false;
  syncQueueState(state);
  integrationAdapter.updatePresence(statusId);
  renderPip();

  setTimeout(() => {
    if (!state.presence.updating || state.agentStatus.id !== statusId) return;
    state.presence.updating = false;
    renderPip();
  }, TIMERS.presencePendingMs);
}

function startInteractionAction(action, label) {
  const interaction = state.interaction;
  if (!interaction?.id) return;

  state.interactionAction = { id: interaction.id, action, label };
  integrationAdapter.updateInteractionState(interaction.id, action);

  const timeoutByAction = {
    pickup: TIMERS.pickupPendingMs,
    disconnect: TIMERS.disconnectPendingMs,
    hold: TIMERS.holdPendingMs,
    resume: TIMERS.resumePendingMs
  };

  clearTimeout(state.interactionActionTimer);
  state.interactionActionTimer = setTimeout(() => finalizeOptimisticInteractionAction(action, interaction.id), timeoutByAction[action] || 1500);
  renderPip();
}

function finalizeOptimisticInteractionAction(action, interactionId) {
  if (state.interactionAction?.id !== interactionId || state.interactionAction?.action !== action) return;
  clearInteractionAction();

  if (!state.interaction || state.interaction.id !== interactionId) return;

  if (action === 'pickup' || action === 'resume') state.interaction = { ...state.interaction, phase: 'connected', state: 'connected' };
  if (action === 'hold') state.interaction = { ...state.interaction, phase: 'held', state: 'held' };
  if (action === 'disconnect') {
    // L'appel est coupe. Si un code reste a saisir, la carte reste affichee en
    // wrap-up: l'agent qualifie apres coup, sans que le raccrochage attende.
    if (isWrapupPending(state.interaction)) {
      state.interaction = { ...state.interaction, phase: 'wrapup', state: 'wrapup' };

      if (state.wrapup.sendAfterDisconnect) {
        state.wrapup.sendAfterDisconnect = false;
        submitWrapup();
        return;
      }
    } else {
      markInteractionEnded(interactionId);
      state.interaction = null;
      resetWrapup();
    }
  }

  renderPip();
}

// Raccrocher raccroche: aucun panneau ne s'interpose. Le code eventuellement
// choisi pendant l'appel est envoye juste apres, sur le participant deconnecte,
// qui est le seul etat ou Genesys accepte un wrap-up.
function handleHangupClick() {
  if (!state.interaction) return;

  state.wrapup.sendAfterDisconnect = Boolean(state.wrapup.selectedCodeId && isWrapupPending(state.interaction));
  startInteractionAction(INTERACTION_ACTIONS.disconnect, t('action.hangingUp'));
}

function loadWrapupCodes() {
  const interaction = state.interaction;
  state.wrapup.error = null;
  state.wrapup.codes = [];

  if (!interaction?.id) {
    state.wrapup.loading = false;
    state.wrapup.error = t('wrapup.noInteraction');
    renderPip();
    return;
  }

  state.wrapup.loading = true;
  integrationAdapter.requestWrapupCodes({
    conversationId: interaction.id,
    participantId: interaction.agentParticipantId,
    queueId: interaction.queueId
  });
  renderPip();

  setTimeout(() => {
    if (!state.wrapup.loading) return;
    state.wrapup.loading = false;
    state.wrapup.error = t('wrapup.loadTimeout');
    renderPip();
  }, TIMERS.wrapupPendingMs);
}

function resetWrapup() {
  state.wrapup.loading = false;
  state.wrapup.submitting = false;
  state.wrapup.sendAfterDisconnect = false;
  state.wrapup.error = null;
  state.wrapup.codes = [];
  state.wrapup.selectedCodeId = '';
  state.wrapup.notes = '';
  state.wrapup.loadedForInteractionId = null;
}

function submitWrapup() {
  const interaction = state.interaction;
  if (!interaction?.id || !interaction.agentParticipantId || !state.wrapup.selectedCodeId) return;

  state.wrapup.submitting = true;
  state.wrapup.error = null;
  integrationAdapter.submitWrapup({
    conversationId: interaction.id,
    participantId: interaction.agentParticipantId,
    codeId: state.wrapup.selectedCodeId,
    notes: state.wrapup.notes
  });
  renderPip();

  setTimeout(() => {
    if (!state.wrapup.submitting) return;
    state.wrapup.submitting = false;
    state.wrapup.error = t('wrapup.submitTimeout');
    renderPip();
  }, TIMERS.wrapupPendingMs);
}

// Code accepte: l'appel etait deja coupe, il ne reste donc plus rien a afficher.
function finalizeWrapupSuccess() {
  if (state.interaction) {
    markInteractionEnded(state.interaction.id);
    state.interaction = null;
  }

  resetWrapup();
  renderPip();
}

function clearInteractionAction() {
  state.interactionAction = null;
  clearTimeout(state.interactionActionTimer);
  state.interactionActionTimer = null;
}

function extractRoutingStatus(message) {
  const data = message.data?.data || message.data || {};
  const candidates = [
    data.routingStatus,
    data.status,
    data.routingStatus?.routingStatus,
    data.routingStatus?.status,
    data.routingStatus?.name,
    data.routingStatus?.state,
    data.data?.routingStatus,
    data.data?.status,
    data.userRoutingStatus?.routingStatus,
    data.userRoutingStatus?.status,
    data.eventBody?.routingStatus,
    data.eventBody?.status
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate === 'string') return candidate;
    if (typeof candidate === 'object') return candidate.status || candidate.name || candidate.state || candidate.routingStatus || null;
  }

  return null;
}

function applyThemeToDocument() {
  document.documentElement.dataset.theme = resolveTheme(state.settings.theme);
}
