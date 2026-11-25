/**
 * AquaSmart Irrigation — Firebase Cloud Configuration
 *
 * HOW TO CONNECT YOUR LIVE FIREBASE PROJECT:
 * 1. Go to https://console.firebase.google.com and create a free project.
 * 2. In the left sidebar, click "Build" -> "Realtime Database" -> "Create Database".
 * 3. Run `./deploy.sh <your-project-id> <your-rtdb-url>` (which automatically bakes your
 *    Realtime Database URL into DEFAULT_FIREBASE_CONFIG below before deploying), OR paste
 *    it directly into the Main Operator Console -> "Firebase Realtime Cloud Database" card.
 */

const STORAGE_KEY_FIREBASE = 'aquasmart_firebase_config_v1';

export const DEFAULT_FIREBASE_CONFIG = {
  // Automatically populated by ./deploy.sh (or paste your RTDB URL here):
  databaseUrl: 'https://aquasmart-b982b-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'aquasmart-b982b',
  defaultMachineId: 'AQ-ESP32-001',
  defaultDeviceName: 'AquaSmart Irrigation #1',
  pollIntervalMs: 2000,
};

function inferHostedDatabaseUrl() {
  if (typeof window === 'undefined' || !window.location) return '';
  const host = String(window.location.hostname || '').toLowerCase();
  if (host.endsWith('.web.app') || host.endsWith('.firebaseapp.com')) {
    const projectSlug = host.split('.')[0];
    if (projectSlug && projectSlug !== 'localhost') {
      return `https://${projectSlug}-default-rtdb.firebaseio.com`;
    }
  }
  return '';
}

export function getFirebaseConfig() {
  const fallbackUrl =
    String(DEFAULT_FIREBASE_CONFIG.databaseUrl || '').trim() || inferHostedDatabaseUrl();

  try {
    const raw = localStorage.getItem(STORAGE_KEY_FIREBASE);
    if (raw) {
      const parsed = JSON.parse(raw);
      const effectiveUrl = String(parsed.databaseUrl || fallbackUrl)
        .trim()
        .replace(/\/+$/, '');
      return {
        ...DEFAULT_FIREBASE_CONFIG,
        ...parsed,
        databaseUrl: effectiveUrl,
      };
    }
  } catch (_) {
    // ignore storage errors
  }

  return {
    ...DEFAULT_FIREBASE_CONFIG,
    databaseUrl: fallbackUrl.replace(/\/+$/, ''),
  };
}

export function saveFirebaseConfig(partial) {
  const current = getFirebaseConfig();
  const nextUrl =
    partial.databaseUrl !== undefined
      ? String(partial.databaseUrl).trim().replace(/\/+$/, '')
      : current.databaseUrl;

  const updated = {
    ...current,
    ...partial,
    databaseUrl: nextUrl,
  };
  try {
    localStorage.setItem(STORAGE_KEY_FIREBASE, JSON.stringify(updated));
  } catch (_) {
    // ignore storage errors
  }
  return updated;
}

export function isFirebaseCloudConfigured() {
  const cfg = getFirebaseConfig();
  return Boolean(cfg.databaseUrl && /^https?:\/\/.+/i.test(cfg.databaseUrl));
}
