import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  Archive,
  Cable,
  KeyRound,
  LogOut,
  ScrollText,
  Settings,
  Shield,
  Users,
  AlertTriangle,
  Zap,
  Palette,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { APP_VERSION } from '@/lib/version';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { AccessSettings } from '@/components/config/AccessSettings';
import { SecuritySettings } from '@/components/config/SecuritySettings';
import { FeatureFlags } from '@/components/config/FeatureFlags';
import { QuickActionsManager } from '@/components/config/QuickActionsManager';
import { UsersManager } from '@/components/config/UsersManager';
import { IntegrationsManager } from '@/components/config/IntegrationsManager';
import { BackupsManager } from '@/components/config/BackupsManager';
import { AuditLog } from '@/components/config/AuditLog';
import { AccountPanel } from '@/components/config/AccountPanel';
import { ThemePanel } from '@/components/config/ThemePanel';

type TabId =
  | 'access'
  | 'security'
  | 'features'
  | 'quick-actions'
  | 'users'
  | 'integrations'
  | 'backups'
  | 'audit'
  | 'theme'
  | 'account';

const TABS: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }>; permission?: string }> = [
  { id: 'access', label: 'Access', icon: KeyRound, permission: 'settings.view' },
  { id: 'security', label: 'Security', icon: Shield, permission: 'settings.view' },
  { id: 'features', label: 'Features', icon: Activity, permission: 'settings.view' },
  { id: 'quick-actions', label: 'Quick Actions', icon: Zap, permission: 'settings.view' },
  { id: 'users', label: 'Users', icon: Users, permission: 'users.view' },
  { id: 'integrations', label: 'Integrations', icon: Cable, permission: 'integrations.view' },
  { id: 'backups', label: 'Backups', icon: Archive, permission: 'backups.view' },
  { id: 'audit', label: 'Audit', icon: ScrollText, permission: 'audit.view' },
  { id: 'theme', label: 'Theme', icon: Palette },
  { id: 'account', label: 'Account', icon: Settings },
];

export default function SettingsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const modes = useAuthStore((s) => s.modes);
  const logout = useAuthStore((s) => s.logout);
  const has = useAuthStore((s) => s.has);
  const [tab, setTab] = useState<TabId>('access');
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user?.mustChangePassword) setTab('account');
  }, [user?.mustChangePassword]);

  // Keep the active tab visible inside the horizontal strip on narrow screens.
  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
    el?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [tab]);

  const visible = TABS.filter((t) => !t.permission || has(t.permission));
  const mustChange = user?.mustChangePassword ?? false;

  const render = () => {
    switch (tab) {
      case 'access':
        return <AccessSettings />;
      case 'security':
        return <SecuritySettings />;
      case 'features':
        return <FeatureFlags />;
      case 'quick-actions':
        return <QuickActionsManager />;
      case 'users':
        return <UsersManager />;
      case 'integrations':
        return <IntegrationsManager />;
      case 'backups':
        return <BackupsManager />;
      case 'audit':
        return <AuditLog />;
      case 'theme':
        return <ThemePanel />;
      case 'account':
        return <AccountPanel />;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent">
            <Settings className="h-6 w-6" />
          </div>
          <div>
            <h1 className="fluid-h1 font-display font-bold tracking-tight text-text-primary">Configuration</h1>
            <p className="mt-0.5 text-sm text-text-muted">
              Signed in as <b className="text-text-secondary">{user?.username}</b>
              {user?.name && <> ({user.name})</>} · <Badge tone="accent">{user?.role}</Badge>
              <span className="mx-2 text-text-muted/40">·</span>
              <span className="text-text-muted">v{APP_VERSION}</span>
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void logout()}>
          <LogOut className="h-4 w-4" /> Sign out
        </Button>
      </div>

      {mustChange && (
        <div className="flex items-center gap-3 rounded-xl border border-warn/25 bg-warn/10 px-4 py-3 text-sm text-warn">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Your password must be changed before you can configure anything. Set a new one in the Account tab.
          </span>
        </div>
      )}

      {modes?.readOnly && (
        <div className="flex items-center gap-3 rounded-xl border border-warn/25 bg-warn/10 px-4 py-3 text-sm text-warn">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>Read-only mode is active — settings can be viewed but changes are blocked server-side.</span>
        </div>
      )}

      <div
        ref={stripRef}
        className="no-scrollbar -mx-4 flex items-center gap-1 overflow-x-auto rounded-none border-b border-surface-border bg-surface px-4 py-1 sm:mx-0 sm:flex-wrap sm:rounded-xl sm:border sm:px-1"
      >
        {visible.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              data-tab={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'relative flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors cursor-pointer',
                active ? 'text-accent' : 'text-text-muted hover:text-text-primary',
              )}
            >
              {active && (
                <motion.span
                  layoutId="config-tab"
                  className="absolute inset-0 rounded-lg bg-accent/10"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              )}
              <Icon className="relative h-4 w-4" />
              <span className="relative">{t.label}</span>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2 }}
        >
          {render()}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
