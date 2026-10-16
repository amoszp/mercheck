import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import Dock from './components/Dock.jsx';
import ListCard from './components/ListCard.jsx';
import SettingsMenu from './components/SettingsMenu.jsx';
import Toast from './components/Toast.jsx';
import { useLists } from './lib/useLists.js';
import { useSettings } from './lib/settings.js';

const cardTransition = { type: 'spring', stiffness: 260, damping: 28 };

function App({ user, initialState, onSignOut, onSignedOut }) {
  const lists = useLists(initialState, onSignedOut);
  const { data, toast, dismissToast, runUndo, addList } = lists;
  const [settings, updateSettings] = useSettings();

  const [activeIndex, setActiveIndex] = useState(0);
  const [newListId, setNewListId] = useState(null);

  const carouselRef = useRef(null);

  const totalCards = data.lists.length + 1; // every list + the "new list" card
  const active = Math.min(activeIndex, totalCards - 1);
  const stepRef = useRef({ active, last: totalCards - 1 });
  stepRef.current = { active, last: totalCards - 1 };

  const updateActive = useCallback(() => {
    const el = carouselRef.current;
    if (!el) return;
    const center = el.scrollLeft + el.clientWidth / 2;
    let closest = 0;
    let minDistance = Infinity;
    Array.from(el.children).forEach((card, index) => {
      const distance = Math.abs(center - (card.offsetLeft + card.offsetWidth / 2));
      if (distance < minDistance) {
        minDistance = distance;
        closest = index;
      }
    });
    setActiveIndex(closest);
  }, []);

  const scrollToIndex = useCallback((index) => {
    const el = carouselRef.current;
    const card = el?.children[index];
    if (!card) return;
    el.scrollTo({
      left: card.offsetLeft - (el.clientWidth - card.offsetWidth) / 2,
      behavior: 'smooth',
    });
  }, []);

  useEffect(() => {
    const el = carouselRef.current;
    if (!el) return undefined;
    el.addEventListener('scroll', updateActive, { passive: true });
    window.addEventListener('resize', updateActive);
    return () => {
      el.removeEventListener('scroll', updateActive);
      window.removeEventListener('resize', updateActive);
    };
  }, [updateActive]);

  // Cards were added/removed: re-evaluate which one is centred.
  useEffect(updateActive, [data.lists.length, updateActive]);

  // A freshly created list scrolls into view (its title is already in edit mode).
  useEffect(() => {
    if (!newListId) return;
    const index = data.lists.findIndex((list) => list.id === newListId);
    if (index !== -1) scrollToIndex(index);
    setNewListId(null);
  }, [newListId, data.lists, scrollToIndex]);

  // Move one card left/right from wherever the carousel currently is.
  const stepBy = useCallback(
    (delta) => {
      const target = Math.min(Math.max(stepRef.current.active + delta, 0), stepRef.current.last);
      scrollToIndex(target);
    },
    [scrollToIndex],
  );

  // Left / right arrows flip between lists on desktop (unless typing).
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return;
      if (e.key === 'ArrowLeft') stepBy(-1);
      if (e.key === 'ArrowRight') stepBy(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [stepBy]);

  // A plain mouse wheel only scrolls vertically, so it flips between lists
  // unless the pointer is over a list that can itself scroll. Horizontal input
  // (trackpad, shift+wheel, touch) is left to the browser's native scrolling.
  useEffect(() => {
    const el = carouselRef.current;
    if (!el) return undefined;
    let lockedUntil = 0;
    const onWheel = (e) => {
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      const list = e.target.closest?.('ul');
      if (list && list.scrollHeight > list.clientHeight) return;
      e.preventDefault();
      const now = performance.now();
      if (now < lockedUntil) return; // one step per wheel burst
      lockedUntil = now + 450;
      stepBy(e.deltaY > 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [stepBy]);

  const handleAddList = () => setNewListId(addList());

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden">
      <div className="aurora" aria-hidden>
        <i />
        <i />
        <i />
      </div>

      {/* -mb-6: the footer overlaps the carousel's bottom padding, which exists
          only so the cards' drop shadows aren't clipped by the scroller. */}
      <main className="relative z-10 -mb-6 min-h-0 flex-1 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <div
          ref={carouselRef}
          style={{
            '--card-w': 'min(88vw, 24rem)',
            paddingInline: 'calc((100% - var(--card-w)) / 2)',
          }}
          className="relative flex h-full snap-x snap-mandatory items-stretch gap-4 overflow-x-auto overscroll-x-contain pb-10 pt-3 scrollbar-none"
        >
          {data.lists.map((list, index) => (
            <ListCard
              key={list.id}
              list={list}
              isActive={index === active}
              autoEdit={list.id === newListId}
              showQuantity={settings.showQuantity}
              actions={lists}
            />
          ))}

          <motion.button
            type="button"
            onClick={handleAddList}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: active === data.lists.length ? 1 : 0.5, y: 0 }}
            transition={cardTransition}
            className="flex h-full w-[var(--card-w)] shrink-0 snap-center flex-col items-center justify-center gap-3 rounded-[28px] border border-dashed border-fg/20 bg-fg/[0.03] text-fg/60 transition-colors hover:bg-fg/[0.06] hover:text-fg"
          >
            <span className="glass flex h-14 w-14 items-center justify-center rounded-full">
              <Plus size={26} strokeWidth={1.75} />
            </span>
            <span className="text-sm font-medium">New list</span>
          </motion.button>
        </div>
      </main>

      <footer className="relative z-10 flex items-center justify-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-1">
        <Dock lists={data.lists} activeIndex={active} onSelect={scrollToIndex} />
        <SettingsMenu settings={settings} onChange={updateSettings} user={user} onSignOut={onSignOut} />
      </footer>

      <Toast toast={toast} onUndo={runUndo} onDismiss={dismissToast} />
    </div>
  );
}

export default App;
