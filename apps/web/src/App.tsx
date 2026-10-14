import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { ContextMenu } from './components/ContextMenu';
import { DetailDrawer } from './components/DetailDrawer';
import { Hud } from './components/Hud';
import { LeftPanel } from './components/LeftPanel';
import { MobileSheet } from './components/MobileSheet';
import { RightPanel } from './components/RightPanel';
import { ShortcutSheet } from './components/ShortcutSheet';
import { Timeline } from './components/Timeline';
import { TopBar } from './components/TopBar';
import { CardLayer } from './globe/CardLayer';
import { GlobeView } from './globe/GlobeView';
import { useMedia } from './hooks/useMedia';
import { useShortcuts } from './hooks/useShortcuts';
import { connectDemo, DEMO } from './lib/demo';
import { connectStream } from './lib/stream';
import { useStore } from './store/useStore';

export function App() {
  const mobile = useMedia('(max-width: 767px)');
  const leftOpen = useStore((s) => s.settings.leftOpen);
  const rightOpen = useStore((s) => s.settings.rightOpen);
  const maxCardsCfg = useStore((s) => s.flowConfig.maxVisibleCards);
  const [cursor, setCursor] = useState<{ lat: number; lng: number } | null>(null);
  useShortcuts();

  useEffect(() => (DEMO ? connectDemo() : connectStream()), []);
  useEffect(() => {
    const t = setInterval(() => useStore.getState().tick(), 1000);
    return () => clearInterval(t);
  }, []);

  const maxCards = mobile ? Math.min(4, maxCardsCfg) : maxCardsCfg;

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="relative flex min-h-0 flex-1">
        <AnimatePresence initial={false}>
          {!mobile && leftOpen && (
            <motion.aside
              key="left"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 264, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="relative z-20 shrink-0 overflow-hidden border-r border-line bg-panel"
            >
              <div className="h-full w-[264px]">
                <LeftPanel />
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
        <main className="relative min-w-0 flex-1 overflow-hidden">
          <GlobeView maxCards={maxCards} onCursor={setCursor} />
          <CardLayer maxCards={maxCards} compact={mobile} />
          <Hud cursor={cursor} />
          <DetailDrawer />
          {mobile && <MobileSheet />}
        </main>
        <AnimatePresence initial={false}>
          {!mobile && rightOpen && (
            <motion.aside
              key="right"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 340, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="relative z-20 shrink-0 overflow-hidden border-l border-line bg-panel"
            >
              <div className="h-full w-[340px]">
                <RightPanel />
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
      {!mobile && <Timeline />}
      <ContextMenu />
      <ShortcutSheet />
    </div>
  );
}
