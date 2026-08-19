import { useEffect, useState } from 'react';
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
  Server,
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
import { AgentManager } from '@/components/config/AgentManager';

type TabId =
  | 'access'
  | 'security'
  | 'features'
  | 'quick-actions'
  | 'users'
  | 'integrations'
  | 'agents'
  | 'backups'
  | 'audit'
  | 'theme'
  | 'account';

const TABS: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }>; permission?: string }> = [
  { id: 'account', label: 'Account', icon: Settings },
  { id: 'theme', label: 'Theme', icon: Palette },
  { id: 'access', label: 'Access', icon: KeyRound, permission: 'settings.view' },
  { id: 'security', label: 'Security', icon: Shield, permission: 'settings.view' },
  { id: 'features', label: 'Features', icon: Activity, permission: 'settings.view' },
  { id: 'quick-actions', label: 'Actions', icon: Zap, permission: 'settings.view' },
  { id: 'users', label: 'Users', icon: Users, permission: 'users.view' },
  { id: 'integrations', label: 'Integrations', icon: Cable, permission: 'integrations.view' },
  { id: 'agents', label: 'Agents', icon: Server, permission: 'settings.view' },
  { id: 'backups', label: 'Backups', icon: Archive, permission: 'backups.view' },
  { id: 'audit', label: 'Audit', icon: ScrollText, permission: 'audit.view' },
];

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const modes = useAuthStore((s) => s.modes);
  const logout = useAuthStore((s) => s.logout);
  const has = useAuthStore((s) => s.has);
  const [tab, setTab] = useState<TabId>('account');

  useEffect(() => {
    if (user?.mustChangePassword) setTab('account');
  }, [user?.mustChangePassword]);

  const visible = TABS.filter((t) => !t.permission || has(t.permission));
  const mustChange = user?.mustChangePassword ?? false;

  const render = () => {
    switch (tab) {
      case 'access':    return <AccessSettings />;
      case 'security':  return <SecuritySettings />;
      case 'features':  return <FeatureFlags />;
      case 'quick-actions': return <QuickActionsManager />;
      case 'users':     return <UsersManager />;
      case 'integrations': return <IntegrationsManager />;
      case 'agents':      return <AgentManager />;
      case 'backups':   return <BackupsManager />;
      case 'audit':     return <AuditLog />;
      case 'theme':     return <ThemePanel />;
      case 'account':   return <AccountPanel />;
      default:          return null;
    }
  };

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/10 text-accent">
            <Settings className="h-5 w-5" />
          </div>
          <div>
            <h1 className="fluid-h1 font-display font-bold tracking-tight text-text-primary">Configuration</h1>
            <p className="mt-0.5 text-xs sm:text-sm text-text-muted">
              Signed in as <b className="text-text-secondary">{user?.username}</b>
              {user?.name && <> ({user.name})</>} · <Badge tone="accent">{user?.role}</Badge>
              <span className="mx-1.5 text-text-muted/40">·</span>
              <span className="text-text-muted">v{APP_VERSION}</span>
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void logout()}>
          <LogOut className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Sign out</span>
        </Button>
      </div>

      {/* Alerts */}
      {mustChange && (
        <div className="flex items-center gap-3 rounded-xl border border-warn/25 bg-warn/10 px-4 py-3 text-sm text-warn">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Your password must be changed before you can configure anything. Set a new one in the Account tab.
        </div>
      )}
      {modes?.readOnly && (
        <div className="flex items-center gap-3 rounded-xl border border-warn/25 bg-warn/10 px-4 py-3 text-sm text-warn">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Read-only mode is active — settings can be viewed but changes are blocked server-side.
        </div>
      )}

      {/* Navigation — compact pill bar, wraps on all viewports */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-surface-border bg-surface p-1">
        {visible.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'relative flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer',
                active ? 'text-accent' : 'text-text-muted hover:text-text-secondary',
              )}
            >
              {active && (
                <motion.span
                  layoutId="config-tab"
                  className="absolute inset-0 rounded-lg bg-accent/10"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              )}
              <Icon className="relative h-3.5 w-3.5 shrink-0" />
              <span className="relative hidden sm:inline">{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
        >
          {render()}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
