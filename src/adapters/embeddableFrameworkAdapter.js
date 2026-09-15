import { IntegrationAdapter } from './integrationAdapter.js';
import { GenesysBridge } from '../genesysBridge.js';

/**
 * Integration adapter for the Genesys Cloud Embeddable Framework.
 *
 * framework.js is uploaded to the Genesys integration and runs inside the
 * Genesys iframe. GenesysBridge is the transport used by the Chrome extension
 * to send commands to that framework through postMessage.
 */
export class EmbeddableFrameworkAdapter extends IntegrationAdapter {
  constructor(iframe) {
    super({
      id: 'embeddable-framework',
      displayName: 'Genesys Cloud Embeddable Framework'
    });

    this.iframe = iframe;
    this.bridge = new GenesysBridge(iframe);
  }

  ping() {
    this.bridge.ping();
  }

  requestPresenceDefinitions() {
    this.bridge.requestPresenceDefinitions();
  }

  updatePresence(statusId) {
    this.bridge.updatePresence(statusId);
  }

  updateInteractionState(interactionId, action) {
    this.bridge.updateInteractionState(interactionId, action);
  }

  requestMakeEligibleForInteractions() {
    this.bridge.requestMakeEligibleForInteractions();
  }

  requestWrapupCodes(payload) {
    this.bridge.requestWrapupCodes(payload);
  }

  submitWrapup(payload) {
    this.bridge.submitWrapup(payload);
  }
}
