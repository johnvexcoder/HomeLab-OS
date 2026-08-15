import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Search, CornerDownLeft, Server, Bell, Zap, Activity } from 'lucide-react';
import { useUiStore } from '@/store/ui';
import { endpoints } from '@/api/endpoints';
import { useTelemetry } from '@/hooks/useTelemetry';
import type { SearchResults } from '@/types';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';

interface FlatItem {
  kind: 'server' | 'notification' | 'action';
  id: string;
  title: string;
  subtitle: string;
  logo: string;
  route: string;
}

const KIND_META = {
  server: { icon: Server, color: 'text-accent bg-accent/10' },
  notification: { icon: Bell, color: 'text-info bg-info/10' },
  action: { icon: Zap, color: 'text-warn bg-warn/10' },
} as const;

export function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const navigate = useNavigate();
  const { servers } = useTelemetry();

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data } = useQuery({
    queryKey: ['search', query],
    queryFn: () => endpoints.search(query),
    enabled: open && query.trim().length > 0,
    staleTime: 5_000,
  });

  const items = useMemo<FlatItem[]>(() => {
    if (query.trim().length === 0) {
      // No query: show all servers + quick actions as default palette
      const quick = servers.map((s) => ({
        kind: 'server' as const,
        id: s.spec.id,
        title: s.spec.name,
        subtitle: `${s.spec.os} · ${s.spec.ip}`,
        logo: s.spec.logo,
        route: `/servers/${s.spec.id}`,
      }));
      return quick;
    }
    const results: SearchResults = data ?? { servers: [], notifications: [], actions: [] };
    return [
      ...results.servers.map((r) => ({ kind: 'server' as const, ...r })),
      ...results.notifications.map((r) => ({ kind: 'notification' as const, ...r })),
      ...results.actions.map((r) => ({ kind: 'action' as const, ...r })),
    ];
  }, [data, query, servers]);

  useEffect(() => {
    if (open) {
      setActive(0);
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!open) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === 'Enter' && items[active]) {
        e.preventDefault();
        run(items[active]);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, items, active]);

  function run(item: FlatItem) {
    setOpen(false);
    if (item.route) navigate(item.route);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 overflow-y-auto bg-black/70 px-4 py-[8vh] backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-surface-border bg-surface-elevated shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-surface-border px-4">
              <Search className="h-[18px] w-[18px] shrink-0 text-text-muted" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search servers, alerts, actions…"
                className="w-full bg-transparent py-4 text-sm text-text-primary placeholder:text-text-muted outline-none"
              />
              <kbd className="hidden rounded-md border border-surface-border bg-base px-1.5 py-0.5 text-[10px] font-semibold text-text-muted sm:block">
                ESC
              </kbd>
            </div>

            <div className="max-h-[min(420px,calc(100dvh-16rem))] overflow-y-auto p-2">
              {items.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-10 text-text-muted">
                  <Activity className="h-8 w-8 opacity-40" />
                  <span className="text-sm">No results for “{query}”</span>
                </div>
              )}

              {items.map((item, i) => {
                const meta = KIND_META[item.kind];
                const Icon = meta.icon;
                return (
                  <button
                    key={`${item.kind}-${item.id}`}
                    onClick={() => run(item)}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors cursor-pointer',
                      i === active ? 'bg-overlay/[0.06]' : 'hover:bg-overlay/[0.03]',
                    )}
                  >
                    <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', meta.color)}>
                      {item.logo ? <span className="text-sm">{item.logo}</span> : <Icon className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text-primary">{item.title}</span>
                      <span className="block truncate text-xs text-text-muted">{item.subtitle}</span>
                    </span>
                    {i === active && <CornerDownLeft className="h-3.5 w-3.5 text-text-muted" />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
