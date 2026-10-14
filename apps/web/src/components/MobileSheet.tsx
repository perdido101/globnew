import { motion } from 'framer-motion';
import { useState } from 'react';
import { LeftPanel } from './LeftPanel';
import { FeedList } from './RightPanel';

/** Mobile: globe full-screen, feed (and filters) as a bottom sheet. */
export function MobileSheet() {
  const [state, setState] = useState<'peek' | 'open'>('peek');
  const [tab, setTab] = useState<'feed' | 'global' | 'filters'>('feed');
  return (
    <motion.div
      className="absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-[6px] border-t border-line bg-panel"
      animate={{ height: state === 'open' ? '72%' : 96 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={0.15}
      onDragEnd={(_, info) => setState(info.offset.y < -30 ? 'open' : info.offset.y > 30 ? 'peek' : state)}
    >
      <button className="flex justify-center py-2" onClick={() => setState(state === 'open' ? 'peek' : 'open')} aria-label="Toggle feed">
        <span className="h-1 w-9 rounded-full bg-line-2" />
      </button>
      <div className="flex gap-1 border-b border-line px-3 pb-2">
        {(
          [
            ['feed', 'LIVE FEED'],
            ['global', 'GLOBAL'],
            ['filters', 'FILTERS'],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={() => {
              setTab(k);
              setState('open');
            }}
            className={`mono rounded-[2px] px-2 py-1 text-[10px] tracking-[0.1em] ${tab === k ? 'bg-panel-2 text-fg' : 'text-dim'}`}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto" onPointerDownCapture={(e) => e.stopPropagation()}>
        {tab === 'filters' ? <LeftPanel /> : <FeedList lane={tab === 'global' ? 'global' : 'all'} />}
      </div>
    </motion.div>
  );
}
