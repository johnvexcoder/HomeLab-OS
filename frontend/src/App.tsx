import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import DashboardPage from '@/pages/DashboardPage';
import ServersPage from '@/pages/ServersPage';
import ServerDetailPage from '@/pages/ServerDetailPage';
import AlertsPage from '@/pages/AlertsPage';
import NetworkPage from '@/pages/NetworkPage';
import SettingsPage from '@/pages/SettingsPage';
import { RequireAuth } from '@/components/auth/RequireAuth';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Navigate to="/settings" replace />} />
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/servers" element={<ServersPage />} />
            <Route path="/servers/:id" element={<ServerDetailPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/network" element={<NetworkPage />} />
            <Route
              path="/settings"
              element={
                <RequireAuth permission="settings.view">
                  <SettingsPage />
                </RequireAuth>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
