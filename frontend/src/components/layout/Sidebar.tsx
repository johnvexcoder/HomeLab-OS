import { motion, AnimatePresence } from 'framer-motion';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Server,
  BellRing,
  Network,
  Settings,
  ChevronsLeft,
  ChevronsRight,
  Activity,
} from 'lucide-react';
import { useUiStore } from '@/store/ui';
import { cn } from '@/lib/utils';
import { useNotificationStore } from '@/store/notifications';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/servers', label: 'Servers', icon: Server, end: false },
  { to: '/alerts', label: 'Alerts', icon: BellRing, end: false },
  { to: '/network', label: 'Network', icon: Network, end: false },
];

const BOTTOM_ITEMS = [{ to: '/settings', label: 'Settings', icon: Settings, end: false }];

function NavItem({
  to,
  label,
  icon: Icon,
  end,
  collapsed,
}: {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end: boolean;
  collapsed: boolean;
}) {
  return (
    <NavLink to={to} end={end}>
      {({ isActive }) => (
        <motion.div
          whileHover={{ x: 2 }}
          className={cn(
            'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
            isActive
              ? 'bg-accent/10 text-accent'
              : 'text-text-secondary hover:text-text-primary hover:bg-overlay/5',
          )}
        >
          {isActive && (
            <motion.span
              layoutId="nav-active"
              className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-accent shadow-glow"
              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            />
          )}
          <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={isActive ? 2.2 : 1.8} />
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                className="whitespace-nowrap overflow-hidden"
              >
                {label}
              </motion.span>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </NavLink>
  );
}

export function Sidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebar);
  const unread = useNotificationStore((s) => s.unread);

  return (
    <motion.aside
      className="relative z-30 flex h-full flex-col border-r border-surface-border bg-surface-input/90 backdrop-blur-xl"
      initial={false}
      animate={{ width: collapsed ? 76 : 248 }}
      transition={{ type: 'spring', stiffness: 320, damping: 34 }}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 px-4 py-5">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/25 bg-accent/10">
          <Activity className="h-5 w-5 text-accent" strokeWidth={2.2} />
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-accent animate-glow-pulse" />
        </div>
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="overflow-hidden whitespace-nowrap"
            >
              <div className="font-display text-[15px] font-bold leading-tight text-text-primary">
                HomeLab <span className="text-accent">OS</span>
              </div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">NOC Control Center</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-1 overflow-hidden px-3 py-2">
        {NAV_ITEMS.map((item) => (
          <NavItem key={item.to} {...item} collapsed={collapsed} />
        ))}
      </nav>

      {/* Bottom */}
      <div className="flex flex-col gap-1 border-t border-surface-border px-3 py-3">
        {BOTTOM_ITEMS.map((item) => (
          <NavItem key={item.to} {...item} collapsed={collapsed} />
        ))}

        <button
          onClick={toggle}
          className="mt-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-text-muted transition-colors hover:bg-overlay/5 hover:text-text-primary cursor-pointer"
        >
          {collapsed ? (
            <ChevronsRight className="h-[18px] w-[18px]" />
          ) : (
            <>
              <ChevronsLeft className="h-[18px] w-[18px]" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>

      {unread > 0 && (
        <motion.div
          className="absolute right-2 top-6 h-2 w-2 rounded-full bg-accent shadow-glow"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
        />
      )}
    </motion.aside>
  );
}
