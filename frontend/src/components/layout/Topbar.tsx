import { useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, LogIn, LogOut, Menu, Search, Settings, Wifi, WifiOff, CheckCheck } from 'lucide-react';
import { useUiStore } from '@/store/ui';
import { useClock } from '@/hooks/useClock';
import { useTelemetry } from '@/hooks/useTelemetry';
import { useNotificationStore } from '@/store/notifications';
import { useAuthStore } from '@/store/auth';
import { endpoints } from '@/api/endpoints';
import { formatClock, formatDate, relativeTime, cn } from '@/lib/utils';
import { SEVERITY_META } from '@/lib/constants';
import { useNotifications } from '@/hooks/useNotifications';

export function Topbar() {
  const now = useClock();
  const navigate = useNavigate();
  const { connected } = useTelemetry();
  const unread = useNotificationStore((s) => s.unread);
  const items = useNotificationStore((s) => s.items);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const panelOpen = useUiStore((s) => s.notificationPanelOpen);
  const setPanelOpen = useUiStore((s) => s.setNotificationPanelOpen);
  const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const setMobileMenuOpen = useUiStore((s) => s.setMobileSidebarOpen);
  const markRead = useNotificationStore((s) => s.markRead);
  const authStatus = useAuthStore((s) => s.status);
  const authUser = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  useNotifications(12);

  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setCommandPaletteOpen]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setPanelOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [setPanelOpen]);

  function handleMarkAll() {
    markAllRead();
    endpoints.notifications.readAll().catch(() => undefined);
  }

  function openNotification(n: (typeof items)[number]) {
    setPanelOpen(false);
    markRead([n.id]);
    endpoints.notifications.read([n.id]).catch(() => undefined);
    navigate(`/alerts?highlight=${encodeURIComponent(n.id)}`);
  }

  return (
    <header className="relative z-20 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-surface-border bg-base/70 px-3 backdrop-blur-xl sm:gap-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          onClick={() => setMobileMenuOpen(true)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-surface-border bg-surface text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary cursor-pointer lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="group flex items-center gap-3 rounded-xl border border-surface-border bg-surface px-3.5 py-2 text-sm text-text-muted transition-all hover:border-accent/40 hover:text-text-primary input-focus cursor-pointer"
          aria-label="Search"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="hidden sm:inline">Search servers, alerts, actions…</span>
          <kbd className="ml-2 hidden rounded-md border border-surface-border bg-base px-1.5 py-0.5 text-[10px] font-semibold text-text-muted sm:inline">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-4">
        {/* Connection status */}
        <div className="hidden items-center gap-2 md:flex">
          {connected ? (
            <span className="flex items-center gap-1.5 text-xs text-accent">
              <Wifi className="h-3.5 w-3.5" />
              <span className="font-medium">Live</span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-warn">
              <WifiOff className="h-3.5 w-3.5" />
              <span className="font-medium">Reconnecting</span>
            </span>
          )}
          <span className="h-4 w-px bg-surface-border" />
        </div>

        {/* Clock */}
        <div className="hidden text-right sm:block">
          <div className="font-display text-sm font-semibold tabular leading-tight text-text-primary">
            {formatClock(now)}
          </div>
          <div className="hidden text-[10px] uppercase tracking-widest text-text-muted lg:block">
            {formatDate(now)}
          </div>
        </div>

        {/* Auth */}
        {authStatus === 'anonymous' ? (
          <Link
            to="/login?next=/settings"
            className="flex items-center gap-2 rounded-xl border border-surface-border bg-surface px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:border-accent/40 hover:text-accent cursor-pointer"
          >
            <LogIn className="h-4 w-4" />
            <span className="hidden sm:inline">Sign in</span>
          </Link>
        ) : authStatus === 'authenticated' && authUser ? (
          <div className="flex items-center gap-2">
            <Link
              to="/settings"
              className="flex items-center gap-2.5 rounded-xl border border-surface-border bg-surface px-3 py-1.5 transition-colors hover:border-accent/40 cursor-pointer"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-[10px] font-bold text-accent">
                {authUser.username.slice(0, 2).toUpperCase()}
              </div>
              <div className="hidden text-left leading-tight md:block">
                <div className="text-xs font-semibold text-text-primary">{authUser.username}</div>
                <div className="text-[10px] uppercase tracking-wider text-text-muted">{authUser.role}</div>
              </div>
              <Settings className="hidden h-3.5 w-3.5 text-text-muted sm:block" />
            </Link>
            <button
              onClick={() => {
                void logout();
                navigate('/');
              }}
              title="Sign out"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-surface-border bg-surface text-text-secondary transition-colors hover:border-crit/40 hover:text-crit cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        {/* Notifications */}
        <div className="relative" ref={panelRef}>
          <button
            onClick={() => setPanelOpen(!panelOpen)}
            className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-surface-border bg-surface text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary cursor-pointer"
            aria-label={panelOpen ? 'Close notifications' : 'Open notifications'}
            aria-expanded={panelOpen}
          >
            <Bell className="h-[18px] w-[18px]" />
            {unread > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-[#04120D]"
              >
                {unread > 9 ? '9+' : unread}
              </motion.span>
            )}
          </button>

          <AnimatePresence>
            {panelOpen && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="absolute right-0 top-12 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-surface-border bg-surface-elevated shadow-card"
              >
                <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
                  <span className="text-sm font-semibold text-text-primary">Notifications</span>
                  <button
                    onClick={handleMarkAll}
                    className="flex items-center gap-1 text-xs font-medium text-text-muted transition-colors hover:text-accent cursor-pointer"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    Mark all read
                  </button>
                </div>
                <div className="max-h-[min(380px,calc(100dvh-7rem))] overflow-y-auto">
                  {items.length === 0 && (
                    <div className="px-4 py-10 text-center text-sm text-text-muted">No notifications yet</div>
                  )}
                  {items.slice(0, 12).map((n) => (
                    <button
                      key={n.id}
                      onClick={() => openNotification(n)}
                      className={cn(
                        'flex w-full items-start gap-3 border-b border-surface-border/60 px-4 py-3 text-left transition-colors hover:bg-overlay/[0.03] cursor-pointer',
                        !n.read && 'bg-accent/[0.03]',
                      )}
                    >
                      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', SEVERITY_META[n.severity].dot)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13px] font-semibold text-text-primary">{n.title}</span>
                          <span className="shrink-0 text-[10px] text-text-muted">{relativeTime(n.timestamp)}</span>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-text-secondary">{n.message}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
