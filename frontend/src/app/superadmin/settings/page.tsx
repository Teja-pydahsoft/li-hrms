'use client';

import React, { useState } from 'react';
import {
  Settings,
  Users,
  Calendar,
  Briefcase,
  Banknote,
  Receipt,
  Clock,
  ShieldCheck,
  MessageSquare,
  LayoutGrid,
  ArrowRight,
  ChevronRight,
  Search,
  Zap,
  Percent,
  AlertTriangle,
  Globe,
  Menu,
  X,
  LogOut
} from 'lucide-react';

import ShiftSettings from '@/components/settings/ShiftSettings';
import EmployeeSettings from '@/components/settings/EmployeeSettings';
import LeaveSettings from '@/components/settings/LeaveSettings';
import LeavePolicySettings from '@/components/settings/LeavePolicySettings';
import LoanSettings from '@/components/settings/LoanSettings';
import PayrollSettings from '@/components/settings/PayrollSettings';
import AttendanceSettings from '@/components/settings/AttendanceSettings';
import OTSettings from '@/components/settings/OTSettings';
import PermissionsSettings from '@/components/settings/PermissionsSettings';
import CommunicationSettings from '@/components/settings/CommunicationSettings';
import FeatureControlSettings from '@/components/settings/FeatureControlSettings';
import GeneralSettings from '@/components/settings/GeneralSettings';
import AttendanceDeductionsSettings from '@/components/settings/AttendanceDeductionsSettings';
import ResignationSettings from '@/components/settings/ResignationSettings';

type TabType =
  | 'general'
  | 'employee'
  | 'leave'
  | 'leave_policy'
  | 'od'
  | 'ccl'
  | 'resignation'
  | 'shift'
  | 'attendance'
  | 'attendance_deductions'
  | 'payroll'
  | 'loan'
  | 'salary_advance'
  | 'ot'
  | 'permissions'
  | 'communications'
  | 'feature_control';

