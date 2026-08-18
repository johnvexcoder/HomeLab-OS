import { Card } from '@/components/ui/Card';
import { StatusDot } from '@/components/ui/Status';
import { useDockerHosts } from '@/hooks/useQueries';
import { Container, Power, Server, ArrowDown, ArrowUp, ArrowUpRight } from 'lucide-react';

export function DockerProfileCards() {
  const { profiles, isLoading } = useDockerHosts();

  if (isLoading) {
    return (
      <Card>
        <div className="py-4 text-center text-xs text-text-muted">Loading Docker profiles…</div>
      </Card>
    );
  }

  if (profiles.length === 0) return null;

  return (
    <>
      {profiles.map((profile) => {
        const running = profile.containers.filter((c) => c.running).length;
        const stopped = profile.containers.length - running;

        return (
          <Card key={profile.hostName} className="flex flex-col">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <Container className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">{profile.hostName}</h3>
                  <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
                    <Server className="h-2.5 w-2.5" />
                    {profile.hostIp}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[10px]">
                {running > 0 && <span className="text-success">{running} running</span>}
                {stopped > 0 && <span className="text-crit">{stopped} stopped</span>}
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
              {profile.containers.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2.5 rounded-lg border border-surface-border/70 bg-surface-input px-3 py-2 transition-all"
                >
                  <StatusDot status={c.running ? 'online' : 'offline'} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-text-primary">{c.name}</span>
                      {!c.running && <Power className="h-3 w-3 rotate-90 text-crit" />}
                    </div>
                    <div className="truncate text-[10px] text-text-muted">{c.image}</div>
                  </div>
                  {c.ports && c.ports.length > 0 && (
                    <div className="shrink-0 text-[10px] font-mono text-text-muted">
                      {c.ports[0]}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-surface-border pt-2.5">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
                <span className="flex items-center gap-1 whitespace-nowrap"><ArrowDown className="h-3 w-3 text-success" />0 Mb/s</span>
                <span className="flex items-center gap-1 whitespace-nowrap"><ArrowUp className="h-3 w-3 text-info" />0 Mb/s</span>
                <span className="flex items-center gap-1 whitespace-nowrap">{running} CTs</span>
              </div>
              <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-accent">
                Details <ArrowUpRight className="h-3 w-3" />
              </span>
            </div>
          </Card>
        );
      })}
    </>
  );
}
