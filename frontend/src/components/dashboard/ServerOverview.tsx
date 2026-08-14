import { Link } from 'react-router-dom';
import { Server, ArrowRight } from 'lucide-react';
import { useTelemetry } from '@/hooks/useTelemetry';
import { ServerCard } from '@/components/server/ServerCard';
import { Card, CardHeader } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Status';

export function ServerOverview() {
  const { servers, loading } = useTelemetry();

  return (
    <Card padded={false} className="p-5">
      <CardHeader
        title="Server Overview"
        subtitle="Live telemetry across the fleet"
        icon={<Server className="h-[18px] w-[18px]" />}
        action={
          <Link
            to="/servers"
            className="flex items-center gap-1 text-xs font-semibold text-accent transition-colors hover:text-accent-hover"
          >
            View all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      />

      {loading && servers.length === 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {servers.map((server, i) => (
            <ServerCard key={server.spec.id} server={server} index={i} />
          ))}
        </div>
      )}
    </Card>
  );
}
