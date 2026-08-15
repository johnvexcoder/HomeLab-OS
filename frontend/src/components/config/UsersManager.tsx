import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Plus, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { endpoints } from '@/api/endpoints';
import { Section, Row, SaveBar, useSave, humanError } from './shared';
import { Input, Field, Select, Toggle } from '@/components/ui/forms';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ConfirmModal } from '@/components/ui/Modal';
import { useAuthStore } from '@/store/auth';
import { relativeTime } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { PublicUser } from '@/types/auth';

const ROLE_TONE: Record<string, 'accent' | 'info' | 'neutral' | 'success' | 'warn'> = {
  SUPER_ADMIN: 'accent',
  ADMIN: 'success',
  OPERATOR: 'info',
  VIEWER: 'neutral',
};

interface CreateForm {
  username: string;
  name: string;
  password: string;
  role: string;
  mustChangePassword: boolean;
  email: string;
}

interface EditForm {
  role: string;
  disabled: boolean;
  mustChangePassword: boolean;
  resetPassword: string;
  email: string;
}

const EMPTY_CREATE: CreateForm = {
  username: '',
  name: '',
  password: '',
  role: 'VIEWER',
  mustChangePassword: false,
  email: '',
};

export function UsersManager() {
  const me = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const save = useSave();

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_CREATE);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingUser, setEditingUser] = useState<PublicUser | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState<PublicUser | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: endpoints.admin.users.list,
  });

  const { data: settingsData } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: endpoints.admin.settings.get,
  });

  const users = data?.users ?? [];
  const twoFactorMaster = settingsData?.settings?.['security.twoFactorEnabled'] === 'true';

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'securityHealth'] });
  }

  function openCreate() {
    setCreateError(null);
    setCreateForm(EMPTY_CREATE);
    setCreateOpen(true);
  }

  async function createUser() {
    setCreateError(null);
    await save.run(async () => {
      try {
        await endpoints.admin.users.create({
          username: createForm.username,
          name: createForm.name,
          password: createForm.password,
          role: createForm.role,
          mustChangePassword: createForm.mustChangePassword,
          email: createForm.email.trim() || undefined,
        });
        setCreateOpen(false);
        invalidate();
      } catch (err) {
        setCreateError(err instanceof Error ? humanError(err.message) : 'Failed');
        throw err;
      }
    });
  }

  function openEdit(user: PublicUser) {
    setEditError(null);
    setEditForm({
      role: user.role,
      disabled: user.disabled,
      mustChangePassword: user.mustChangePassword,
      resetPassword: '',
      email: user.email ?? '',
    });
    setEditingUser(user);
  }

  async function saveEdit() {
    if (!editingUser || !editForm) return;
    setEditError(null);

    const email = editForm.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      setEditError('Enter a valid email address, or leave blank to remove it.');
      return;
    }

    await save.run(async () => {
      try {
        const patch: Record<string, unknown> = {
          role: editForm.role,
          disabled: editForm.disabled,
          mustChangePassword: editForm.mustChangePassword,
          email: email || null,
        };
        if (editForm.resetPassword.trim()) patch.password = editForm.resetPassword;
        await endpoints.admin.users.update(editingUser.id, patch);
        setEditingUser(null);
        invalidate();
      } catch (err) {
        setEditError(err instanceof Error ? humanError(err.message) : 'Failed');
        throw err;
      }
    });
  }

  async function removeUser(user: PublicUser) {
    setDeleteError(null);
    await save.run(async () => {
      try {
        await endpoints.admin.users.remove(user.id);
        setConfirmDelete(null);
        invalidate();
      } catch (err) {
        setDeleteError(err instanceof Error ? humanError(err.message) : 'Failed');
        throw err;
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Users & roles"
        subtitle="Accounts that can sign in to this dashboard"
        icon={<Users className="h-4 w-4" />}
        action={
          <div className="flex items-center gap-2">
            <SaveBar busy={save.busy} saved={save.saved} error={save.error} />
            <Button variant="outline" size="sm" onClick={openCreate}>
              <UserPlus className="h-4 w-4" /> Create
            </Button>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-text-muted">
                <th className="pb-2 pr-4 font-medium">User</th>
                <th className="pb-2 pr-4 font-medium">Role</th>
                <th className="pb-2 pr-4 font-medium">2FA</th>
                <th className="pb-2 pr-4 font-medium">Email</th>
                <th className="pb-2 pr-4 font-medium">Last login</th>
                <th className="pb-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border/60">
              {users.map((user) => {
                const isSelf = user.id === me?.id;
                return (
                  <tr key={user.id}>
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={cn(
                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold',
                            user.twoFactorEnabled ? 'bg-accent/15 text-accent' : 'bg-overlay/5 text-text-muted',
                          )}
                        >
                          {user.username.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 truncate font-medium text-text-primary">
                            {user.username}
                            {isSelf && <Badge tone="info">you</Badge>}
                            {user.disabled && <Badge tone="crit">disabled</Badge>}
                            {user.mustChangePassword && <Badge tone="warn">must change pw</Badge>}
                          </div>
                          {user.name && <div className="truncate text-xs text-text-muted">{user.name}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge tone={ROLE_TONE[user.role] ?? 'neutral'}>{user.role}</Badge>
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-text-muted">
                      {user.twoFactorEnabled ? (
                        <Badge tone="success" size="sm">Enabled</Badge>
                      ) : twoFactorMaster ? (
                        <Badge tone="warn" size="sm">Not enrolled</Badge>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2.5 pr-4">
                      {user.email ? (
                        <div className="flex items-center gap-1.5 text-xs text-text-muted">
                          <Mail className="h-3 w-3 shrink-0 text-text-muted/70" />
                          <span className="truncate max-w-[180px]">{user.email}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-text-muted/50">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-text-muted">
                      {user.lastLoginAt ? relativeTime(user.lastLoginAt) : 'never'}
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        {isSelf ? (
                          <span className="text-xs text-text-muted">manage in Account</span>
                        ) : (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => openEdit(user)}>
                              Edit
                            </Button>
                            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(user)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Row
        label="Guest role"
        description="The 'guest' pseudo-role is controlled by the Access tab, not here — it is not an assignable account."
      >
        <Badge tone="neutral">managed by Access</Badge>
      </Row>

      {/* Create user modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create user"
        subtitle="Add an account that can sign in to the dashboard"
        icon={<UserPlus className="h-4 w-4" />}
        size="lg"
        busy={save.busy}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)} disabled={save.busy}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void createUser()}
              disabled={save.busy || !createForm.username.trim() || !createForm.password}
            >
              {save.busy ? 'Creating…' : 'Create user'}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Username" hint="Letters, numbers, . _ - only">
            <Input
              value={createForm.username}
              onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))}
              placeholder="operator"
              autoComplete="off"
              autoFocus
            />
          </Field>
          <Field label="Display name" hint="Optional">
            <Input
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Optional"
            />
          </Field>
          <Field label="Password" hint="Temporary — user changes it on first login if required below">
            <Input
              type="password"
              value={createForm.password}
              onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="Temporary password"
              autoComplete="new-password"
            />
          </Field>
          <Field label="Role">
            <Select value={createForm.role} onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value }))}>
              {(data?.roles ?? []).filter((r) => r !== 'GUEST').map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </Select>
          </Field>
          <Field label="Email" hint="Optional — used for 2FA & recovery codes">
            <Input
              type="email"
              value={createForm.email}
              onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="you@example.com"
            />
          </Field>
          <div className="flex items-end">
            <Toggle
              label="Force password change"
              description="Require a new password on first login"
              checked={createForm.mustChangePassword}
              onChange={(next) => setCreateForm((f) => ({ ...f, mustChangePassword: next }))}
            />
          </div>
        </div>
        {createError && (
          <div className="mt-3 rounded-xl border border-crit/25 bg-crit/10 px-4 py-2.5 text-xs text-crit">{createError}</div>
        )}
      </Modal>

      {/* Edit user modal */}
      <Modal
        open={editingUser !== null}
        onClose={() => setEditingUser(null)}
        title={editingUser ? `Edit ${editingUser.username}` : 'Edit user'}
        subtitle="Role, account status and credentials"
        icon={<Users className="h-4 w-4" />}
        size="lg"
        busy={save.busy}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditingUser(null)} disabled={save.busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void saveEdit()} disabled={save.busy}>
              {save.busy ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        }
      >
        {editForm && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Role" className="min-w-[180px]">
                <Select
                  value={editForm.role}
                  onChange={(e) => setEditForm((f) => (f ? { ...f, role: e.target.value } : f))}
                >
                  {(data?.roles ?? []).filter((r) => r !== 'GUEST').map((role) => (
                    <option key={role} value={role}>{role}</option>
                  ))}
                </Select>
              </Field>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <Toggle
                  label={editForm.disabled ? 'Account disabled' : 'Account active'}
                  checked={!editForm.disabled}
                  onChange={(enabled) => setEditForm((f) => (f ? { ...f, disabled: !enabled } : f))}
                />
                <Toggle
                  label="Force password change"
                  checked={editForm.mustChangePassword}
                  onChange={(next) => setEditForm((f) => (f ? { ...f, mustChangePassword: next } : f))}
                />
              </div>
            </div>

            <Field label="Reset password" hint="Leaving blank keeps the current password">
              <Input
                type="password"
                value={editForm.resetPassword}
                onChange={(e) => setEditForm((f) => (f ? { ...f, resetPassword: e.target.value } : f))}
                placeholder="New temporary password"
                autoComplete="new-password"
              />
            </Field>

            <Field label="2FA & recovery email" hint="Used for email verification codes. Blank removes it.">
              <Input
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm((f) => (f ? { ...f, email: e.target.value } : f))}
                placeholder="you@example.com"
              />
            </Field>

            <div className="flex items-start gap-2 rounded-xl border border-info/20 bg-info/5 px-4 py-3 text-xs text-text-secondary">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-info" />
              <span>
                The user's own 2FA is managed from their Account tab. Email codes only work once SMTP is configured.
              </span>
            </div>

            {editError && (
              <div className="rounded-xl border border-crit/25 bg-crit/10 px-4 py-2.5 text-xs text-crit">{editError}</div>
            )}
          </div>
        )}
      </Modal>

      {/* Delete user confirmation */}
      <ConfirmModal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && void removeUser(confirmDelete)}
        title={confirmDelete ? `Delete user "${confirmDelete.username}"?` : 'Delete user'}
        description={
          <>
            <b className="text-text-primary">{confirmDelete?.username}</b>
            {confirmDelete?.name ? <> ({confirmDelete.name})</> : null} will be permanently removed and their sessions
            revoked. This cannot be undone.
            {deleteError && (
              <span className="mt-2 block rounded-xl border border-crit/25 bg-crit/10 px-3 py-2 text-xs text-crit">
                {deleteError}
              </span>
            )}
          </>
        }
        confirmLabel="Delete user"
        busy={save.busy}
      />
    </div>
  );
}
