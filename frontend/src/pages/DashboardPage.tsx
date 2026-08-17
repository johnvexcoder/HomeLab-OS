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

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex flex-1 flex-col gap-6">
          <HealthScore />
          <QuickActions />
        </div>
        <div className="w-full self-stretch lg:w-[58%]">
          <Hosts />
        </div>
      </div>

      <NetworkMap />

      <ServerOverview />
    </div>
  );
}
