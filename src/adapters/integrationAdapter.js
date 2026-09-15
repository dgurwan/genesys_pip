// Contrat minimal commun a tous les modes d'integration de PiP.
// Le coeur de l'extension ne doit dependre ni de l'Embeddable Framework,
// ni d'un futur autre desktop/integration.
export class IntegrationAdapter {
  constructor({ id, displayName }) {
    this.id = id;
    this.displayName = displayName;
  }

  ping() {
    throw new Error(`${this.displayName}: ping() is not implemented`);
  }

  requestPresenceDefinitions() {
    throw new Error(`${this.displayName}: requestPresenceDefinitions() is not implemented`);
  }

  updatePresence() {
    throw new Error(`${this.displayName}: updatePresence() is not implemented`);
  }

  updateInteractionState() {
    throw new Error(`${this.displayName}: updateInteractionState() is not implemented`);
  }

  requestMakeEligibleForInteractions() {
    throw new Error(`${this.displayName}: requestMakeEligibleForInteractions() is not implemented`);
  }

  requestWrapupCodes() {
    throw new Error(`${this.displayName}: requestWrapupCodes() is not implemented`);
  }

  submitWrapup() {
    throw new Error(`${this.displayName}: submitWrapup() is not implemented`);
  }

  normalizeInboundMessage(message) {
    return message;
  }
}
