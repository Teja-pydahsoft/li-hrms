import { clearWorkspaceData } from '@/contexts/WorkspaceContext';

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  roles: string[];
  department?: string | { _id: string; name: string };
  scope?: 'global' | 'restricted';
  departments?: { _id: string; name: string; code?: string }[];
  employeeId?: string;
  employeeRef?: string;
  emp_no?: string;
  featureControl?: string[];
}

export const auth = {
  setToken: (token: string) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('token', token);
    }
  },

  getToken: (): string | null => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('token');
    }
    return null;
  },

  setUser: (user: User) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('user', JSON.stringify(user));
    }
  },

  getUser: (): User | null => {
    if (typeof window !== 'undefined') {
      const userStr = localStorage.getItem('user');
      return userStr ? JSON.parse(userStr) : null;
    }
    return null;
  },

  logout: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      // Clear workspace data on logout
      clearWorkspaceData();

      // Dispatch custom event to notify React contexts to clear memory state
      window.dispatchEvent(new CustomEvent('auth-logout'));
    }
  },

  isAuthenticated: (): boolean => {
    return auth.getToken() !== null;
  },

  // Super Admin goes to admin panel, everyone else goes to workspace-based dashboard
  getRoleBasedPath: (role: string): string => {
    if (role === 'super_admin') {
      return '/superadmin/dashboard';
    }
    // All other users go to workspace-based dashboard
    return '/dashboard';
  },

  // Check if user is super admin
  isSuperAdmin: (): boolean => {
    const user = auth.getUser();
    return user?.role === 'super_admin';
  },

  // Get authentication headers for API requests
  getAuthHeader: async (): Promise<Record<string, string>> => {
    const token = auth.getToken();
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  },
};
