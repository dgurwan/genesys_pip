// Traduction des evenements d'appel Genesys en un objet simple et stable:
//   { id, phase, state, caller, queueId, queueName, participantData, ... }
//
// `phase` est la seule valeur utilisee par l'interface:
//   alerting -> appel offert (Decrocher / Refuser)
//   connected -> en cours (Pause / Raccrocher)
//   held -> en pause (Reprendre / Raccrocher)
//   wrapup -> after call work (code wrap-up)
//   unknown -> etat non identifie, l'appel reste affiche
//   ended -> termine, l'appel disparait
//
// Deux sources d'evenements aux formats differents arrivent ici:
//   - genesys:conversation:notification (WebSocket Platform API, complet)
//   - screenPop / interactionSubscription (Embeddable Framework, plus rapide)
// mergeInteraction() fusionne les deux sans jamais degrader un etat connu.

import { extractCustomerParticipantData, findCustomerParticipant } from './participantData.js';
import { normalizeKey, parseTimestamp, uniqueBy } from './utils.js';

const NON_VOICE_MEDIA = ['chat', 'email', 'message', 'sms', 'social', 'cobrowse', 'screenshare', 'video'];
export const ACTIVE_PHASES = ['alerting', 'connected', 'held', 'wrapup'];

export function extractInteractionFromMessage(message, userId) {
  if (message.type === 'genesys:conversation:notification') {
    return extractFromConversationNotification(message, userId);
  }

  if (message.type === 'screenPop' || message.type === 'interactionSubscription') {
    return extractFromEmbeddedInteraction(message);
  }

  return null;
}

export function extractEndedInteractionId(message, userId, currentInteraction = null) {
  if (message.type === 'genesys:conversation:notification') {
    const conversation = message.data?.conversation || message.data?.eventBody;
    const id = conversation?.id || conversation?.conversationId;
    if (!id) return null;

    // Le terminal event peut etre partiel et ne plus porter wrapupRequired.
    // Si l'etat courant de PiP sait deja que l'ACW est obligatoire, ne jamais
    // supprimer l'interaction avant la saisie du code.
    if (currentInteraction?.id === id && isWrapupPending(currentInteraction)) return null;

    const agentParticipant = findAgentParticipant(conversation, userId);

    // Le canal d'appel peut etre raccroche alors que l'agent est encore en ACW.
    // Dans ce cas on garde l'interaction affichee pour pouvoir saisir le code
    // wrap-up, au lieu de considerer la conversation comme terminee.
    if (isWrapupPending(agentParticipant)) return null;

    // On se base en priorite sur le leg de l'agent: le client peut rester
    // connecte (requeue, transfert) alors que l'agent a quitte la conversation.
    const communications = agentParticipant
      ? getParticipantCommunications(agentParticipant)
      : getAllCommunications(conversation);

    if (!communications.length) return null;

    // Ne jamais conclure a une fin d'interaction simplement parce qu'une
    // notification contient des communications sans etat exploitable.
    // Certaines notifications EF/Platform sont partielles et peuvent arriver
    // juste apres l'evenement ALERTING. On ne supprime l'interaction que si
    // toutes les communications connues portent explicitement un etat terminal.
    if (communications.some(isActiveCommunication)) return null;
    if (communications.some((communication) => !isExplicitlyEndedCommunication(communication))) return null;

    return id;
  }

  const payload = message.data || {};
  // Pour un evenement de changement, l'etat courant est dans `new`. Lire `old`
  // en premier faisait manquer les raccrochages.
  const interaction = payload.interaction?.new || payload.interaction?.old || payload.interaction || payload.data?.interaction || payload;
  const id = interaction.id || payload.interaction?.old?.id || payload.interactionId || payload.data?.interactionId;
  if (!id) return null;

  const state = normalizeKey(interaction.state || interaction.callState || interaction.status || '');
  const category = normalizeKey(payload.category || '');

  if (currentInteraction?.id === id && isWrapupPending(currentInteraction)) return null;

  // Meme garde que pour les notifications de conversation: un raccrochage avec
  // un wrap-up encore a saisir n'est pas une fin d'interaction.
  if (isWrapupRequiredValue(interaction, payload) && !interaction.wrapup && !interaction.wrapUp) return null;

  // Pour les notifications EF (screenPop / interactionSubscription), ne pas
  // inferer une fin a partir d'un payload incomplet. Seul un etat explicitement
  // terminal ou une categorie de suppression peut retirer l'interaction.
  if (isEndedStateKey(state) || category.includes('delete') || category.includes('remove')) {
    return id;
  }

  return null;
}

