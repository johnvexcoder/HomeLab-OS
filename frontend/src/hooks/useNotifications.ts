import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { endpoints } from '@/api/endpoints';
import { useNotificationStore } from '@/store/notifications';

export function useNotifications(limit = 30) {
  const items = useNotificationStore((s) => s.items);
  const unread = useNotificationStore((s) => s.unread);
  const hydrate = useNotificationStore((s) => s.hydrate);
  const setUnread = useNotificationStore((s) => s.setUnread);

  const { data, refetch } = useQuery({
    queryKey: ['notifications', limit],
    queryFn: () => endpoints.notifications.list(limit),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  useEffect(() => {
    if (data) hydrate(data);
  }, [data, hydrate]);

  useEffect(() => {
    endpoints.notifications.unreadCount().then((r) => setUnread(r.count)).catch(() => undefined);
  }, [setUnread]);

  return { items, unread, refetch };
}
