export const DEFAULT_GAME_SLUG = 'defaultgame';

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
