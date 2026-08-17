import { useQuery } from '@tanstack/react-query';
import { endpoints } from '@/api/endpoints';
import type { ClusterInfo, HistoryRange, StatsHistoryPoint } from '@/types';

export function useStatsHistory(range: HistoryRange = '15m') {
  const { data, isLoading } = useQuery({
    queryKey: ['stats-history', range],
    queryFn: () => endpoints.statsHistory(range),
    refetchInterval: 5_000,
    staleTime: 2_000,
  });

  return { points: (data?.points ?? []) as StatsHistoryPoint[], isLoading };
}

export function useNetwork() {
  const { data, error, refetch, isLoading, isFetching } = useQuery({
    queryKey: ['network'],
    queryFn: endpoints.network,
    refetchInterval: 5_000,
    staleTime: 2_000,
  });

  return { topology: data, error, refetch, isLoading, isFetching };
}

export function useClusters() {
  const { data, isLoading } = useQuery({
    queryKey: ['clusters'],
    queryFn: endpoints.clusters,
    refetchInterval: 5_000,
    staleTime: 2_000,
  });

  return { clusters: (data?.clusters ?? []) as ClusterInfo[], isLoading };
}

export function useGlobalHealth() {
  const { data, isLoading } = useQuery({
    queryKey: ['global-health'],
    queryFn: endpoints.globalHealth,
    refetchInterval: 5_000,
    staleTime: 2_000,
  });

  return { health: data, isLoading };
}

export function useQuickStats() {
  const { data, isLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: endpoints.stats,
    refetchInterval: 5_000,
    staleTime: 2_000,
  });

  return { stats: data ?? [], isLoading };
}
