// Petites fonctions sans dependance, reutilisees partout.
// normalizeKey() est la plus importante: "ON_QUEUE", "On Queue" et "on-queue"
// deviennent tous "onqueue", ce qui rend les comparaisons Genesys fiables.

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function normalizeFilter(value) {
  return String(value || '').trim().toLowerCase();
}

export function titleCase(value) {
  return String(value || '')
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

// Duree d'appel: mm:ss, et h:mm:ss au-dela d'une heure.
export function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor((milliseconds || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => String(value).padStart(2, '0');

  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

// Genesys renvoie des dates ISO-8601. On les convertit en millisecondes, et on
// ignore silencieusement ce qui n'est pas exploitable.
export function parseTimestamp(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function uniqueBy(list, keyFn) {
  const seen = new Set();
  return list.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
