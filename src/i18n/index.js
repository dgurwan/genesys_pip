// Traductions de l'interface.
//
// Utilisation: t('action.hangup') renvoie le texte dans la langue courante.
// setLanguage() est appele au demarrage et a chaque changement de reglage.
//
// Pour ajouter une langue: creer le fichier, l'importer, l'ajouter a LANGUAGES.

import fr from './fr.js';
import en from './en.js';

export const LANGUAGES = Object.freeze({ fr, en });

const FALLBACK_LANGUAGE = 'en';
let current = FALLBACK_LANGUAGE;

// 'system' suit la langue du navigateur; toute autre valeur est utilisee telle
// quelle si elle existe, sinon on retombe sur l'anglais.
export function resolveLanguage(setting) {
  if (setting && setting !== 'system' && LANGUAGES[setting]) return setting;

  const browserLanguage = String(navigator.language || '').slice(0, 2).toLowerCase();
  return LANGUAGES[browserLanguage] ? browserLanguage : FALLBACK_LANGUAGE;
}

export function setLanguage(setting) {
  current = resolveLanguage(setting);
  return current;
}


// Une cle absente renvoie la cle elle-meme: le texte manquant est visible dans
// l'interface plutot que remplace par du vide.
export function t(key, values) {
  const dictionary = LANGUAGES[current] || LANGUAGES[FALLBACK_LANGUAGE];
  const template = dictionary[key] ?? LANGUAGES[FALLBACK_LANGUAGE][key] ?? key;

  if (!values) return template;

  return Object.keys(values).reduce(
    (text, name) => text.replaceAll(`{${name}}`, String(values[name])),
    template
  );
}

// Remplit tous les elements porteurs d'un attribut data-i18n dans une page.
// Utilise par app.html et popup.html, qui ont du texte statique.
export function translateDocument(root = document) {
  root.querySelectorAll('[data-i18n-title]').forEach((element) => {
    element.setAttribute('title', t(element.getAttribute('data-i18n-title')));
  });

  root.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.getAttribute('data-i18n'));
  });

  root.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    element.setAttribute('placeholder', t(element.getAttribute('data-i18n-placeholder')));
  });
}
