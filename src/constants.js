export const APP_VERSION = "1.0.0";

// Valeurs fixes du projet: reglages par defaut, taille de la PiP, delais
// d'attente et noms d'actions. Un seul endroit a modifier pour les ajuster.

export const DEFAULT_SETTINGS = Object.freeze({
  participantDataPrefixes: "",
  participantDataHighlightRules: [
    { participantDataName: "", value: "", color: "#E8F4FF", highlightActionEnabled: true, enabled: false, badgeEnabled: false, badge: "", displayEnabled: false, displayField: "", displayLabel: "", allowCopy: false, actionEnabled: false, actionLabel: "", actionUrl: "", actionMode: "quick" },
    { participantDataName: "", value: "", color: "#FFF1D6", highlightActionEnabled: true, enabled: false, badgeEnabled: false, badge: "", displayEnabled: false, displayField: "", displayLabel: "", allowCopy: false, actionEnabled: false, actionLabel: "", actionUrl: "", actionMode: "quick" },
    { participantDataName: "", value: "", color: "#FFE3E3", highlightActionEnabled: true, enabled: false, badgeEnabled: false, badge: "", displayEnabled: false, displayField: "", displayLabel: "", allowCopy: false, actionEnabled: false, actionLabel: "", actionUrl: "", actionMode: "quick" },
  ],
  theme: "light",
  // 'system' = langue du navigateur. Voir src/i18n/index.js.
  language: "system",
});

export const PIP_WINDOW_OPTIONS = Object.freeze({
  width: 380,
  height: 620,
  // PiP provides its own "Back to tab" action. Keep the native Chrome
  // return-to-opener control hidden so there is one clear way back to the
  // original Genesys tab, while leaving the companion open.
  disallowReturnToOpener: true,
});

export const TIMERS = Object.freeze({
  frameworkPingIntervalMs: 1000,
  frameworkMaxPings: 60,
  pickupPendingMs: 1400,
  disconnectPendingMs: 2500,
  holdPendingMs: 1200,
  resumePendingMs: 1200,
  presencePendingMs: 2500,
  wrapupPendingMs: 6000,
  routingPendingMs: 5000,
});

export const INTERACTION_ACTIONS = Object.freeze({
  pickup: "pickup",
  disconnect: "disconnect",
  hold: "hold",
  resume: "resume",
});
