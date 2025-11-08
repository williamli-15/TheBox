import { useEffect, useState, type CSSProperties } from 'react';
import { gameState } from '@/Core/gameState';

interface GameMeta {
  slug: string;
  name: string;
  author: string;
  cover: string;
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
  playButton: {
    marginTop: '16px',
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
};

export function Gallery({ onGameSelect }: GalleryProps) {
  const [games, setGames] = useState<GameMeta[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/games.json')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to load games.json (${res.status})`);
        }
        return res.json();
      })
      .then((data: GameMeta[]) => {
        setGames(data);
      })
      .catch((err) => {
        console.error('Failed to load games.json:', err);
        setError('无法加载游戏列表，请检查 public/games.json。');
      });
  }, []);

  const handleSelect = (slug: string) => {
    gameState.activeGameSlug = slug;
    try {
      sessionStorage.setItem('activeGameSlug', slug);
    } catch (err) {
      console.warn('Failed to persist activeGameSlug', err);
    }
    onGameSelect(slug);
  };

  return (
    <div style={galleryStyles.root}>
      <div>
        <h1 style={{ margin: 0, fontSize: '32px' }}>WebGAL 游戏画廊</h1>
        <p style={{ margin: '8px 0 0', color: 'rgba(248,250,252,0.7)' }}>选择一个故事开始体验</p>
      </div>
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
        ))}
        {games.length === 0 && !error && <div>暂时没有可用的游戏，请检查 public/games 目录。</div>}
      </div>
    </div>
  );
}
