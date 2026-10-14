import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from '../store/useStore';

const KEYS: [string, string][] = [
  ['Space', 'Pause / resume the flow'],
  ['F', 'Focus mode on the region in view'],
  ['/', 'Search'],
  ['[', 'Toggle Layers & Filters'],
  [']', 'Toggle Live Feed'],
  ['Esc', 'Close drawer · reset view'],
  ['?', 'This sheet'],
  ['Drag · Scroll', 'Rotate · Zoom'],
  ['Double-click', 'Zoom into a region'],
  ['Right-click card', 'Pin · mute outlet / type / category / region'],
];

export function ShortcutSheet() {
  const open = useStore((s) => s.shortcutsOpen);
  const set = useStore((s) => s.setShortcuts);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50"
          onClick={() => set(false)}
        >
          <motion.div
            initial={{ y: 8 }}
            animate={{ y: 0 }}
            className="brackets w-[min(420px,92vw)] border border-line bg-panel p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="br-b" />
            <h2 className="micro mb-3">Keyboard shortcuts</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2">
              {KEYS.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="mono text-[11.5px] text-amber">{k}</dt>
                  <dd className="text-[12px] text-fg/85">{v}</dd>
                </div>
              ))}
            </dl>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