export function mergeInteraction(previous, next, actionInProgress) {
  if (!previous || previous.id !== next.id) {
    return applyPendingActionToInteraction(next, actionInProgress);
  }

  const merged = {
    ...previous,
    ...next,
    participantData: mergeParticipantData(previous.participantData, next.participantData),
    // Le chrono ne doit pas repartir de zero a chaque notification.
    startTime: previous.startTime || next.startTime,
    queueId: next.queueId || previous.queueId,
    // Certaines notifications suivantes ne renvoient pas queueName.
    // Ne jamais effacer une valeur deja resolue par un evenement precedent.
    queueName: next.queueName || previous.queueName,
    agentParticipantId: next.agentParticipantId || previous.agentParticipantId,
    customerParticipantId: next.customerParticipantId || previous.customerParticipantId,
    wrapupRequired: next.wrapupRequired || previous.wrapupRequired,
    wrapupSubmitted: next.wrapupSubmitted || previous.wrapupSubmitted
  };

  // Une notification WebSocket incomplete ne doit jamais degrader un etat
  // ALERTING fiable venu du framework: sinon Decrocher/Refuser disparaissent.
  if (next.phase === 'unknown' && previous.phase && previous.phase !== 'unknown') {
    merged.phase = previous.phase;
    merged.state = previous.state;
  }

  if (previous.phase === 'alerting' && next.phase !== 'connected' && next.phase !== 'held') {
    merged.phase = 'alerting';
    merged.state = previous.state || next.state || 'ALERTING';
  }

  if (next.phase === 'alerting' || next.phase === 'connected' || next.phase === 'held' || next.phase === 'wrapup') {
    merged.phase = next.phase;
  }

  return applyPendingActionToInteraction(merged, actionInProgress);
}

function extractFromEmbeddedInteraction(message) {
  const payload = message.data || {};
  const interaction = payload.interaction?.new || payload.interaction || payload.data?.interaction || payload;
  const id = interaction.id || payload.interactionId || payload.data?.interactionId;
  if (!id) return null;

  const rawState = String(interaction.state || interaction.callState || interaction.status || '');
  const category = String(payload.category || '');
  let phase = getPhaseFromState(rawState, category, interaction);
  // Raccroche mais code wrap-up encore attendu: c'est de l'ACW, pas une fin.
  if (phase === 'ended' && isWrapupRequiredValue(interaction, payload) && !interaction.wrapup && !interaction.wrapUp) phase = 'wrapup';
  if (phase === 'ended') return null;
  if (!isVoiceInteraction(interaction, message.type)) return null;

  const participantData = extractCustomerParticipantData({ interaction, payload, conversation: null });

  return {
    id,
    phase,
    state: rawState || category || phase,
    caller: interaction.remoteName || interaction.name || interaction.ani || interaction.phone || interaction.phoneNumber || payload.searchString || 'Interaction voix',
    startTime: parseTimestamp(interaction.connectedTime || interaction.startTime),
    queueId: interaction.queueId || interaction.queue?.id || payload.queueId || payload.queue?.id || null,
    queueName: interaction.queueName || interaction.queue?.name || interaction.queue?.label || payload.queueName || payload.queue?.name || '',
    participantData,
    agentParticipantId: interaction.participantId || interaction.agentParticipantId || null,
    customerParticipantId: null,
    wrapupRequired: isWrapupRequiredValue(interaction, message.data || {}),
    wrapupSubmitted: Boolean(interaction.wrapup)
  };
}

