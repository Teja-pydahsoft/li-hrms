'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { auth } from '@/lib/auth';
import { api } from '@/lib/api';
import { MODULE_CATEGORIES, isModuleEnabled, isCategoryEnabled } from '@/config/moduleCategories';
import {
  LayoutDashboard,
  MoreHorizontal,
  X,
  Users,
  Building2,
  UserCog,
  Settings,
  PiggyBank,
  Briefcase,
  Gift,
  Clock,
  CalendarDays,
  Timer,
  Fingerprint,
  CalendarHeart,
  CalendarClock,
  UserCircle,
  HandCoins,
  AlertOctagon,
  LineChart,
  Calculator,
  ArrowRightLeft,
  ScrollText,
  BadgeDollarSign,
  LogOut,
  Receipt
} from 'lucide-react';
import { cn } from '@/lib/utils'; // Assuming this exists, based on usual project structure

// Module code to icon mapping (Same as Sidebar)
const moduleIcons: Record<string, any> = {
  DASHBOARD: LayoutDashboard,
  LEAVE: CalendarClock,
  OD: Briefcase,
  LEAVE_OD: CalendarDays,
  CCL: Gift,
  EMPLOYEE: Users,
  EMPLOYEES: Users,
  SHIFT: Clock,
  SHIFTS: Clock,
  SHIFT_ROSTER: CalendarDays,
  DEPARTMENT: Building2,
  DEPARTMENTS: Building2,
  ATTENDANCE: Fingerprint,
  PROFILE: UserCircle,
  SETTINGS: Settings,
  LOANS: PiggyBank,
  LOAN: PiggyBank,
  OT_PERMISSIONS: Timer,
  CONFUSED_SHIFTS: AlertOctagon,
  USERS: UserCog,
  REPORTS: LineChart,
  ALLOWANCES_DEDUCTIONS: Calculator,
  PAYROLL_TRANSACTIONS: ArrowRightLeft,
  PAY_REGISTER: ScrollText,
  PAYSLIPS: Receipt,
  PAYROLL: BadgeDollarSign,
  LOANS_SALARY_ADVANCE: HandCoins,
  HOLIDAY_CALENDAR: CalendarHeart,
  RESIGNATION: LogOut,
};

const shortModuleLabels: Record<string, string> = {
  DASHBOARD: 'Dash',
  LEAVE: 'Leave',
  OD: 'OD',
  LEAVE_OD: 'L/OD',
  CCL: 'CCL',
  EMPLOYEE: 'Emps',
  EMPLOYEES: 'Emps',
  SHIFT: 'Shift',
  SHIFTS: 'Shift',
  SHIFT_ROSTER: 'Roster',
  DEPARTMENT: 'Dept',
  DEPARTMENTS: 'Depts',
  ATTENDANCE: 'Attn',
  PROFILE: 'Me',
  SETTINGS: 'Sets',
  LOANS: 'Loans',
  LOAN: 'Loan',
  OT_PERMISSIONS: 'OT',
  CONFUSED_SHIFTS: 'Alert',
  USERS: 'Users',
  REPORTS: 'Rpts',
  ALLOWANCES_DEDUCTIONS: 'Allow',
  PAYROLL_TRANSACTIONS: 'Txns',
  PAY_REGISTER: 'Reg',
  PAYSLIPS: 'Pay',
  PAYROLL: 'Roll',
  LOANS_SALARY_ADVANCE: 'Adv',
  HOLIDAY_CALENDAR: 'Hols',
  RESIGNATION: 'Resign',
};

