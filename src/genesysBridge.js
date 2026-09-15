// Bus de messages entre la page de l'extension et framework.js, qui tourne
// dans l'iframe Genesys. Tout acces a l'API Genesys reste dans framework.js:
// ici on ne fait que poster des messages typés `genesys:*`.
//
// Chaque methode correspond a un message ecoute par framework.js.
export class GenesysBridge {
  constructor(iframe) {
    this.iframe = iframe;
  }

  send(type, data = {}) {
    if (!this.iframe?.contentWindow) return;

    this.iframe.contentWindow.postMessage(JSON.stringify({ type, data }), '*');
  }

  ping() {
    this.send('genesys:ping');
  }

  requestPresenceDefinitions() {
    this.send('genesys:presence:getDefinitions');
    this.send('genesys:notifications:setup');
  }

  updatePresence(statusId) {
    this.send('genesys:user:updateStatus', { id: statusId });
  }

  updateInteractionState(interactionId, action) {
    // Le framework Genesys utilise 'hold' comme bascule pause/reprise.
    const frameworkAction = action === 'resume' ? 'hold' : action;
    this.send('genesys:interaction:updateState', { id: interactionId, action: frameworkAction });
  }

  requestMakeEligibleForInteractions() {
    this.send('genesys:user:makeEligibleForInteractions');
  }

  requestWrapupCodes({ conversationId, participantId, queueId }) {
    this.send('genesys:wrapup:getCodes', { conversationId, participantId, queueId });
  }

  submitWrapup({ conversationId, participantId, codeId, notes }) {
    this.send('genesys:wrapup:submit', {
      conversationId,
      participantId,
      codeId,
      notes: notes || ''
    });
  }
}

