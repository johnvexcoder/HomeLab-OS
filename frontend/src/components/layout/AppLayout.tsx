import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { CommandPalette } from '@/components/search/CommandPalette';
import { NotificationToasts } from '@/components/notifications/NotificationToasts';
import { useAuthStore } from '@/store/auth';
import { useUiStore } from '@/store/ui';
import { useMediaQuery } from '@/hooks/useMediaQuery';

export function AppLayout() {
  const status = useAuthStore((s) => s.status);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const mobileOpen = useUiStore((s) => s.mobileSidebarOpen);
  const setMobileOpen = useUiStore((s) => s.setMobileSidebarOpen);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const location = useLocation();
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  useEffect(() => {
    if (status === 'loading') void bootstrap();
  }, [status, bootstrap]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, setMobileOpen]);

  const sidebarWidth = isDesktop ? (collapsed ? 76 : 248) : 0;

  return (
    <div className="flex h-dvh w-screen overflow-hidden">
      <Sidebar />

      {/* Spacer that matches sidebar width on desktop */}
      {isDesktop && (
        <div
          className="shrink-0 transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{ width: sidebarWidth }}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
        <Topbar />
        <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto w-full max-w-[1440px] px-3 py-3 sm:px-5 sm:py-5 md:px-6 md:py-6 box-border">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Scrim behind the off-canvas drawer on phones/tablets */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      <CommandPalette />
      <NotificationToasts />
    </div>
  );
}
