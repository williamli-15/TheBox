export const DEFAULT_GAME_SLUG = 'defaultgame';
export const SESSION_HEADER = 'X-WebGAL-Session';
const SESSION_STORAGE_KEY = 'webgal.sessionId';
let cachedSessionId: string | null = null;

/**
 * Simple runtime container storing which game is currently active.
 * The slug is used to resolve assets inside public/games/<slug>.
 */
export const gameState = {
  activeGameSlug: DEFAULT_GAME_SLUG,
};

/**
 * Returns the base path (relative to /public) of the active game.
 */
export const getActiveGameBasePath = (): string => `./games/${gameState.activeGameSlug}`;

/**
 * Resolve a relative resource path for the active game.
 * @param subPath path inside the game folder, e.g. `scene/start.txt`
 */
export const getGameAssetPath = (subPath = ''): string => {
  const base = getActiveGameBasePath();
  const normalizedSubPath = subPath.replace(/^\/+/, '');
  return normalizedSubPath.length > 0 ? `${base}/${normalizedSubPath}` : base;
};

function generateSessionId(): string {
  if (typeof window !== 'undefined' && window.crypto && 'randomUUID' in window.crypto) {
    return window.crypto.randomUUID();
  }
  return `wg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readStoredSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return (
      window.localStorage?.getItem(SESSION_STORAGE_KEY) ??
      window.sessionStorage?.getItem(SESSION_STORAGE_KEY) ??
      null
    );
  } catch {
    return null;
  }
}

function persistSessionId(id: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(SESSION_STORAGE_KEY, id);
    window.sessionStorage?.setItem(SESSION_STORAGE_KEY, id);
  } catch {
    // ignore
  }
}

export const getRuntimeSessionId = (): string => {
  if (cachedSessionId) {
    return cachedSessionId;
  }
  const stored = readStoredSessionId();
  if (stored) {
    cachedSessionId = stored;
    return stored;
  }
  cachedSessionId = generateSessionId();
  persistSessionId(cachedSessionId);
  return cachedSessionId;
};
