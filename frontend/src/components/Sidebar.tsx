'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSidebar } from '@/contexts/SidebarContext';
import { auth } from '@/lib/auth';
import { useState, useEffect } from 'react';
import { isModuleEnabled } from '@/config/moduleCategories';
import { User } from '@/lib/auth';
import {
  LayoutDashboard,
  ShieldCheck,
  Shield,
  Users,
  FileCog,
  CalendarClock,
  Clock,
  AlertTriangle,
  CalendarDays,
  Plane,
  Watch,
  Building2,
  Building,
  Settings2,
  UserCog,
  Gift,
  Search,
  BarChart3,
  CreditCard,
  Table2,
  Receipt,
  Banknote,
  Wallet,
  PiggyBank,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Menu,
  X
} from 'lucide-react';

// Icon Components - Helper type not needed with Lucide, but keeping structure similar
type IconComponent = React.ComponentType<{ className?: string }>;

export type NavItem = {
  href: string;
  label: string;
  icon: IconComponent;
  category: string;
  moduleCode: string;
};

const navItems: NavItem[] = [
  { href: '/superadmin/dashboard', label: 'Dashboard', icon: LayoutDashboard, category: 'Main', moduleCode: 'DASHBOARD' },
  { href: '/superadmin/security/gate', label: 'Security Gate', icon: ShieldCheck, category: 'Main', moduleCode: 'SECURITY' },
  { href: '/superadmin/employees', label: 'Employees', icon: Users, category: 'Employee Management', moduleCode: 'EMPLOYEES' },
  { href: '/superadmin/resignations', label: 'Resignations', icon: LogOut, category: 'Employee Management', moduleCode: 'RESIGNATION' },
  { href: '/superadmin/employees/form-settings', label: 'Form Settings', icon: FileCog, category: 'Employee Management', moduleCode: 'EMPLOYEES' },
  { href: '/superadmin/attendance', label: 'Attendance', icon: CalendarClock, category: 'Time & Attendance', moduleCode: 'ATTENDANCE' },
  { href: '/superadmin/ot-permissions', label: 'OT & Permissions', icon: Clock, category: 'Time & Attendance', moduleCode: 'OT_PERMISSIONS' },
  { href: '/superadmin/confused-shifts', label: 'Confused Shifts', icon: AlertTriangle, category: 'Time & Attendance', moduleCode: 'CONFUSED_SHIFTS' },
  { href: '/superadmin/shift-roster', label: 'Shift Roster', icon: CalendarDays, category: 'Time & Attendance', moduleCode: 'SHIFT_ROSTER' },
  { href: '/superadmin/holidays', label: 'Holiday Calendar', icon: CalendarDays, category: 'Time & Attendance', moduleCode: 'HOLIDAY_CALENDAR' },
  { href: '/superadmin/leaves', label: 'Leave & OD', icon: CalendarDays, category: 'Time & Attendance', moduleCode: 'LEAVE_OD' },
  { href: '/superadmin/ccl', label: 'CCL (Compensatory)', icon: Gift, category: 'Time & Attendance', moduleCode: 'CCL' },
  { href: '/superadmin/shifts', label: 'Shifts', icon: Watch, category: 'Time & Attendance', moduleCode: 'SHIFTS' },
  { href: '/superadmin/divisions', label: 'Divisions', icon: Building2, category: 'Organization', moduleCode: 'DIVISIONS' },
  { href: '/superadmin/departments', label: 'Departments', icon: Building, category: 'Organization', moduleCode: 'DEPARTMENTS' },
  { href: '/superadmin/settings/departmental', label: 'Departmental Settings', icon: Settings2, category: 'Organization', moduleCode: 'DEPARTMENTAL_SETTINGS' },
  { href: '/superadmin/users', label: 'Users', icon: UserCog, category: 'Administration', moduleCode: 'USERS' },
  { href: '/superadmin/live-attendance', label: 'Live Attendance', icon: Clock, category: 'Administration', moduleCode: 'LIVE_ATTENDANCE' },
  { href: '/superadmin/reports', label: 'Reports', icon: BarChart3, category: 'Administration', moduleCode: 'REPORTS' },
  { href: '/superadmin/payments', label: 'Payments', icon: CreditCard, category: 'Finance & Payroll', moduleCode: 'PAYMENTS' },
  { href: '/superadmin/payments/second-salary', label: '2nd Salary Payments', icon: Banknote, category: 'Finance & Payroll', moduleCode: 'PAYMENTS' },
  { href: '/superadmin/pay-register', label: 'Pay Register', icon: Sheet, category: 'Finance & Payroll', moduleCode: 'PAY_REGISTER' },
  { href: '/superadmin/payroll-config', label: 'Payroll Configuration', icon: Settings, category: 'Finance & Payroll', moduleCode: 'PAYROLL_CONFIG' },
  { href: '/superadmin/statutory-deductions', label: 'Statutory Deductions', icon: Shield, category: 'Finance & Payroll', moduleCode: 'STATUTORY_DEDUCTIONS' },
  { href: '/superadmin/payslips', label: 'Payslips', icon: Receipt, category: 'Finance & Payroll', moduleCode: 'PAYSLIPS' },
  { href: '/superadmin/paysheet', label: 'Paysheet', icon: Table2, category: 'Finance & Payroll', moduleCode: 'PAYSLIPS' },
  { href: '/superadmin/payslips/second-salary', label: '2nd Salary Payslips', icon: Receipt, category: 'Finance & Payroll', moduleCode: 'PAYSLIPS' },
  { href: '/superadmin/arrears', label: 'Arrears', icon: Banknote, category: 'Finance & Payroll', moduleCode: 'ARREARS' },
  { href: '/superadmin/manual-deductions', label: 'Manual Deductions', icon: Banknote, category: 'Finance & Payroll', moduleCode: 'MANUAL_DEDUCTIONS' },
  { href: '/superadmin/allowances-deductions', label: 'Allowances & Deductions', icon: Wallet, category: 'Finance & Payroll', moduleCode: 'ALLOWANCES_DEDUCTIONS' },
  { href: '/superadmin/loans', label: 'Loans & Salary Advance', icon: PiggyBank, category: 'Finance & Payroll', moduleCode: 'LOANS_SALARY_ADVANCE' },
  { href: '/superadmin/settings', label: 'General Settings', icon: Settings, category: 'Settings', moduleCode: 'GENERAL_SETTINGS' },
];

