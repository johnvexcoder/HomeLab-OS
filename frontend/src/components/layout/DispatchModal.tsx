import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, StickyNote, AlertTriangle, User, Check, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';

interface DispatchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DispatchModal({ open, onOpenChange }: DispatchModalProps) {
  const [tab, setTab] = useState<'note' | 'issue'>('note');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [selectedUser, setSelectedUser] = useState<string>('All');
  const [severity, setSeverity] = useState<'critical' | 'warning' | 'info'>('warning');
  const [statusMessage, setStatusMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const authUser = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  // Fetch all recipients from backend
  const { data: recipientData } = useQuery({
    queryKey: ['users-recipients'],
    queryFn: async () => {
      const res = await fetch('/api/users/recipients');
      if (!res.ok) return { users: [] };
      return res.json() as Promise<{ users: Array<{ id: string; username: string; name: string }> }>;
    },
    enabled: open,
    staleTime: 60_000,
  });

  // Filter out the current user so they don't see themselves in the recipient list
  const availableUsers = useMemo(() => {
    const raw = recipientData?.users ?? [];
    if (!authUser) return raw;
    return raw.filter((u) => u.username !== authUser.username && u.id !== authUser.id);
  }, [recipientData, authUser]);

  const authorName = authUser ? (authUser.name || authUser.username) : 'Guest';

  const mutation = useMutation({
    mutationFn: async () => {
      const isIssue = tab === 'issue';
      const actionLabel = isIssue ? (severity === 'critical' ? 'Critical' : severity === 'warning' ? 'Major' : 'Minor') : 'None';
      
      const res = await fetch('/api/notifications/dispatch-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: tab,
          title: isIssue ? title.trim() : undefined,
          content: content.trim(),
          to: selectedUser === 'All' ? ['All'] : [selectedUser],
          severity,
          priority: actionLabel,
          fromName: authorName,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to dispatch');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      setStatusMessage({ text: `${tab === 'note' ? 'Note' : 'Issue'} sent successfully!` });
      setTimeout(() => {
        onOpenChange(false);
        setTitle('');
        setContent('');
        setSelectedUser('All');
        setTab('note');
        setStatusMessage(null);
      }, 1000);
    },
    onError: (err: Error) => {
      setStatusMessage({ text: err.message || 'Failed to send', error: true });
    },
  });

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
          />

          {/* Modal Card */}
          <div className="fixed inset-0 z-[101] flex items-center justify-center p-3 sm:p-5 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 14 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-w-xl rounded-2xl border border-surface-border bg-[#0C101A] shadow-2xl pointer-events-auto flex flex-col max-h-[90vh] overflow-hidden"
            >
              {/* Header with NOTE | ISSUE Tab Selector */}
              <div className="flex items-center justify-between border-b border-surface-border/80 bg-[#111726]/80 px-4 py-3.5 sm:px-5 shrink-0">
                <div className="flex items-center gap-1 rounded-xl border border-surface-border bg-black/40 p-1">
                  <button
                    type="button"
                    onClick={() => { setTab('note'); setStatusMessage(null); }}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer',
                      tab === 'note'
                        ? 'bg-accent text-white shadow-sm'
                        : 'text-text-muted hover:text-text-primary hover:bg-white/5',
                    )}
                  >
                    <StickyNote className="h-3.5 w-3.5" /> NOTE
                  </button>
                  <button
                    type="button"
                    onClick={() => { setTab('issue'); setStatusMessage(null); }}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer',
                      tab === 'issue'
                        ? 'bg-warn text-white shadow-sm'
                        : 'text-text-muted hover:text-text-primary hover:bg-white/5',
                    )}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" /> ISSUE
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="rounded-xl border border-surface-border/60 p-1.5 text-text-muted transition-colors hover:bg-surface-elevated hover:text-text-primary cursor-pointer"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Form Body */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
                {/* Status alert banner */}
                {statusMessage && (
                  <div
                    className={cn(
                      'rounded-xl border px-3.5 py-2 text-xs font-semibold',
                      statusMessage.error
                        ? 'border-crit/40 bg-crit/15 text-crit'
                        : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400',
                    )}
                  >
                    {statusMessage.text}
                  </div>
                )}

                {/* Top Row: TO + FROM */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {/* TO: Selector */}
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                      <Users className="h-3.5 w-3.5 text-accent" /> TO:
                    </label>
                    <select
                      value={selectedUser}
                      onChange={(e) => setSelectedUser(e.target.value)}
                      className="w-full rounded-xl border border-surface-border bg-surface-input px-3 py-2 text-xs font-semibold text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 cursor-pointer"
                    >
                      <option value="All">All Users</option>
                      {availableUsers.map((u) => (
                        <option key={u.id} value={u.username}>
                          {u.name || u.username} ({u.username})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* FROM: Display */}
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                      <User className="h-3.5 w-3.5 text-info" /> FROM:
                    </label>
                    <div className="w-full rounded-xl border border-surface-border bg-surface-input/60 px-3 py-2 text-xs font-semibold text-text-secondary select-none">
                      {authorName}
                    </div>
                  </div>
                </div>

                {/* If ISSUE tab: Title & Priority / Action Quota */}
                {tab === 'issue' && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-1">
                    {/* TITLE */}
                    <div className="sm:col-span-2 space-y-1.5">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
                        ISSUE TITLE:
                      </label>
                      <input
                        type="text"
                        placeholder="Brief title of the issue..."
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="w-full rounded-xl border border-surface-border bg-surface-input px-3 py-2 text-xs text-text-primary placeholder:text-text-muted/40 outline-none focus:border-warn focus:ring-1 focus:ring-warn/40"
                      />
                    </div>

                    {/* ACTION QUOTA / SEVERITY */}
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
                        PRIORITY:
                      </label>
                      <select
                        value={severity}
                        onChange={(e) => setSeverity(e.target.value as any)}
                        className={cn(
                          'w-full rounded-xl border px-3 py-2 text-xs font-bold uppercase tracking-wider outline-none cursor-pointer',
                          severity === 'critical'
                            ? 'border-crit/50 bg-crit/15 text-crit focus:border-crit'
                            : severity === 'warning'
                            ? 'border-warn/50 bg-warn/15 text-warn focus:border-warn'
                            : 'border-info/50 bg-info/15 text-info focus:border-info',
                        )}
                      >
                        <option value="critical" className="bg-[#0C101A] text-crit">Critical / Urgent</option>
                        <option value="warning" className="bg-[#0C101A] text-warn">Major / High</option>
                        <option value="info" className="bg-[#0C101A] text-info">Minor / Low</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* Main Textarea Content Form */}
                <div className="space-y-1.5 pt-1">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
                    {tab === 'note' ? 'NOTE CONTENT:' : 'ISSUE DETAILS:'}
                  </label>
                  <textarea
                    rows={6}
                    placeholder={
                      tab === 'note'
                        ? 'Write task or note description here...'
                        : 'Describe the issue, symptoms, affected servers, and action needed...'
                    }
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className="w-full resize-none rounded-xl border border-surface-border bg-surface-input p-3.5 text-xs sm:text-sm text-text-primary placeholder:text-text-muted/40 outline-none focus:border-accent focus:ring-1 focus:ring-accent/40"
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between border-t border-surface-border/80 bg-[#111726]/80 px-4 py-3 sm:px-5 shrink-0">
                <span className="text-[11px] text-text-muted">
                  Dispatches to Dashboard alerts, Email & Telegram
                </span>

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => onOpenChange(false)}
                    className="rounded-xl border border-surface-border px-3.5 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:bg-surface-elevated hover:text-text-primary cursor-pointer"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    disabled={!content.trim() || mutation.isPending}
                    onClick={() => mutation.mutate()}
                    className={cn(
                      'flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-bold text-white shadow-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
                      tab === 'note'
                        ? 'bg-accent hover:bg-accent/90 shadow-accent/20'
                        : 'bg-warn hover:bg-warn/90 shadow-warn/20',
                    )}
                  >
                    {mutation.isPending ? 'Sending…' : tab === 'note' ? 'Send Note' : 'Send Issue'}
                    <Send className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