export default function MobileBottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ role: string; featureControl?: string[] | null } | null>(null);
  const [featureControl, setFeatureControl] = useState<string[] | null>(null);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMounted(true);
    const userData = auth.getUser();
    if (userData) {
      setUser({
        role: userData.role,
        featureControl: userData.featureControl || null
      });
    }
  }, []);

  useEffect(() => {
    const fetchFeatureControl = async () => {
      if (!user?.role) return;

      // Priority 1: User-specific feature control (overrides)
      if (user.featureControl && Array.isArray(user.featureControl) && user.featureControl.length > 0) {
        setFeatureControl(user.featureControl);
        return;
      }

      // Priority 2: Fetch role-based defaults from Settings
      try {
        const response = await api.getSetting(`feature_control_${user.role}`);
        if (response.success && response.data?.value && Array.isArray(response.data.value.activeModules)) {
          setFeatureControl(response.data.value.activeModules);
          return;
        }
      } catch (error) {
        console.error('Error fetching RBAC settings:', error);
      }

      // Priority 3: Hardcoded fallbacks (failsafe)
      const managementRoles = ['manager', 'hr', 'hod'];
      if (managementRoles.includes(user.role)) {
        setFeatureControl(MODULE_CATEGORIES.flatMap(c => c.modules.map(m => m.code)));
      } else {
        setFeatureControl(['DASHBOARD', 'LEAVE_OD', 'ATTENDANCE', 'PROFILE', 'PAYSLIPS']);
      }
    };
    fetchFeatureControl();
  }, [user?.role, user?.featureControl]);

  // Close "More" menu on route change
  useEffect(() => {
    setIsMoreOpen(false);
  }, [pathname]);

  // Flatten and filter enabled modules
  const allEnabledModules = useMemo(() => {
    if (!mounted || !featureControl) return [];

    const modules: any[] = [];
    MODULE_CATEGORIES.forEach(category => {
      // Check if category is enabled (not really used in flat list but good to check)
      if (!isCategoryEnabled(category.code, featureControl)) return;

      category.modules.forEach(module => {
        if (isModuleEnabled(module.code, featureControl)) {
          modules.push(module);
        }
      });
    });
    return modules;
  }, [mounted, featureControl]);

  if (!mounted) return null;

  // Design requirement:
  // 1. Center button is ALWAYS Dashboard
  // 2. We have 5 slots total (Left 2, Center 1, Right 2)
  // 3. Right-most slot becomes "More" if items > 5

  const dashboardModule = allEnabledModules.find(m => m.code === 'DASHBOARD');
  const otherModules = allEnabledModules.filter(m => m.code !== 'DASHBOARD');

  const needsMoreButton = otherModules.length > 4;

  const leftModules = otherModules.slice(0, 2);
  const rightModules = needsMoreButton ? otherModules.slice(2, 3) : otherModules.slice(2, 4);
  const moreModules = needsMoreButton ? otherModules.slice(3) : []; // Modules in the "More" menu

  // Helper to check active state
  const isActive = (href: string, code: string) => {
    return pathname === href ||
      (code === 'LEAVE_OD' && (pathname === '/leaves' || pathname === '/od')) ||
      (code === 'CCL' && pathname === '/ccl');
  };

  const handleLogout = () => {
    auth.logout();
    router.push('/login');
    setIsMoreOpen(false);
  };

  return (
    <>
      {/* Spacer to prevent content from being hidden behind detailed nav */}
      <div className="h-24 sm:hidden" />

      {/* Main Bottom Nav */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 pb-safe sm:hidden shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">

        <div className="flex justify-between items-center h-16 px-2 relative">

          {/* Left Side Modules */}
          <div className="flex flex-1 justify-around items-center">
            {leftModules.map((module) => {
              const Icon = moduleIcons[module.code] || LayoutDashboard;
              const active = isActive(module.href, module.code);
              return (
                <Link
                  key={module.code}
                  href={module.href}
                  className={cn(
                    "flex flex-col items-center justify-center w-12 h-full gap-1 transition-colors",
                    active ? "text-indigo-600 dark:text-indigo-400" : "text-slate-500 dark:text-slate-400"
                  )}
                >
                  <Icon strokeWidth={active ? 2.5 : 2} className="w-6 h-6" />
                  <span className="text-[9px] font-medium truncate max-w-full">{module.label.split(' ')[0]}</span>
                </Link>
              );
            })}
            {/* Fill empty slots if less than 2 left modules */}
            {leftModules.length < 2 && <div className="w-12" />}
            {leftModules.length < 1 && <div className="w-12" />}
          </div>

          {/* Center Dashboard Button Container */}
          <div className="relative -top-6 mx-2 shrink-0">
            <Link
              href={dashboardModule?.href || '/dashboard'}
              className={cn(
                "flex items-center justify-center w-14 h-14 rounded-full shadow-lg shadow-indigo-500/30 transition-transform active:scale-95 bg-linear-to-br from-indigo-500 to-indigo-600 text-white border-4 border-white dark:border-slate-900",
                isActive(dashboardModule?.href || '/dashboard', 'DASHBOARD') && "ring-2 ring-indigo-200 dark:ring-indigo-900"
              )}
            >
              <LayoutDashboard className="w-6 h-6" />
            </Link>
            <div className="text-center mt-1">
              <span className={cn(
                "text-[9px] font-bold block",
                isActive(dashboardModule?.href || '/dashboard', 'DASHBOARD') ? "text-indigo-600 dark:text-indigo-400" : "text-slate-500 dark:text-slate-400"
              )}>
                Dash
              </span>
            </div>
          </div>

          {/* Right Side Modules */}
          <div className="flex flex-1 justify-around items-center relative">
            {rightModules.map((module) => {
              const Icon = moduleIcons[module.code] || LayoutDashboard;
              const active = isActive(module.href, module.code);
              return (
                <Link
                  key={module.code}
                  href={module.href}
                  className={cn(
                    "flex flex-col items-center justify-center w-12 h-full gap-1 transition-colors",
                    active ? "text-indigo-600 dark:text-indigo-400" : "text-slate-500 dark:text-slate-400"
                  )}
                >
                  <Icon strokeWidth={active ? 2.5 : 2} className="w-6 h-6" />
                  <span className="text-[9px] font-medium truncate max-w-full">{module.label.split(' ')[0]}</span>
                </Link>
              );
            })}

            {/* More Button */}
            {needsMoreButton && (
              <div className="relative">
                <button
                  ref={moreButtonRef}
                  onClick={() => setIsMoreOpen(!isMoreOpen)}
                  className={cn(
                    "flex flex-col items-center justify-center w-12 h-full gap-1 transition-colors relative z-50",
                    isMoreOpen ? "text-indigo-600 dark:text-indigo-400" : "text-slate-500 dark:text-slate-400"
                  )}
                >
                  <div className={cn("p-1 rounded-full transition-colors duration-200", isMoreOpen && "bg-indigo-100 dark:bg-indigo-900/40")}>
                    {isMoreOpen ? <X className="w-5 h-5" /> : <MoreHorizontal className="w-6 h-6" />}
                  </div>
                  <span className="text-[9px] font-medium">More</span>
                </button>

                {/* Vertical Pill Bar - Anchored to the More button */}
                {isMoreOpen && (
                  <div
                    className="absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 flex flex-col items-center gap-3 p-1.5 bg-white/10 dark:bg-slate-900/60 backdrop-blur-xl border border-white/20 dark:border-slate-800/50 rounded-full shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-300 z-40 max-h-[60vh] overflow-y-auto no-scrollbar"
                    style={{ width: '3.5rem' }} // Fixed width like the image
                  >
                    {/* Modules inside the pill */}
                    {moreModules.map((module, idx) => {
                      const Icon = moduleIcons[module.code] || LayoutDashboard;
                      const active = isActive(module.href, module.code);
                      return (
                        <Link
                          key={module.code}
                          href={module.href}
                          className="group relative flex flex-col items-center justify-center w-12 h-14 shrink-0 gap-0.5"
                        >
                          {/* Icon Container */}
                          <div className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center transition-all",
                            active
                              ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-md transform scale-105"
                              : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                          )}>
                            <Icon className="w-5 h-5" strokeWidth={active ? 2.5 : 2} />
                          </div>

                          {/* Short Label */}
                          <span className={cn(
                            "text-[8px] font-bold  tracking-tight text-center leading-none",
                            active ? "text-slate-900 dark:text-white" : "text-slate-500 dark:text-slate-400"
                          )}>
                            {shortModuleLabels[module.code] || module.label.slice(0, 4)}
                          </span>
                        </Link>
                      );
                    })}

                    {/* Divider */}
                    {moreModules.length > 0 && (
                      <div className="w-4 h-px bg-slate-300 dark:bg-slate-700 my-1 shrink-0" />
                    )}

                    {/* Logout Button */}
                    <button
                      onClick={handleLogout}
                      className="group relative flex flex-col items-center justify-center w-12 h-14 shrink-0 gap-0.5"
                    >
                      <div className="w-10 h-10 rounded-full flex items-center justify-center transition-all bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40">
                        <LogOut className="w-5 h-5" />
                      </div>
                      <span className="text-[8px] font-bold tracking-tight text-center leading-none text-red-600/70 dark:text-red-400/70">
                        End
                      </span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* In-bar Logout Button (When modules <= 4) */}
            {!needsMoreButton && allEnabledModules.length <= 4 && (
              <button
                onClick={handleLogout}
                className="flex flex-col items-center justify-center w-12 h-full gap-1 transition-colors text-red-500 dark:text-red-400"
              >
                <LogOut strokeWidth={2} className="w-6 h-6" />
                <span className="text-[9px] font-medium">End</span>
              </button>
            )}

            {!needsMoreButton && ((allEnabledModules.length <= 4 && rightModules.length < 1) || (allEnabledModules.length > 4 && rightModules.length < 2)) && <div className="w-12" />}
          </div>
        </div>
      </div>

      {/* Background Overlay (Click to close) - Transparent now */}
      {isMoreOpen && (
        <div
          className="fixed inset-0 z-40 sm:hidden"
          onClick={() => setIsMoreOpen(false)}
        />
      )}
    </>
  );
}