export default function Sidebar() {
  const { isCollapsed, toggleSidebar } = useSidebar();
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const userData = auth.getUser();
    if (userData) {
      setUser(userData);
    }
  }, []);

  if (!mounted) return null;

  // Filter items based on user permissions
  const filteredNavItems = user?.role === 'super_admin'
    ? navItems
    : navItems.filter(item => isModuleEnabled(item.moduleCode, user?.featureControl || null));

  const handleLogout = () => {
    auth.logout();
    router.push('/login');
  };

  const getRoleLabel = (role: string) => {
    const roleLabels: Record<string, string> = {
      super_admin: 'Super Admin',
      sub_admin: 'Sub Admin',
      hr: 'HR',
      manager: 'Manager',
      hod: 'HOD',
      employee: 'Employee',
    };
    return roleLabels[role] || role;
  };

  return (
    <>
      {/* Mobile Toggle Button */}
      <button
        onClick={() => setIsMobileOpen(true)}
        type="button"
        className="fixed top-3 left-3 z-[100] inline-flex items-center p-2 text-sm text-slate-500 rounded-lg sm:hidden hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-slate-400 dark:hover:bg-slate-700 dark:focus:ring-gray-600"
      >
        <span className="sr-only">Open sidebar</span>
        <Menu className="w-6 h-6" />
      </button>

      {/* Overlay for mobile */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-[90] bg-gray-900/50 sm:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Sidebar Aside */}
      <aside
        className={`fixed top-0 left-0 h-screen bg-white dark:bg-black border-r border-slate-200/60 dark:border-slate-800 transition-all duration-300 ease-in-out z-[100]
          ${isMobileOpen ? 'translate-x-0 w-64' : '-translate-x-full sm:translate-x-0'} 
          ${isCollapsed ? 'sm:w-[70px]' : 'sm:w-[240px]'} 
          `}
        aria-label="Sidebar"
      >
        {/* Collapse/Expand Button (Desktop only) */}
        <button
          onClick={toggleSidebar}
          className="absolute -right-3 top-6 h-6 w-6 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-md hidden sm:flex items-center justify-center hover:bg-slate-50 dark:hover:bg-slate-700 transition-all z-50 text-slate-500 dark:text-slate-400"
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" />
          )}
        </button>

        {/* Sidebar Content */}
        <div className="flex flex-col h-full overflow-hidden">
          {/* Logo/Header */}
          <div className={`px-4 py-4 flex items-center border-b border-slate-200/60 dark:border-slate-800 ${isCollapsed ? 'justify-center' : 'justify-between'}`}>
            <div className={`flex items-center gap-3 ${isCollapsed ? 'justify-center w-full' : ''}`}>
              <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20 flex-shrink-0">
                <span className="text-sm font-bold text-white">H</span>
              </div>
              {(!isCollapsed || isMobileOpen) && (
                <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">HRMS</h2>
              )}
            </div>

            {/* Mobile Close */}
            {isMobileOpen && (
              <button
                onClick={() => setIsMobileOpen(false)}
                className="sm:hidden text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600">
            {Array.from(new Set(filteredNavItems.map(i => i.category))).map(category => {
              const categoryItems = filteredNavItems.filter(i => i.category === category);

              if (categoryItems.length === 0) return null;

              return (
                <div key={category}>
                  {/* Category Header */}
                  {(!isCollapsed || isMobileOpen) && (
                    <h3 className="px-3 mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                      {category}
                    </h3>
                  )}

                  <ul className="space-y-1">
                    {categoryItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = pathname === item.href;

                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            onClick={() => setIsMobileOpen(false)}
                            className={`flex items-center px-3 py-2.5 rounded-xl transition-all duration-200 group relative
                              ${isActive
                                ? 'bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20 text-emerald-700 dark:text-emerald-400 font-medium shadow-sm'
                                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
                              }
                              ${(isCollapsed && !isMobileOpen) ? 'justify-center px-2' : ''}
                            `}
                            title={(isCollapsed && !isMobileOpen) ? item.label : undefined}
                          >
                            <Icon className={`w-[18px] h-[18px] flex-shrink-0 transition-colors duration-200 ${isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300'}`} />

                            {(!isCollapsed || isMobileOpen) && (
                              <span className="ms-3 text-sm">{item.label}</span>
                            )}

                            {/* Active Indicator Strip */}
                            {isActive && (!isCollapsed || isMobileOpen) && (
                              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-emerald-500 rounded-r-full" />
                            )}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </nav>

          {/* User Section & Logout */}
          <div className="border-t border-slate-200/60 dark:border-slate-800 p-3 bg-white dark:bg-black">
            <div className={`flex items-center gap-2 p-1.5 rounded-2xl bg-slate-50/80 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-800 shadow-sm
              ${isCollapsed && !isMobileOpen ? 'flex-col' : 'flex-row'}`}>
              <Link
                href="/superadmin/profile"
                onClick={() => setIsMobileOpen(false)}
                className={`flex-1 flex items-center gap-3 p-1 rounded-xl transition-all duration-200 hover:bg-white dark:hover:bg-slate-800
                  ${(isCollapsed && !isMobileOpen) ? 'justify-center p-0' : ''}`}
                title={(isCollapsed && !isMobileOpen) ? 'Profile' : undefined}
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white font-bold text-xs flex-shrink-0 shadow-sm transition-transform group-hover:scale-110">
                  {user?.name?.[0]?.toUpperCase() || 'U'}
                </div>
                {(!isCollapsed || isMobileOpen) && (
                  <div className="shrink-0 max-w-[100px]">
                    <p className="text-[13px] font-semibold text-slate-900 dark:text-white truncate line-height-tight">{user?.name || 'User'}</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{user ? getRoleLabel(user.role) : '...'}</p>
                  </div>
                )}
              </Link>

              <button
                onClick={handleLogout}
                className={`flex items-center justify-center p-2 rounded-xl transition-all duration-200 text-slate-500 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800 hover:text-red-600 dark:hover:text-red-400 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 shadow-sm hover:shadow-md
                  ${(isCollapsed && !isMobileOpen) ? 'w-full mt-1' : ''}`}
                title="Logout"
              >
                <LogOut className="h-[18px] w-[18px] flex-shrink-0" />
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
