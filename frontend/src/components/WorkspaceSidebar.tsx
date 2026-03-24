'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSidebar } from '@/contexts/SidebarContext';
import { auth } from '@/lib/auth';
import { api } from '@/lib/api';
import { MODULE_CATEGORIES, isModuleEnabled, isCategoryEnabled } from '@/config/moduleCategories';
import {
    LayoutDashboard,
    Plane,
    Users,
    Building2,
    UserCog,
    Settings,
    PiggyBank,
    BarChart3,
    CreditCard,
    Receipt,
    LogOut,
    ChevronLeft,
    ChevronRight,
    Menu,
    Layers,
    Briefcase,
    Gift,
    Clock,
    CalendarHeart,
    CalendarClock,
    CalendarDays,
    Timer,
    Fingerprint,
    UserCircle,
    HandCoins,
    AlertOctagon,
    LineChart,
    Calculator,
    ArrowRightLeft,
    ScrollText,
    BadgeDollarSign,
    TrendingDown
} from 'lucide-react';

// Module code to icon mapping
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
    EMPLOYEE_GROUPS: Layers,
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
    MANUAL_DEDUCTIONS: TrendingDown,
    HOLIDAY_CALENDAR: CalendarHeart,
    RESIGNATION: LogOut,
};

export default function WorkspaceSidebar() {
    const pathname = usePathname();
    const router = useRouter();
    const { isCollapsed, toggleSidebar } = useSidebar();
    const [user, setUser] = useState<{ name: string; email: string; role: string; emp_no?: string; featureControl?: string[] | null } | null>(null);
    const [featureControl, setFeatureControl] = useState<string[] | null>(null);
    const [isMobileOpen, setIsMobileOpen] = useState(false);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        const userData = auth.getUser();
        if (userData) {
            setUser({
                name: userData.name,
                email: userData.email,
                role: userData.role,
                emp_no: userData.emp_no,
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

    const handleLogout = () => {
        auth.logout();
        router.push('/login');
    };

    if (!mounted) return null;

    return (
        <>
            {/* Mobile Toggle Button */}
            <button
                onClick={() => setIsMobileOpen(true)}
                type="button"
                className="fixed top-3 left-3 z-[100] inline-flex items-center p-2 text-sm text-slate-500 rounded-lg sm:hidden hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-slate-400 dark:hover:bg-slate-700"
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
                {/* Collapse/Expand Button */}
                <button
                    onClick={toggleSidebar}
                    className="absolute -right-3 top-6 h-6 w-6 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-md hidden sm:flex items-center justify-center hover:bg-slate-50 transition-all z-50 text-slate-500"
                >
                    {isCollapsed ? (
                        <ChevronRight className="h-3.5 w-3.5" />
                    ) : (
                        <ChevronLeft className="h-3.5 w-3.5" />
                    )}
                </button>

                <div className="flex flex-col h-full overflow-hidden">
                    {/* Logo/Header */}
                    <div className={`px-4 py-4 flex items-center border-b border-slate-200/60 dark:border-slate-800 ${isCollapsed ? 'justify-center' : 'justify-between'}`}>
                        <div className={`flex items-center gap-3 ${isCollapsed ? 'justify-center w-full' : ''}`}>
                            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 flex-shrink-0">
                                <span className="text-sm font-bold text-white">H</span>
                            </div>
                            {(!isCollapsed || isMobileOpen) && (
                                <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">HRMS</h2>
                            )}
                        </div>
                    </div>

                    {/* Navigation */}
                    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300">
                        {MODULE_CATEGORIES.map(category => {
                            if (!isCategoryEnabled(category.code, featureControl)) return null;

                            const enabledModules = category.modules.filter(module =>
                                isModuleEnabled(module.code, featureControl)
                            );

                            if (enabledModules.length === 0) return null;

                            return (
                                <div key={category.code}>
                                    {(!isCollapsed || isMobileOpen) && (
                                        <h3 className="px-3 mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                                            {category.name}
                                        </h3>
                                    )}

                                    <ul className="space-y-1">
                                        {enabledModules.map(module => {
                                            const isActive = pathname === module.href ||
                                                (module.code === 'LEAVE_OD' && (pathname === '/leaves' || pathname === '/od')) ||
                                                (module.code === 'CCL' && pathname === '/ccl') ||
                                                (module.code === 'RESIGNATION' && pathname === '/resignations') ||
                                                (module.code === 'EMPLOYEE_GROUPS' && pathname === '/employee-groups');

                                            const Icon = moduleIcons[module.code] || LayoutDashboard;

                                            return (
                                                <li key={module.code}>
                                                    <Link
                                                        href={module.href}
                                                        onClick={() => setIsMobileOpen(false)}
                                                        className={`flex items-center px-3 py-2.5 rounded-xl transition-all duration-200 group relative
                              ${isActive
                                                                ? 'bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-900/20 dark:to-blue-900/20 text-indigo-700 dark:text-indigo-400 font-medium shadow-sm'
                                                                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
                                                            }
                              ${(isCollapsed && !isMobileOpen) ? 'justify-center px-2' : ''}
                            `}
                                                    >
                                                        <Icon className={`w-[18px] h-[18px] flex-shrink-0 transition-colors duration-200 ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300'}`} />

                                                        {(!isCollapsed || isMobileOpen) && (
                                                            <span className="ms-3 text-sm">{module.label}</span>
                                                        )}

                                                        {isActive && (!isCollapsed || isMobileOpen) && (
                                                            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-indigo-500 rounded-r-full" />
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

                    {/* User Section */}
                    <div className="border-t border-slate-200/60 dark:border-slate-800 p-3 bg-white dark:bg-black">
                        <div className={`flex items-center gap-2 p-1.5 rounded-2xl bg-slate-50/80 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-800 shadow-sm
              ${isCollapsed && !isMobileOpen ? 'flex-col' : 'flex-row'}`}>
                            <Link
                                href="/profile"
                                onClick={() => setIsMobileOpen(false)}
                                className={`flex-1 flex items-center gap-3 p-1 rounded-xl transition-all duration-200 hover:bg-white dark:hover:bg-slate-800
                  ${(isCollapsed && !isMobileOpen) ? 'justify-center p-0' : ''}`}
                                title={(isCollapsed && !isMobileOpen) ? 'Profile' : undefined}
                            >
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xs flex-shrink-0 shadow-sm transition-transform group-hover:scale-110">
                                    {user?.name?.[0]?.toUpperCase() || 'U'}
                                </div>
                                {(!isCollapsed || isMobileOpen) && (
                                    <div className="shrink-0 max-w-[100px]">
                                        <p className="text-[13px] font-semibold text-slate-900 dark:text-white truncate line-height-tight">{user?.name || 'User'}</p>
                                        <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate capitalize">{user?.role?.replace(/_/g, ' ') || '...'}</p>
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
