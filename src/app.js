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
  extractEndedInteractionId,
  extractInteractionFromMessage,
  isWrapupPending,
  isWrapupRequiredValue,
  mergeInteraction
} from './interactions.js';
import { copyStylesToPip, renderPipHtml } from './pipView.js';
import { formatDuration, normalizeKey } from './utils.js';
import { setLanguage, t, translateDocument } from './i18n/index.js';
import { getDemoCrmContext, initDemoCrm, openDemoCrmCase, openDemoCrmCustomer, screenPopFromParticipantData } from './demoCrm.js';

const softphone = document.getElementById('softphone');
const openPipButton = document.getElementById('openPip');
const pipSupport = document.getElementById('pipSupport');
const integrationKind = document.body.dataset.integrationAdapter || 'embeddable-framework';
const integrationAdapter = createIntegrationAdapter(integrationKind, softphone);
const state = createInitialState();
const ENDED_INTERACTION_TTL_MS = 60000;
let startCompanionPending = false;

bootstrap();

async function bootstrap() {
  initDemoCrm();
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

  openPipButton.addEventListener('click', startCompanion);
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

async function startCompanion() {
  if (openPipButton.disabled) return;

  openPipButton.disabled = true;
  try {
    // requestWindow() must remain directly in the user-click chain. Once the
    // PiP exists, changing Genesys presence no longer needs browser activation.
    if (!state.pipWindow || state.pipWindow.closed) {
      await openPipWindow();
    }

    if (state.presence.queueState === 'on') return;

    const onQueue = state.presence.queue.onQueue;
    if (onQueue?.id) {
      goOnQueue();
      return;
    }

    // Presence definitions can arrive after the PiP opens. Remember the user's
    // intent and complete Start Companion as soon as Genesys provides On Queue.
    startCompanionPending = true;
    if (state.frameworkReady) integrationAdapter.requestPresenceDefinitions();
  } catch (error) {
    startCompanionPending = false;
    console.error('[PiP] Unable to start companion:', error);
    pipSupport.textContent = t('app.startCompanionError');
  } finally {
    openPipButton.disabled = !('documentPictureInPicture' in window);
  }
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
      applyPresenceMessage(message);
      return;

    case 'notificationSubscription':
      if (applyEmbeddedInteractionSelection(message)) return;
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

function applyEmbeddedInteractionSelection(message) {
  const category = String(message?.data?.category || '').toLowerCase();
  if (category !== 'interactionselection') return false;

  const payload = message?.data?.data;
  const interactionId = typeof payload === 'string'
    ? payload
    : payload?.id || payload?.interactionId || payload?.interaction?.id || null;

  if (!interactionId || !state.interactions.has(interactionId)) return true;
  selectInteraction(interactionId);
  return true;
}

function applyPresenceDefinitions(data) {
  state.presence.grouped = Array.isArray(data.groupedStatuses) ? data.groupedStatuses : [];
  state.presence.queue = data.queuePresence || { onQueue: null, offQueue: null };
  state.presence.error = null;

  syncQueueState(state);
  syncSelectedPrimary(state);

  if (startCompanionPending && state.presence.queueState !== 'on' && state.presence.queue.onQueue?.id) {
    startCompanionPending = false;
    goOnQueue();
    return;
  }

  startCompanionPending = false;
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
  const messageId = message.data?.conversation?.id || message.data?.eventBody?.id || message.data?.interaction?.new?.id || message.data?.interaction?.id || message.data?.interactionId || null;
  const knownInteraction = messageId ? state.interactions.get(messageId) : state.interaction;
  const endedId = extractEndedInteractionId(message, state.routing.userId, knownInteraction);
  if (endedId) {
    // Regression guard: a terminal notification can arrive without carrying
    // wrapupRequired, even though the active interaction state already knows
    // that the queue requires ACW. Never drop that interaction in that case.
    // Move it to wrap-up and keep the PiP visible until the code is submitted.
    const endedInteraction = state.interactions.get(endedId);
    if (endedInteraction && isWrapupPending(endedInteraction)) {
      selectInteraction(endedId, false);
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
    state.interactions.delete(endedId);
    if (state.selectedInteractionId === endedId) {
      const fallback = [...state.interactions.values()][0] || null;
      state.selectedInteractionId = fallback?.id || null;
      state.interaction = fallback;
    }
    if (state.interactionAction?.id === endedId) clearInteractionAction();
    resetWrapup();
    renderPip();
    return;
  }

  const nextInteraction = extractInteractionFromMessage(message, state.routing.userId);
  if (!nextInteraction) return;

  // Once a conversation has received a confirmed terminal event, keep the
  // tombstone for a short period. Late EF / WebSocket notifications can carry
  // an older CONNECTED state and must never resurrect the interaction. A new
  // Genesys interaction is expected to have a new conversation id.
  if (isInteractionEnded(nextInteraction.id)) {
    // Genesys can re-offer the same conversation after NOT_RESPONDING. An
    // explicit ALERTING event is a new active lifecycle for PiP and clears the
    // short-lived tombstone; stale CONNECTED events remain ignored.
    if (nextInteraction.phase === 'alerting') state.endedInteractions.delete(nextInteraction.id);
    else return;
  }

  state.routing.noAnswer = false;
  const previousInteraction = state.interactions.get(nextInteraction.id) || null;
  const mergedInteraction = mergeInteraction(previousInteraction, nextInteraction, state.interactionAction);
  state.interactions.set(mergedInteraction.id, mergedInteraction);

  // Keep the user's current selection. A newly alerting conversation is selected
  // automatically so it cannot be missed; otherwise the first conversation wins.
  if (!state.selectedInteractionId || !state.interactions.has(state.selectedInteractionId) || mergedInteraction.phase === 'alerting') {
    state.selectedInteractionId = mergedInteraction.id;
  }
  state.interaction = state.interactions.get(state.selectedInteractionId) || mergedInteraction;

  // Demo CRM screen pop: participant data remain the source of truth.
  // Unknown/missing customer IDs are ignored so the Genesys interaction flow is never blocked.
  screenPopFromParticipantData(state.interaction.participantData);

  // Si Genesys n'a transmis aucune date exploitable, le chrono part du moment
  // ou l'extension a vu l'appel pour la premiere fois.
  if (!state.interaction.startTime) state.interaction.startTime = Date.now();
  state.interactions.set(state.interaction.id, state.interaction);

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
    // Keep the multi-interaction store authoritative too. Without this, the next
    // notification could restore the pre-queue-policy copy and hide the wrap-up
    // selector again while the interaction was still connected.
    state.interactions.set(state.interaction.id, state.interaction);
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

  doc.querySelectorAll('[data-interaction-id]').forEach((button) => button.addEventListener('click', () => selectInteraction(button.dataset.interactionId)));

  doc.getElementById('queueToggle')?.addEventListener('click', toggleQueueState);
  doc.getElementById('presenceMenuToggle')?.addEventListener('click', togglePresenceMenu);
  doc.querySelector('.presence-menu')?.addEventListener('click', handlePresenceMenuClick);

  doc.getElementById('answerCall')?.addEventListener('click', () => startInteractionAction(INTERACTION_ACTIONS.pickup, t('action.answering')));
  doc.getElementById('rejectCall')?.addEventListener('click', () => startInteractionAction(INTERACTION_ACTIONS.disconnect, t('action.rejecting')));
  doc.getElementById('holdCall')?.addEventListener('click', () => startInteractionAction(INTERACTION_ACTIONS.hold, t('action.holding')));
  doc.getElementById('resumeCall')?.addEventListener('click', () => startInteractionAction(INTERACTION_ACTIONS.resume, t('action.resuming')));
  doc.getElementById('hangupCall')?.addEventListener('click', handleHangupClick);
  doc.getElementById('openCrmCustomer')?.addEventListener('click', openCurrentCrmCustomer);
  doc.getElementById('openCrmCase')?.addEventListener('click', openCurrentCrmCase);
  doc.querySelectorAll('.context-copy').forEach((button) => button.addEventListener('click', async () => {
    const value = button.dataset.copyValue || '';
    if (!value) return;
    const copied = await copyTextToClipboard(value, doc);
    showCopyFeedback(button, copied);
  }));
  doc.querySelectorAll('.context-url-action, .context-link-action').forEach((button) => button.addEventListener('click', () => {
    const url = button.dataset.contextUrl || '';
    if (!/^https:\/\//i.test(url)) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }));

  const detailsBackdrop = doc.getElementById('interactionDetailsBackdrop');
  const openDetails = () => {
    if (!detailsBackdrop) return;
    detailsBackdrop.hidden = false;
    detailsBackdrop.closest('.call-band-body')?.classList.add('interaction-details-open');
    doc.getElementById('closeInteractionDetails')?.focus();
  };
  const closeDetails = () => {
    if (!detailsBackdrop) return;
    detailsBackdrop.hidden = true;
    detailsBackdrop.closest('.call-band-body')?.classList.remove('interaction-details-open');
    doc.getElementById('openInteractionDetails')?.focus();
  };
  doc.getElementById('openInteractionDetails')?.addEventListener('click', openDetails);
  doc.getElementById('closeInteractionDetails')?.addEventListener('click', closeDetails);
  detailsBackdrop?.addEventListener('click', (event) => {
    if (event.target === detailsBackdrop) closeDetails();
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

function selectInteraction(interactionId, shouldRender = true) {
  const interaction = state.interactions.get(interactionId);
  if (!interaction) return;

  state.selectedInteractionId = interactionId;
  state.interaction = interaction;
  state.callDataOpen = false;

  // Wrap-up UI is conversation-specific. Reload it when the selected conversation changes.
  if (state.wrapup.loadedForInteractionId !== interactionId) {
    resetWrapup();
    if (interaction.agentParticipantId) {
      loadWrapupCodes();
      return;
    }
  }

  if (shouldRender) renderPip();
}

async function copyTextToClipboard(value, pipDocument) {
  // Document PiP can be denied direct Clipboard API access. Prefer the host
  // extension window, then fall back to execCommand in both documents.
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* Continue with a synchronous fallback. */ }

  const copyWithDocument = (targetDocument) => {
    if (!targetDocument?.body || typeof targetDocument.execCommand !== 'function') return false;
    const textarea = targetDocument.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    targetDocument.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    let success = false;
    try { success = targetDocument.execCommand('copy'); } catch { success = false; }
    textarea.remove();
    return success;
  };

  return copyWithDocument(document) || copyWithDocument(pipDocument);
}

function showCopyFeedback(button, success) {
  const icon = button.querySelector('.context-button-icon');
  const feedback = button.querySelector('.context-button-feedback');
  if (!icon || !feedback) return;
  const original = icon.innerHTML;
  button.classList.remove('is-copied', 'is-copy-error');
  button.classList.add(success ? 'is-copied' : 'is-copy-error');
  icon.innerHTML = success ? Icons.check : '×';
  feedback.textContent = '';
  window.setTimeout(() => {
    if (!button.isConnected) return;
    icon.innerHTML = original;
    button.classList.remove('is-copied', 'is-copy-error');
  }, 1000);
}

async function openCurrentCrmCustomer() {
  const context = getDemoCrmContext(state.interaction?.participantData || []);
  if (!context) return;
  openDemoCrmCustomer(context.customerId);
  await focusOriginalTab();
}

async function openCurrentCrmCase() {
  const context = getDemoCrmContext(state.interaction?.participantData || []);
  if (!context?.caseId) return;
  openDemoCrmCase(context.customerId, context.caseId);
  await focusOriginalTab();
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

  goOnQueue();
}

function goOnQueue() {
  const onQueue = state.presence.queue.onQueue;
  if (!onQueue?.id) return false;

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
  return true;
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
  if (state.interaction?.id === interactionId) state.interactions.set(interactionId, state.interaction);
  if (action === 'disconnect') {
    // L'appel est coupe. Si un code reste a saisir, la carte reste affichee en
    // wrap-up: l'agent qualifie apres coup, sans que le raccrochage attende.
    if (isWrapupPending(state.interaction)) {
      state.interaction = { ...state.interaction, phase: 'wrapup', state: 'wrapup' };
      state.interactions.set(interactionId, state.interaction);

      if (state.wrapup.sendAfterDisconnect) {
        state.wrapup.sendAfterDisconnect = false;
        submitWrapup();
        return;
      }
    } else {
      markInteractionEnded(interactionId);
      state.interactions.delete(interactionId);
      const fallback = [...state.interactions.values()][0] || null;
      state.selectedInteractionId = fallback?.id || null;
      state.interaction = fallback;
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
  const isDigital = state.interaction.mediaType === 'message' || state.interaction.mediaType === 'email';
  startInteractionAction(INTERACTION_ACTIONS.disconnect, t(isDigital ? 'action.endingConversation' : 'action.hangingUp'));
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

// Code accepte: l'interaction etait deja terminee cote media. Remove it from
// the multi-interaction store as well as from the selected interaction. Keeping
// it in the Map made completed conversations reappear as tabs after ACW.
function finalizeWrapupSuccess() {
  const completedId = state.interaction?.id || state.selectedInteractionId;

  if (completedId) {
    markInteractionEnded(completedId);
    state.interactions.delete(completedId);
    if (state.interactionAction?.id === completedId) clearInteractionAction();
  }

  const fallback = [...state.interactions.values()][0] || null;
  state.selectedInteractionId = fallback?.id || null;
  state.interaction = fallback;

  resetWrapup();

  // If another interaction remains, load its own ACW context instead of
  // leaving the global wrap-up state attached to the completed conversation.
  if (fallback?.id && fallback.agentParticipantId) {
    loadWrapupCodes();
    return;
  }

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