function extractFromConversationNotification(message, userId) {
  const conversation = message.data?.conversation || message.data?.eventBody;
  if (!conversation || typeof conversation !== 'object') return null;

  const id = conversation.id || conversation.conversationId;
  if (!id) return null;

  const agentParticipant = findAgentParticipant(conversation, userId);
  const customerParticipant = findCustomerParticipant(conversation);
  const agentCommunication = findBestCommunication(agentParticipant);
  const customerCommunication = findBestCommunication(customerParticipant);
  const phase = getPhaseFromAgentParticipant(agentParticipant, agentCommunication);
  const participantData = extractCustomerParticipantData({ interaction: null, payload: {}, conversation });

  return {
    id,
    phase,
    state: agentCommunication?.state || phase,
    caller: customerParticipant?.name || customerParticipant?.ani || customerCommunication?.ani || customerCommunication?.address || conversation.ani || 'Interaction voix',
    startTime: findInteractionStartTime(conversation, agentParticipant, agentCommunication),
    queueId: findQueueId(conversation, agentParticipant, customerParticipant),
    queueName: findQueueName(conversation, agentParticipant, customerParticipant),
    participantData,
    agentParticipantId: agentParticipant?.id || agentParticipant?.participantId || null,
    customerParticipantId: customerParticipant?.id || customerParticipant?.participantId || null,
    wrapupRequired: isWrapupRequiredValue(agentParticipant),
    wrapupSubmitted: Boolean(agentParticipant?.wrapup?.code || agentParticipant?.wrapupCode)
  };
}

function getPhaseFromState(rawState, category, interaction) {
  const state = normalizeKey(rawState);
  const categoryKey = normalizeKey(category);

  if (isEndedStateKey(state)) return 'ended';

  if (state.includes('alert') || state.includes('ring') || state.includes('offer') || interaction?.alerting === true) {
    return 'alerting';
  }

  if (interaction?.held === true || state.includes('hold') || state.includes('held')) return 'held';
  if (interaction?.isConnected === true || state.includes('connect') || state.includes('contact') || state.includes('talk')) return 'connected';
  // Meme remarque que ci-dessous: `wrapupRequired` n'est pas un etat.
  if (state.includes('wrapup') || state.includes('acw')) return 'wrapup';

  // Un ajout d'interaction sans etat exploitable correspond a un appel offert.
  if (categoryKey.includes('add')) return 'alerting';

  return 'unknown';
}

function isEndedStateKey(state) {
  return Boolean(state) && (state.includes('disconnect') || state.includes('terminated') || state.includes('ended'));
}

// Attention: `wrapupRequired` n'est PAS un etat. C'est une propriete de la file
// (« cette interaction exigera un code »), vraie des l'offre de l'appel. La
// deduire en phase `wrapup` faisait basculer la PiP en after call work alors que
// l'agent etait encore en ligne. Seul un etat reellement en wrap-up compte.
function getPhaseFromAgentParticipant(agentParticipant, communication) {
  if (!agentParticipant) return 'unknown';

  const states = [
    agentParticipant.state,
    agentParticipant.status,
    communication?.state,
    communication?.held ? 'held' : ''
  ].map(normalizeKey).join(' ');

  if (states.includes('alert')) return 'alerting';
  if (states.includes('hold') || states.includes('held')) return 'held';
  if (states.includes('wrapup') || states.includes('acw')) return 'wrapup';

  // Le raccrochage se teste AVANT « connected »: la chaine « disconnected »
  // contient « connect ». Le vrai ACW, c'est un leg agent raccroche avec un code
  // encore a saisir; c'est la combinaison qui fait l'etat, pas le drapeau seul.
  if (isEndedStateKey(states)) {
    return isWrapupPending(agentParticipant) ? 'wrapup' : 'unknown';
  }

  if (states.includes('connect') || states.includes('contact') || states.includes('talk')) return 'connected';

  return 'unknown';
}

// Accepte aussi bien un participant Genesys brut que notre objet interaction
// normalise: dans les deux cas, « un code est-il encore attendu ? ».
export function isWrapupRequiredValue(source, fallback = {}) {
  return Boolean(
    source?.wrapupRequired ??
    source?.wrapUpRequired ??
    source?.wrapup?.required ??
    source?.wrapUp?.required ??
    fallback?.wrapupRequired ??
    fallback?.wrapUpRequired ??
    false
  );
}

export function isWrapupPending(source) {
  return Boolean(
    isWrapupRequiredValue(source) &&
    !source?.wrapupSubmitted &&
    !source?.wrapup?.code &&
    !source?.wrapupCode
  );
}

// Liste noire plutot que liste blanche: un mediaType inattendu ne doit pas
// faire disparaitre un appel voix de la PiP.
function isVoiceInteraction(interaction, type) {
  if (type === 'screenPop') return true;

  const mediaType = normalizeKey(interaction.mediaType || interaction.type || interaction.communicationType || '');
  if (!mediaType) return true;
  if (mediaType.includes('call') || mediaType.includes('voice')) return true;

  return !NON_VOICE_MEDIA.some((media) => mediaType.includes(media));
}

