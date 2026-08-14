import {
  Server,
  Container,
  Activity,
  Terminal,
  Power,
  RefreshCw,
  Globe,
  Link,
  Database,
  Shield,
  Bell,
  Cpu,
  Folder,
  Mail,
  Monitor,
  Wifi,
  Zap,
  Github,
  Book,
  Settings,
  Router,
  Network,
  Layers,
  Rocket,
  Box,
  Lock,
  ExternalLink,
  type LucideIcon,
} from 'lucide-react';

/**
 * Icon registry for configurable Quick Actions. Keys are stored in settings
 * (`quick.actions`), so they must stay stable and in sync with
 * backend/src/services/quickActions.ts (QUICK_ACTION_ICONS).
 */
export const QUICK_ACTION_ICONS: Record<string, LucideIcon> = {
  server: Server,
  container: Container,
  activity: Activity,
  terminal: Terminal,
  power: Power,
  refresh: RefreshCw,
  globe: Globe,
  link: Link,
  database: Database,
  shield: Shield,
  bell: Bell,
  cpu: Cpu,
  folder: Folder,
  mail: Mail,
  monitor: Monitor,
  wifi: Wifi,
  zap: Zap,
  github: Github,
  book: Book,
  settings: Settings,
  router: Router,
  network: Network,
  layers: Layers,
  rocket: Rocket,
  box: Box,
  lock: Lock,
  external: ExternalLink,
};

export function quickActionIcon(key: string): LucideIcon {
  return QUICK_ACTION_ICONS[key] ?? Globe;
}
