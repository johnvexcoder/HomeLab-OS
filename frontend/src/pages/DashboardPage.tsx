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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.4fr] lg:grid-rows-[auto_auto]">
        <HealthScore />
        <QuickActions />
        <div className="lg:row-span-2 lg:flex lg:flex-col">
          <Hosts />
        </div>
      </div>

      <NetworkMap />

      <ServerOverview />
    </div>
  );
}
