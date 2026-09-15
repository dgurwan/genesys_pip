import { IntegrationAdapter } from './integrationAdapter.js';

/**
 * Extension point for a future Genesys Composable Desktop integration.
 *
 * This adapter is intentionally NOT wired as the default. The current
 * production path remains Embeddable Framework, while the core application
 * can already depend on the adapter contract rather than on GenesysBridge.
 */
export class ComposableDesktopAdapter extends IntegrationAdapter {
  constructor() {
    super({
      id: 'composable-desktop',
      displayName: 'Genesys Composable Desktop'
    });
  }
}