const SettingsPage = () => {
  const [activeTab, setActiveTab] = useState<TabType>('general');
  const [searchQuery, setSearchQuery] = useState('');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const menuItems = [
    { id: 'general', label: 'General Settings', icon: Globe, color: 'text-blue-500', group: 'Application' },
    { id: 'communications', label: 'Communication', icon: MessageSquare, color: 'text-purple-500', group: 'Application' },
    { id: 'feature_control', label: 'Feature Control', icon: LayoutGrid, color: 'text-orange-500', group: 'Application' },

    { id: 'employee', label: 'Employee Setup', icon: Users, color: 'text-indigo-500', group: 'Human Resources' },
    { id: 'leave', label: 'Leave Settings', icon: Calendar, color: 'text-emerald-500', group: 'Human Resources' },
    { id: 'leave_policy', label: 'Leave Policy', icon: Briefcase, color: 'text-teal-500', group: 'Human Resources' },
    { id: 'od', label: 'On-Duty (OD)', icon: Briefcase, color: 'text-teal-500', group: 'Human Resources' },
    { id: 'ccl', label: 'Comp. Casual Leave (CCL)', icon: Zap, color: 'text-amber-500', group: 'Human Resources' },
    { id: 'resignation', label: 'Resignation Policy', icon: LogOut, color: 'text-orange-500', group: 'Human Resources' },

    { id: 'shift', label: 'Shift Schedules', icon: Clock, color: 'text-amber-500', group: 'Operations' },
    { id: 'attendance', label: 'Attendance Sync', icon: Zap, color: 'text-yellow-500', group: 'Operations' },
    { id: 'attendance_deductions', label: 'Deduction Rules', icon: AlertTriangle, color: 'text-red-500', group: 'Operations' },
    { id: 'ot', label: 'Overtime (OT)', icon: Percent, color: 'text-rose-500', group: 'Operations' },

    { id: 'payroll', label: 'Payroll & Cycle', icon: Receipt, color: 'text-cyan-500', group: 'Finance' },
    { id: 'loan', label: 'Loan Policies', icon: Banknote, color: 'text-green-500', group: 'Finance' },
    { id: 'salary_advance', label: 'Salary Advance', icon: ShieldCheck, color: 'text-lime-500', group: 'Finance' },

    { id: 'permissions', label: 'Out-Pass Config', icon: ArrowRight, color: 'text-slate-500', group: 'Other' },
  ];

  const filteredMenu = searchQuery
    ? menuItems.filter(item => item.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : menuItems;

  const groupedMenu = filteredMenu.reduce((acc: any, item) => {
    if (!acc[item.group]) acc[item.group] = [];
    acc[item.group].push(item);
    return acc;
  }, {});

  const renderActiveSection = () => {
    switch (activeTab) {
      case 'general': return <GeneralSettings />;
      case 'employee': return <EmployeeSettings />;
      case 'leave': return <LeaveSettings type="leave" />;
      case 'leave_policy': return <LeavePolicySettings />;
      case 'od': return <LeaveSettings type="od" />;
      case 'ccl': return <LeaveSettings type="ccl" />;
      case 'resignation': return <ResignationSettings />;
      case 'shift': return <ShiftSettings />;
      case 'attendance': return <AttendanceSettings />;
      case 'attendance_deductions': return <AttendanceDeductionsSettings />;
      case 'payroll': return <PayrollSettings />;
      case 'loan': return <LoanSettings type="loan" />;
      case 'salary_advance': return <LoanSettings type="salary_advance" />;
      case 'ot': return <OTSettings />;
      case 'permissions': return <PermissionsSettings />;
      case 'communications': return <CommunicationSettings />;
      case 'feature_control': return <FeatureControlSettings />;
      default: return <GeneralSettings />;
    }
  };

  return (
    <div className="flex min-h-screen bg-[#F8FAFC] dark:bg-[#0F172A] -m-4 sm:-m-5 lg:-m-6 overflow-x-hidden">
      {/* Mobile Menu Button */}
      <button
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        className="fixed bottom-6 right-4 sm:right-6 z-50 lg:hidden flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-2xl hover:bg-indigo-700 transition-all hover:scale-110"
      >
        {isMobileMenuOpen ? <X className="h-5 w-5 sm:h-6 sm:w-6" /> : <Menu className="h-5 w-5 sm:h-6 sm:w-6" />}
      </button>

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Settings Navigation Sidebar */}
      <aside className={`
        fixed lg:sticky top-0 z-40 h-screen w-64 sm:w-72 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-[#1E293B] flex-shrink-0
        transition-transform duration-300 ease-in-out
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        lg:flex overflow-hidden
      `}>
        <div className="p-4 sm:p-6">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-xl bg-indigo-600 shadow-lg shadow-indigo-500/20 flex-shrink-0">
              <Settings className="h-4 w-4 sm:h-6 sm:w-6 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white truncate">Admin Settings</h1>
              <p className="text-[9px] sm:text-[10px] font-bold text-gray-400 uppercase tracking-widest truncate">Global Configuration</p>
            </div>
          </div>

          <div className="mt-4 sm:mt-6 relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 sm:h-4 sm:w-4 -translate-y-1/2 text-gray-400 flex-shrink-0" />
            <input
              type="text"
              placeholder="Search settings..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border-none bg-gray-50 px-8 sm:px-9 py-1.5 sm:py-2 text-xs font-medium placeholder:text-gray-400 focus:ring-2 focus:ring-indigo-500 dark:bg-[#0F172A] dark:text-white shadow-sm"
            />
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 sm:px-4 pb-8 space-y-5 sm:space-y-7 custom-scrollbar">
          {Object.entries(groupedMenu).map(([group, items]: [string, any]) => (
            <div key={group} className="space-y-1">
              <h3 className="px-3 sm:px-4 text-[9px] sm:text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] mb-2 truncate">{group}</h3>
              {items.map((item: any) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    setIsMobileMenuOpen(false); // Close menu on mobile after selection
                  }}
                  className={`group flex w-full items-center justify-between rounded-xl px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold transition-all ${activeTab === item.id
                    ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-400'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-[#0F172A] dark:hover:text-white'
                    }`}
                >
                  <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                    <item.icon className={`h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0 ${activeTab === item.id ? item.color : 'text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300'}`} />
                    <span className="truncate">{item.label}</span>
                  </div>
                  <ChevronRight className={`h-3 w-3 flex-shrink-0 transition-transform ${activeTab === item.id ? 'translate-x-1 outline-none' : 'opacity-0 group-hover:opacity-100'}`} />
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="p-3 sm:p-4 border-t border-gray-100 dark:border-gray-800">
          <div className="p-3 sm:p-4 rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-700 text-white shadow-xl">
            <p className="text-[10px] sm:text-xs font-bold opacity-80 mb-1 truncate">PRO FEATURES</p>
            <p className="text-[9px] sm:text-[10px] leading-tight opacity-60 truncate">Modular configuration system v2.0</p>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 w-full overflow-x-hidden">
        <div className="p-3 xs:p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">
          <div className="w-full overflow-x-hidden">
            {renderActiveSection()}
          </div>
        </div>
      </main>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #E2E8F0;
          border-radius: 10px;
        }
        .dark .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #334155;
        }
      `}</style>
    </div>
  );
};

export default SettingsPage;
