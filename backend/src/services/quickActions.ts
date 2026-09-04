import { getSetting, setSetting, type QuickAction } from '../security/settings';

/**
 * Configurable Quick Actions (the one-click buttons on the dashboard and the
 * action entries in ⌘K search). Stored as JSON under the `quick.actions`
 * settings key, so backups, config snapshots and reset-settings cover them.
 *
 * Defaults live in settings.ts (DEFAULT_QUICK_ACTIONS) to avoid a circular
 * import — the settings table is the single source of truth.
 */

/** Icon keys the frontend knows how to render. Kept in sync with
 *  frontend/src/lib/quickActionIcons.tsx. */
export const QUICK_ACTION_ICONS = [
  'server',
  'container',
  'activity',
  'terminal',
  'power',
  'refresh',
  'globe',
  'link',
  'database',
  'shield',
  'bell',
  'cpu',
  'folder',
  'mail',
  'monitor',
  'wifi',
  'zap',
  'github',
  'book',
  'settings',
  'router',
  'network',
  'layers',
  'rocket',
  'box',
  'lock',
  'external',
] as const;

const MAX_ACTIONS = 50;
const ID_RE = /^[a-z0-9][a-z0-9-_]{0,47}$/;

function slugify(label: string): string {
  const base = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || `action-${Date.now().toString(36)}`;
}

export function listQuickActions(): QuickAction[] {
  const raw = getSetting('quick.actions');
  if (!raw) return parseDefaults();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return parseDefaults();
    return parsed
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => ({
        id: typeof item.id === 'string' && ID_RE.test(item.id) ? item.id : slugify(String(item.label ?? 'action')),
        label: typeof item.label === 'string' && item.label.trim() ? item.label.trim().slice(0, 60) : 'Untitled action',
        kind: typeof item.kind === 'string' ? item.kind.trim().slice(0, 40) : 'command',
        keywords: typeof item.keywords === 'string' ? item.keywords.trim().slice(0, 200) : '',
        href:
          typeof item.href === 'string' && item.href.trim() && /^https?:\/\//i.test(item.href.trim())
            ? item.href.trim().slice(0, 500)
            : undefined,
        icon: QUICK_ACTION_ICONS.includes(item.icon as (typeof QUICK_ACTION_ICONS)[number]) ? String(item.icon) : 'globe',
        enabled: item.enabled === undefined ? true : Boolean(item.enabled),
      }));
  } catch {
    return parseDefaults();
  }
}

function parseDefaults(): QuickAction[] {
  try {
    return JSON.parse(getSetting('quick.actions')) as QuickAction[];
  } catch {
    return [];
  }
}

/**
 * Validate + persist a full replacement list. Returns the normalized actions
 * on success, or an error message on failure (nothing is written).
 */
export function saveQuickActions(raw: unknown): { ok: true; actions: QuickAction[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'invalid_body' };
  if (raw.length > MAX_ACTIONS) return { ok: false, error: 'too_many_actions' };

  const seen = new Set<string>();
  const actions: QuickAction[] = [];

  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return { ok: false, error: 'invalid_action' };

    const label = typeof item.label === 'string' ? item.label.trim() : '';
    if (!label) return { ok: false, error: 'label_required' };
    if (label.length > 60) return { ok: false, error: 'label_too_long' };

    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : slugify(label);
    if (!ID_RE.test(id)) return { ok: false, error: 'invalid_id' };
    if (seen.has(id)) return { ok: false, error: 'duplicate_id' };
    seen.add(id);

    const keywords = typeof item.keywords === 'string' ? item.keywords.trim() : '';
    if (keywords.length > 200) return { ok: false, error: 'keywords_too_long' };

    const kind = typeof item.kind === 'string' ? item.kind.trim().slice(0, 40) : 'command';

    let href: string | undefined;
    if (typeof item.href === 'string' && item.href.trim()) {
      const trimmed = item.href.trim();
      if (!/^https?:\/\//i.test(trimmed)) return { ok: false, error: 'invalid_href' };
      if (trimmed.length > 500) return { ok: false, error: 'href_too_long' };
      href = trimmed;
    }

    const icon = QUICK_ACTION_ICONS.includes(item.icon as (typeof QUICK_ACTION_ICONS)[number]) ? String(item.icon) : 'globe';

    actions.push({
      id,
      label,
      kind,
      keywords,
      href,
      icon,
      enabled: item.enabled === undefined ? true : Boolean(item.enabled),
    });
  }

  setSetting('quick.actions', JSON.stringify(actions));
  return { ok: true, actions };
}
