import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { LoginModal } from '@/components/auth/LoginModal';
import type { Permission } from '@/types/auth';

export function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-base">
      <div className="flex flex-col items-center gap-3 text-text-muted">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
        <span className="text-xs tracking-widest uppercase">Loading…</span>
      </div>
    </div>
  );
}

export function RequireAuth({
  permission,
  children,
}: {
  permission?: Permission;
  children: React.ReactNode;
}) {
  const status = useAuthStore((s) => s.status);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const has = useAuthStore((s) => s.has);

  useEffect(() => {
    if (status === 'loading') void bootstrap();
  }, [status, bootstrap]);

  if (status === 'loading') return <LoadingScreen />;

  if (status === 'anonymous') {
    return (
      <div className="relative">
        <div className="pointer-events-none select-none blur-sm">{children}</div>
        <div className="fixed inset-0 z-40 bg-base/60 backdrop-blur-sm" />
        <LoginModal />
      </div>
    );
  }

  if (permission && !has(permission)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-base px-4">
        <div className="card max-w-md p-8 text-center">
          <h1 className="font-display text-xl font-bold text-text-primary">Access denied</h1>
          <p className="mt-2 text-sm text-text-muted">
            Your account does not have permission to view this page. Contact a super admin.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
