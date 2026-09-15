import { EmbeddableFrameworkAdapter } from './embeddableFrameworkAdapter.js';
import { ComposableDesktopAdapter } from './composableDesktopAdapter.js';

export function createIntegrationAdapter(kind, iframe) {
  switch (kind) {
    case 'embeddable-framework':
      return new EmbeddableFrameworkAdapter(iframe);
    case 'composable-desktop':
      return new ComposableDesktopAdapter();
    default:
      throw new Error(`Unsupported integration adapter: ${kind}`);
  }
}
