// Icones SVG inline utilisees par les boutons de la PiP.
// Inline (et non des fichiers) car la fenetre PiP n'a pas d'URL de base propre.

export const Icons = Object.freeze({
  answer: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8c1.8 3.6 3.9 5.7 7.6 7.6l2.5-2.5c.3-.3.8-.4 1.2-.3 1.3.4 2.7.6 4.1.6.6 0 1 .4 1 1V21c0 .6-.4 1-1 1C10.9 22 2 13.1 2 2c0-.6.4-1 1-1h3.8c.6 0 1 .4 1 1 0 1.4.2 2.8.6 4.1.1.4 0 .9-.3 1.2l-2.5 2.5Z"/></svg>',
  hangup: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8c3.4 0 6.6.8 9.4 2.3.5.3.7.9.5 1.4l-1.4 3.1c-.2.5-.8.7-1.3.5l-3.4-1.1c-.4-.1-.7-.5-.7-1v-1.5c-2-.5-4.1-.5-6.1 0v1.5c0 .5-.3.9-.7 1l-3.4 1.1c-.5.2-1.1-.1-1.3-.5l-1.4-3.1c-.2-.5 0-1.1.5-1.4C5.4 8.8 8.6 8 12 8Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h3c.6 0 1 .4 1 1v14c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V5c0-.6.4-1 1-1Zm7 0h3c.6 0 1 .4 1 1v14c0 .6-.4 1-1 1h-3c-.6 0-1-.4-1-1V5c0-.6.4-1 1-1Z"/></svg>',
  resume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.6c0-.8.9-1.3 1.6-.9l9.4 6.4c.6.4.6 1.3 0 1.8l-9.4 6.4c-.7.5-1.6 0-1.6-.9V5.6Z"/></svg>',
  reject: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.7 5.3 12 10.6l5.3-5.3 1.4 1.4L13.4 12l5.3 5.3-1.4 1.4L12 13.4l-5.3 5.3-1.4-1.4 5.3-5.3-5.3-5.3 1.4-1.4Z"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 16.2-3.5-3.5L4 14.2l5 5L20 8.2 18.5 6.7 9 16.2Z"/></svg>',
  queue: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7a4 4 0 1 1 8 0A4 4 0 0 1 7 7Zm-4 13c.7-3.5 4-6 8-6s7.3 2.5 8 6H3Zm15-10h4v2h-4v-2Zm0-4h4v2h-4V6Zm0 8h4v2h-4v-2Z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8V4c0-1.1.9-2 2-2h8c1.1 0 2 .9 2 2v8c0 1.1-.9 2-2 2h-4v4c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2v-8c0-1.1.9-2 2-2h4Zm2 0h2c1.1 0 2 .9 2 2v2h4V4h-8v4Zm2 2H4v8h8v-8Z"/></svg>',
  externalLink: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H14V3ZM5 5h6v2H5v12h12v-6h2v6c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V7c0-1.1.9-2 2-2Z"/></svg>',
  folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5c0-1.1.9-2 2-2h5l2 2h7c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V5Zm2 0v12h14V7h-7.8l-2-2H5Z"/></svg>',
  voice: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8c1.8 3.6 3.9 5.7 7.6 7.6l2.5-2.5c.3-.3.8-.4 1.2-.3 1.3.4 2.7.6 4.1.6.6 0 1 .4 1 1V21c0 .6-.4 1-1 1C10.9 22 2 13.1 2 2c0-.6.4-1 1-1h3.8c.6 0 1 .4 1 1 0 1.4.2 2.8.6 4.1.1.4 0 .9-.3 1.2l-2.5 2.5Z"/></svg>',
  message: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h16c1.1 0 2 .9 2 2v11c0 1.1-.9 2-2 2H9l-5 4v-4c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2Zm1 4v2h14V7H5Zm0 4v2h10v-2H5Z"/></svg>',
  endConversation: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h16c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2H9l-5 4v-4c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2Zm2.7 4.3-1.4 1.4L8.6 12l-3.3 3.3 1.4 1.4 3.3-3.3 3.3 3.3 1.4-1.4-3.3-3.3 3.3-3.3-1.4-1.4L10 10.6 6.7 7.3Z"/></svg>',
  email: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2H3c-1.1 0-2-.9-2-2V7c0-1.1.9-2 2-2Zm9 7L3.8 7H3l9 5.5L21 7h-.8L12 12Z"/></svg>',
  callback: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8c1.8 3.6 3.9 5.7 7.6 7.6l2.5-2.5c.3-.3.8-.4 1.2-.3 1.3.4 2.7.6 4.1.6.6 0 1 .4 1 1V21c0 .6-.4 1-1 1C10.9 22 2 13.1 2 2c0-.6.4-1 1-1h3.8c.6 0 1 .4 1 1 0 1.4.2 2.8.6 4.1.1.4 0 .9-.3 1.2l-2.5 2.5Z"/><path d="M14 2h7v7h-2V5.4l-4.3 4.3-1.4-1.4L17.6 4H14V2Z"/></svg>',
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 14.6A8.6 8.6 0 0 1 9.4 3 9 9 0 1 0 21 14.6Z"/></svg>'
});
