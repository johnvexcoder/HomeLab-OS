import { Greeting } from '@/components/dashboard/Greeting';
import { HealthScore, QuickStats } from '@/components/dashboard/HealthScore';
import { QuickActions } from '@/components/dashboard/QuickActions';
import { Hosts } from '@/components/dashboard/Hosts';
import { NetworkMap } from '@/components/dashboard/NetworkMap';
import { ServerOverview } from '@/components/dashboard/ServerOverview';

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <Greeting />

      <QuickStats />

      <div className="grid grid-cols-1 gap-5 sm:gap-6 md:grid-cols-2 lg:grid-cols-[1fr_1.4fr] items-stretch">
        <div className="flex flex-col gap-5 sm:gap-6">
          <HealthScore />
          <QuickActions />
        </div>
        <div className="flex h-full min-h-0">
          <Hosts className="h-full w-full" />
        </div>
      </div>

      <NetworkMap />

      <ServerOverview />
    </div>
  );
}
