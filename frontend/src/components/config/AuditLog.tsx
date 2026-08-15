import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ScrollText, Search } from 'lucide-react';
import { endpoints } from '@/api/endpoints';
import { Section, SaveBar } from './shared';
import { Input, Select } from '@/components/ui/forms';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

const RESULT_TONE: Record<string, 'success' | 'crit' | 'warn'> = {
  success: 'success',
  failure: 'crit',
  denied: 'warn',
};

function formatTs(ts: number): string {
  return new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function AuditLog() {
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [result, setResult] = useState('');
  const [page, setPage] = useState(1);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: actionsData } = useQuery({
    queryKey: ['admin', 'auditActions'],
    queryFn: endpoints.admin.audit.actions,
  });

  const { data, isFetching } = useQuery({
    queryKey: ['admin', 'audit', { search, action, result, page }],
    queryFn: () =>
      endpoints.admin.audit.list({
        page,
        perPage: 25,
        search: search || undefined,
        action: action || undefined,
        result: result || undefined,
      }),
  });

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setPage(1), 350);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [search, action, result]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Audit log"
        subtitle="Security and management events"
        icon={<ScrollText className="h-4 w-4" />}
        action={<SaveBar busy={isFetching} />}
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_180px_140px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <Input
              className="pl-10"
              placeholder="Search username, target, details…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>
            {actionsData?.actions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </Select>
          <Select value={result} onChange={(e) => setResult(e.target.value)}>
            <option value="">All results</option>
            <option value="success">success</option>
            <option value="failure">failure</option>
            <option value="denied">denied</option>
          </Select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-text-muted">
                <th className="pb-2 pr-4 font-medium">Time</th>
                <th className="pb-2 pr-4 font-medium">User</th>
                <th className="pb-2 pr-4 font-medium">Action</th>
                <th className="pb-2 pr-4 font-medium">Target</th>
                <th className="pb-2 pr-4 font-medium">Result</th>
                <th className="pb-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border/60">
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-sm text-text-muted">
                    No audit entries match.
                  </td>
                </tr>
              )}
              {items.map((entry, i) => (
                <tr key={`${entry.ts}-${i}`} className="align-top">
                  <td className="whitespace-nowrap py-2.5 pr-4 text-xs tabular text-text-muted">{formatTs(entry.ts)}</td>
                  <td className="py-2.5 pr-4 text-xs text-text-secondary">{entry.username ?? '—'}</td>
                  <td className="py-2.5 pr-4 font-mono text-[11px] text-text-primary">{entry.action}</td>
                  <td className="max-w-[180px] truncate py-2.5 pr-4 text-xs text-text-secondary" title={entry.target ?? ''}>
                    {entry.target ?? '—'}
                  </td>
                  <td className="py-2.5 pr-4">
                    <Badge tone={RESULT_TONE[entry.result] ?? 'neutral'}>{entry.result}</Badge>
                  </td>
                  <td className="max-w-[240px] truncate py-2.5 text-xs text-text-muted" title={entry.details ?? ''}>
                    {entry.details ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted">{total} entries</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              aria-label="Previous page"
              className={cn('flex h-11 w-11 items-center justify-center rounded-lg border border-surface-border text-text-muted transition-colors hover:text-text-primary', page <= 1 && 'opacity-40 pointer-events-none')}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs text-text-muted">{page} / {pages}</span>
            <button
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={page >= pages}
              aria-label="Next page"
              className={cn('flex h-11 w-11 items-center justify-center rounded-lg border border-surface-border text-text-muted transition-colors hover:text-text-primary', page >= pages && 'opacity-40 pointer-events-none')}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
}
