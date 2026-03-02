'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/auth';
import { api } from '@/lib/api';
import { AuthProvider } from '@/contexts/AuthContext';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';
import { SidebarProvider } from '@/contexts/SidebarContext';
import Spinner from '@/components/Spinner';
import WorkspaceSidebar from '@/components/WorkspaceSidebar';
import MobileBottomNav from '@/components/MobileBottomNav';
import MainContent from '@/components/MainContent';

function WorkspaceLayoutContent({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-bg-base dark:bg-slate-900">
      <div className="hidden sm:block">
        <WorkspaceSidebar />
      </div>
      <MainContent showLogout={false} className="pb-24 sm:pb-0">{children}</MainContent>
      {/* Mobile Bottom Navigation */}
      <div className="sm:hidden">
        <MobileBottomNav />
      </div>
    </div>
  );
};

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const token = auth.getToken();
      const user = auth.getUser();

      if (!token || !user) {
        router.replace('/login');
        return;
      }

      if (user.role === 'super_admin') {
        router.replace('/superadmin/dashboard');
        return;
      }

      // Resolve feature control before showing workspace so permission checks (read/write) are
      // correct from first paint. If user has no user-specific featureControl, fetch
      // feature_control_${role} from Settings and set it on the stored user.
      const hasUserFeatureControl = user.featureControl && Array.isArray(user.featureControl) && user.featureControl.length > 0;
      if (!hasUserFeatureControl) {
        try {
          const res = await api.getSetting(`feature_control_${user.role}`);
          if (!cancelled && res?.success && res?.data?.value?.activeModules && Array.isArray(res.data.value.activeModules)) {
            const updated = { ...user, featureControl: res.data.value.activeModules };
            auth.setUser(updated);
          }
        } catch {
          // keep stored user as-is; permissions may default elsewhere
        }
      }

      if (!cancelled) {
        setIsAuthenticated(true);
        setIsChecking(false);
      }
    };

    run();
    return () => { cancelled = true; };
  }, [router]);

  if (isChecking) {
    return (
      <div className="min-h-screen bg-bg-base flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Spinner className="w-10 h-10" />
          <p className="text-text-secondary">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <AuthProvider>
      <WorkspaceProvider>
        <SidebarProvider>
          <WorkspaceLayoutContent>{children}</WorkspaceLayoutContent>
        </SidebarProvider>
      </WorkspaceProvider>
    </AuthProvider>
  );
}
