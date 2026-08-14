import { create } from 'zustand';
import type { Notification } from '@/types';

interface NotificationState {
  items: Notification[];
  unread: number;
  toastQueue: Notification[];

  hydrate: (items: Notification[]) => void;
  ingest: (notifications: Notification[]) => void;
  markRead: (ids: string[]) => void;
  markAllRead: () => void;
  setUnread: (count: number) => void;
  dismissToast: (id: string) => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  unread: 0,
  toastQueue: [],

  hydrate: (items) =>
    set({
      items,
      unread: items.filter((n) => !n.read).length,
    }),

  ingest: (notifications) =>
    set((state) => {
      const existing = new Set(state.items.map((n) => n.id));
      const fresh = notifications.filter((n) => !existing.has(n.id));
      if (fresh.length === 0) return state;

      const items = [...fresh, ...state.items].slice(0, 100);
      const addedUnread = fresh.filter((n) => !n.read).length;
      return {
        items,
        unread: state.unread + addedUnread,
        toastQueue: [...fresh.filter((n) => !n.read).slice(0, 3), ...state.toastQueue].slice(0, 5),
      };
    }),

  markRead: (ids) =>
    set((state) => {
      const set = new Set(ids);
      const items = state.items.map((n) => (set.has(n.id) ? { ...n, read: true } : n));
      return { items, unread: items.filter((n) => !n.read).length };
    }),

  markAllRead: () =>
    set((state) => ({
      items: state.items.map((n) => ({ ...n, read: true })),
      unread: 0,
    })),

  setUnread: (count) => set({ unread: count }),

  dismissToast: (id) =>
    set((state) => ({ toastQueue: state.toastQueue.filter((n) => n.id !== id) })),
}));
