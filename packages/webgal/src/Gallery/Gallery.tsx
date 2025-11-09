import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { gameState, getRuntimeSessionId, SESSION_HEADER } from '@/Core/gameState';

interface GameMeta {
  slug: string;
  name: string;
  author: string;
  cover: string;
  brief?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface GalleryProps {
  onGameSelect: (slug: string) => void;
}

const galleryStyles: Record<string, CSSProperties> = {
  root: {
    width: '100%',
    height: '100%',
    padding: '32px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
    background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #312e81 100%)',
    color: '#f8fafc',
  },
  list: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '24px',
    width: '100%',
  },
  card: {
    background: 'rgba(15, 23, 42, 0.85)',
    borderRadius: '16px',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    border: '1px solid rgba(248, 250, 252, 0.08)',
    boxShadow: '0 20px 45px rgba(15, 23, 42, 0.45)',
    cursor: 'pointer',
    transition: 'transform 0.25s ease, box-shadow 0.25s ease',
  },
  cardImage: {
    width: '100%',
    height: '200px',
    objectFit: 'cover',
    background: '#020617',
  },
  cardBody: {
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  promptCard: {
    background: 'rgba(15, 23, 42, 0.7)',
    borderRadius: '16px',
    padding: '20px',
    border: '1px solid rgba(248, 250, 252, 0.12)',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  promptInput: {
    width: '100%',
    padding: '10px 14px',
    borderRadius: '12px',
    border: '1px solid rgba(248,250,252,0.2)',
    background: 'rgba(2,6,23,0.6)',
    color: '#f8fafc',
    fontSize: '14px',
  },
  promptTextarea: {
    width: '100%',
    minHeight: '96px',
    padding: '12px 14px',
    borderRadius: '12px',
    border: '1px solid rgba(248,250,252,0.2)',
    background: 'rgba(2,6,23,0.6)',
    color: '#f8fafc',
    resize: 'vertical',
    fontSize: '14px',
  },
  buttonRow: {
    marginTop: '16px',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
  },
  playButton: {
    padding: '10px 16px',
    borderRadius: '999px',
    border: 'none',
    background: '#22d3ee',
    color: '#0f172a',
    fontWeight: 600,
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  generateButton: {
    padding: '10px 16px',
    borderRadius: '999px',
    border: '1px solid rgba(248, 250, 252, 0.4)',
    background: 'transparent',
    color: '#e2e8f0',
    fontWeight: 600,
    cursor: 'pointer',
    letterSpacing: '0.02em',
  },
  status: {
    padding: '12px 16px',
    borderRadius: '12px',
    background: 'rgba(15,23,42,0.6)',
    border: '1px solid rgba(34,211,238,0.3)',
  },
  statusError: {
    padding: '12px 16px',
    borderRadius: '12px',
    background: 'rgba(127,29,29,0.65)',
    border: '1px solid rgba(248,113,113,0.4)',
  },
};

export function Gallery({ onGameSelect }: GalleryProps) {
  const [games, setGames] = useState<GameMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [bootstrapSlug, setBootstrapSlug] = useState<string | null>(null);
  const [bootstrapStatus, setBootstrapStatus] = useState<string | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [playerTitle, setPlayerTitle] = useState('');
  const [playerBrief, setPlayerBrief] = useState('');
  const sessionId = useMemo(() => getRuntimeSessionId(), []);
  const [ideaError, setIdeaError] = useState<string | null>(null);

  const refreshGames = useCallback(async () => {
    try {
      const res = await fetch('/api/games');
      if (!res.ok) {
        throw new Error(`Failed to load /api/games (${res.status})`);
      }
      const payload = await res.json();
      if (!payload?.ok || !Array.isArray(payload.games)) {
        throw new Error('Invalid /api/games response');
      }
      setGames(payload.games);
      setError(null);
      return;
    } catch (apiErr) {
      console.warn('Failed to load /api/games, falling back to games.json', apiErr);
    }
    try {
      const res = await fetch('/games.json');
      if (!res.ok) {
        throw new Error(`Failed to load games.json (${res.status})`);
      }
      const data = await res.json();
      if (!Array.isArray(data)) {
        throw new Error('Invalid games.json format');
      }
      setGames(data);
      setError(null);
    } catch (err) {
      console.error('Failed to load games list:', err);
      setError('无法加载游戏列表，请检查 public/games.json。');
    }
  }, []);

  useEffect(() => {
    void refreshGames();
  }, [refreshGames]);

  const handleSelect = (slug: string) => {
    gameState.activeGameSlug = slug;
    try {
      sessionStorage.setItem('activeGameSlug', slug);
    } catch (err) {
      console.warn('Failed to persist activeGameSlug', err);
    }
    onGameSelect(slug);
  };

  const askForIdeas = async () => {
    setIdeaError(null);
    try {
      const res = await fetch('/api/lobby/idea', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [SESSION_HEADER]: sessionId,
        },
        body: JSON.stringify({ hints: playerBrief || playerTitle }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok || !data.idea) {
        throw new Error(data?.error || `服务器错误 ${res.status}`);
      }
      setPlayerTitle(data.idea.title || '');
      setPlayerBrief(data.idea.brief || '');
    } catch (err) {
      setIdeaError(err instanceof Error ? err.message : '灵感生成失败');
    }
  };

  const requestBootstrap = async (templateSlug?: string) => {
    setBootstrapSlug(templateSlug ?? null);
    setBootstrapStatus('正在生成 AI 剧情，请稍候…');
    setBootstrapError(null);
    try {
      const requestBody: Record<string, string> = {};
      if (playerTitle.trim()) {
        requestBody.title = playerTitle.trim();
      }
      if (playerBrief.trim()) {
        requestBody.brief = playerBrief.trim();
      }
      if (templateSlug) {
        requestBody.slug = templateSlug;
      }
      const res = await fetch('/api/lobby/bootstrap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [SESSION_HEADER]: sessionId,
        },
        body: JSON.stringify(requestBody),
      });
      let responseBody: any = null;
      try {
        responseBody = await res.json();
      } catch {
        // ignore JSON parse failure; handled below
      }
      if (!res.ok || !responseBody?.ok) {
        const message = responseBody?.error || `服务器错误 ${res.status}`;
        throw new Error(message);
      }
      setBootstrapStatus('生成完成，正在进入游戏…');
      const nextSlug = responseBody.slug;
      if (nextSlug && typeof nextSlug === 'string') {
        await refreshGames();
        handleSelect(nextSlug);
      }
    } catch (err) {
      console.error('Failed to bootstrap story', err);
      setBootstrapError(err instanceof Error ? err.message : '生成失败，请稍后重试。');
      setBootstrapStatus(null);
    } finally {
      setBootstrapSlug(null);
    }
  };

  return (
    <div style={galleryStyles.root}>
      <div>
        <h1 style={{ margin: 0, fontSize: '32px' }}>WebGAL 游戏画廊</h1>
        <p style={{ margin: '8px 0 0', color: 'rgba(248,250,252,0.7)' }}>选择一个故事开始体验</p>
      </div>
      <div style={galleryStyles.promptCard}>
        <div style={{ display: 'flex', gap: '12px', flexDirection: 'column' }}>
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>想要的标题（可选）</label>
            <input
              style={galleryStyles.promptInput}
              type="text"
              placeholder="例如：『雾墙下的告白』"
              value={playerTitle}
              onChange={(event) => setPlayerTitle(event.target.value)}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
              想玩的风格 / 元素（越具体越好）
            </label>
            <textarea
              style={galleryStyles.promptTextarea}
              placeholder="示例：复古机甲、都市传说、反转爱情线……"
              value={playerBrief}
              onChange={(event) => setPlayerBrief(event.target.value)}
            />
          </div>
          <span style={{ color: 'rgba(248,250,252,0.6)', fontSize: '12px' }}>
            根据你的偏好生成全新副本：填写想法后点击下方“AI 即刻生成”。
          </span>
          {ideaError && (
            <span style={{ color: '#fda4af', fontSize: '12px' }}>灵感获取失败：{ideaError}</span>
          )}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '8px' }}>
            <button
              style={{
                ...galleryStyles.generateButton,
                padding: '10px 16px',
                alignSelf: 'flex-start',
              }}
              type="button"
              onClick={askForIdeas}
            >
              🎲 给点灵感
            </button>
            <button
              style={{
                ...galleryStyles.generateButton,
                padding: '10px 16px',
                alignSelf: 'flex-start',
                background: '#22d3ee',
                color: '#0f172a',
                border: 'none',
                opacity: bootstrapStatus ? 0.7 : 1,
                cursor: bootstrapStatus ? 'not-allowed' : 'pointer',
                fontWeight: 600,
              }}
              type="button"
              disabled={Boolean(bootstrapStatus)}
              onClick={() => requestBootstrap()}
            >
              {bootstrapStatus ? '生成中…' : 'AI 即刻生成'}
            </button>
          </div>
        </div>
      </div>
      {bootstrapStatus && <div style={galleryStyles.status}>{bootstrapStatus}</div>}
      {bootstrapError && <div style={galleryStyles.statusError}>{bootstrapError}</div>}
      {error && <div>{error}</div>}
      <div style={galleryStyles.list}>
        {games.map((game) => (
          <div
            key={game.slug}
            style={galleryStyles.card}
            onClick={() => handleSelect(game.slug)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                handleSelect(game.slug);
              }
            }}
            role="button"
            tabIndex={0}
          >
            <img src={game.cover} alt={game.name} style={galleryStyles.cardImage} />
            <div style={galleryStyles.cardBody}>
              <h2 style={{ margin: 0, fontSize: '22px' }}>{game.name}</h2>
              <span style={{ color: 'rgba(248,250,252,0.7)', fontSize: '14px' }}>作者：{game.author}</span>
              <div style={galleryStyles.buttonRow}>
                <button
                  style={galleryStyles.playButton}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleSelect(game.slug);
                  }}
                >
                  开始游戏
                </button>
              </div>
            </div>
          </div>
        ))}
        {games.length === 0 && !error && <div>暂时没有可用的游戏，请检查 public/games 目录。</div>}
      </div>
    </div>
  );
}