function findAgentParticipant(conversation, userId) {
  const participants = Array.isArray(conversation?.participants) ? conversation.participants : [];
  const agents = participants.filter((participant) => {
    const purpose = normalizeKey(participant.purpose);
    return purpose === 'agent' || purpose === 'user';
  });

  if (!agents.length) return null;

  const active = agents.filter((participant) => getParticipantCommunications(participant).some(isActiveCommunication));
  const pool = active.length ? active : agents;

  if (userId) {
    const mine = pool.find((participant) => participant.userId === userId || participant.user?.id === userId);
    if (mine) return mine;
  }

  return pool[pool.length - 1];
}

function findBestCommunication(participant) {
  const candidates = getParticipantCommunications(participant);
  return candidates.find(isActiveCommunication) || candidates.find((item) => item.state) || candidates[0] || null;
}

function getParticipantCommunications(participant) {
  if (!participant) return [];
  return [
    ...(Array.isArray(participant.calls) ? participant.calls : []),
    ...(Array.isArray(participant.sessions) ? participant.sessions : []),
    ...(Array.isArray(participant.callbacks) ? participant.callbacks : [])
  ];
}

function isActiveCommunication(communication) {
  const state = normalizeKey(communication?.state || communication?.disconnectType);
  return Boolean(state) && !isEndedStateKey(state);
}

function isExplicitlyEndedCommunication(communication) {
  const state = normalizeKey(communication?.state || communication?.disconnectType);
  return Boolean(state) && isEndedStateKey(state);
}

function getAllCommunications(conversation) {
  const participants = Array.isArray(conversation?.participants) ? conversation.participants : [];
  return participants.flatMap(getParticipantCommunications);
}

// Debut de l'appel pour le chrono. `connectedTime` est la valeur utile une fois
// l'appel decroche; avant, on se rabat sur l'heure d'offre du leg agent.
function findInteractionStartTime(conversation, agentParticipant, agentCommunication) {
  const candidates = [
    agentCommunication?.connectedTime,
    agentParticipant?.connectedTime,
    agentCommunication?.startTime,
    agentParticipant?.startTime,
    conversation?.startTime
  ];

  for (const candidate of candidates) {
    const time = parseTimestamp(candidate);
    if (time) return time;
  }

  return null;
}

// La file peut etre portee par n'importe quel participant selon le type de
// routage (ACD, transfert, consultation), d'ou le balayage complet.
function findQueueName(conversation, agentParticipant, customerParticipant) {
  const direct = agentParticipant?.queueName || agentParticipant?.queue?.name || agentParticipant?.queue?.label ||
    customerParticipant?.queueName || customerParticipant?.queue?.name || customerParticipant?.queue?.label ||
    conversation?.queueName || conversation?.queue?.name || conversation?.queue?.label;

  if (direct) return direct;

  const participants = Array.isArray(conversation?.participants) ? conversation.participants : [];
  for (const participant of participants) {
    const queueName = participant?.queueName || participant?.queue?.name || participant?.queue?.label;
    if (queueName) return queueName;
  }

  return '';
}

function findQueueId(conversation, agentParticipant, customerParticipant) {
  const direct = agentParticipant?.queueId || agentParticipant?.queue?.id ||
    customerParticipant?.queueId || customerParticipant?.queue?.id ||
    conversation?.queueId || conversation?.queue?.id;

  if (direct) return direct;

  const participants = Array.isArray(conversation?.participants) ? conversation.participants : [];
  for (const participant of participants) {
    const queueId = participant?.queueId || participant?.queue?.id;
    if (queueId) return queueId;
  }

  return null;
}

function applyPendingActionToInteraction(interaction, actionInProgress) {
  if (!interaction || actionInProgress?.id !== interaction.id) return interaction;

  if (actionInProgress.action === 'pickup') return { ...interaction, phase: 'connected', state: 'connected' };
  if (actionInProgress.action === 'hold') return { ...interaction, phase: 'held', state: 'held' };
  if (actionInProgress.action === 'resume') return { ...interaction, phase: 'connected', state: 'connected' };

  return interaction;
}

function mergeParticipantData(previousRows = [], nextRows = []) {
  return uniqueBy([...previousRows, ...nextRows], (row) => `${row.rawKey || row.key}::${row.value}`);
}
