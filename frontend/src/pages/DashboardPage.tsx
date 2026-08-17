import { Greeting } from '@/components/dashboard/Greeting';
import { HealthScore, QuickStats } from '@/components/dashboard/HealthScore';
import { QuickActions } from '@/components/dashboard/QuickActions';
import { Hosts } from '@/components/dashboard/Hosts';
import { NetworkMap } from '@/components/dashboard/NetworkMap';
import { ServerOverview } from '@/components/dashboard/ServerOverview';

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <Greeting />

      <QuickStats />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <HealthScore />
        <Hosts />
      </div>

      <QuickActions />

      <NetworkMap />

      <ServerOverview />
    </div>
  );
}
