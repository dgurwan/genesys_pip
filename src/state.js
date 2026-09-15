// Etat unique de l'application. Tout ce qui s'affiche dans la PiP vient d'ici,
// et seul app.js le modifie: pour comprendre l'interface, lire cet objet.

import { DEFAULT_SETTINGS } from './constants.js';

export function createInitialState() {
  return {
    pipWindow: null,
    frameworkReady: false,
    frameworkPingInterval: null,
    frameworkPingAttempts: 0,

    settings: { ...DEFAULT_SETTINGS },

    agentStatus: {
      label: 'Inconnu',
      id: null,
      systemPresence: null,
      raw: null
    },

    presence: {
      // false jusqu'au premier statut recu de Genesys: avant, on affiche
      // « Chargement » plutot qu'un statut invente.
      loaded: false,
      grouped: [],
      queue: { onQueue: null, offQueue: null },
      selectedPrimary: '',
      expandedPrimary: '',
      menuOpen: false,
      updating: false,
      error: null,
      lastOffQueue: null,
      queueState: 'off'
    },

    notifications: {
      ready: false,
      error: null
    },

    interaction: null,
    interactionAction: null,
    interactionActionTimer: null,
    // Panneau « Donnees d'appel » replie par defaut, et intervalle du chrono.
    callDataOpen: false,
    callTimerInterval: null,
    // id de conversation -> timestamp de fin. Un TTL evite d'ignorer
    // definitivement une conversation re-proposee au meme agent.
    endedInteractions: new Map(),

    wrapup: {
      loading: false,
      submitting: false,
      // true quand un code a ete choisi avant le clic sur Raccrocher: il sera
      // envoye une fois le participant deconnecte.
      sendAfterDisconnect: false,
      error: null,
      codes: [],
      selectedCodeId: '',
      notes: '',
      loadedForInteractionId: null
    },

    routing: {
      userId: null,
      status: null,
      noAnswer: false,
      updatePending: false,
      error: null
    }
  };
}
