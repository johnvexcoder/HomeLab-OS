import { Greeting } from '@/components/dashboard/Greeting';
import { HealthScore, QuickStats } from '@/components/dashboard/HealthScore';
import { QuickActions } from '@/components/dashboard/QuickActions';
import { RecentAlerts } from '@/components/dashboard/RecentAlerts';
import { NetworkMap } from '@/components/dashboard/NetworkMap';
import { ServerOverview } from '@/components/dashboard/ServerOverview';

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <Greeting />

      <QuickStats />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <HealthScore />
        <QuickActions />
        <RecentAlerts limit={5} />
      </div>

      <NetworkMap />

      <ServerOverview />
    </div>
  );
}
