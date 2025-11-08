import { useState } from 'react';
import { initializeScript } from '@/Core/initializeScript';
import Translation from '@/UI/Translation/Translation';
import { Stage } from '@/Stage/Stage';
import { BottomControlPanel } from '@/UI/BottomControlPanel/BottomControlPanel';
import { BottomControlPanelFilm } from '@/UI/BottomControlPanel/BottomControlPanelFilm';
import { Backlog } from '@/UI/Backlog/Backlog';
import Title from '@/UI/Title/Title';
import Logo from '@/UI/Logo/Logo';
import { Extra } from '@/UI/Extra/Extra';
import Menu from '@/UI/Menu/Menu';
import GlobalDialog from '@/UI/GlobalDialog/GlobalDialog';
import PanicOverlay from '@/UI/PanicOverlay/PanicOverlay';
import DevPanel from '@/UI/DevPanel/DevPanel';
import { Gallery } from '@/Gallery/Gallery';
import { gameState } from '@/Core/gameState';

export default function App() {
  const [view, setView] = useState<'gallery' | 'game'>('gallery');
  const [hasStarted, setHasStarted] = useState(false);

  const handleGameStart = (slug: string) => {
    gameState.activeGameSlug = slug;
    if (!hasStarted) {
      initializeScript();
      setHasStarted(true);
    }
    setView('game');
  };

  if (view === 'gallery') {
    return <Gallery onGameSelect={handleGameStart} />;
  }

  return (
    <div className="App">
      <Translation />
      <Stage />
      <BottomControlPanel />
      <BottomControlPanelFilm />
      <Backlog />
      <Title />
      <Logo />
      <Extra />
      <Menu />
      <GlobalDialog />
      <PanicOverlay />
      <DevPanel />
    </div>
  );
}
