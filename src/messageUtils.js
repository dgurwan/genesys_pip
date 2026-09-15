// Utilities for messages exchanged between an integration adapter and the
// extension core. Keeping this here prevents app.js from depending directly
// on any concrete transport such as GenesysBridge.
export function parseWindowMessage(event) {
  try {
    return typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
  } catch {
    return null;
  }
}
