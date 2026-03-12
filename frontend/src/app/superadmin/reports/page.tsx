'use client';

import { useState } from 'react';
import PayrollTransactionsTab from './payroll-transactions-tab';
import AttendanceReportsTab from '../../(workspace)/reports/attendance-reports-tab';
import ThumbReportsTab from '../../(workspace)/reports/thumb-reports-tab';
import { BarChart2, Fingerprint, CreditCard } from 'lucide-react';

type TabType = 'payroll' | 'attendance' | 'biometric';

const TAB_CONFIG = {
  payroll: { label: 'Payroll', icon: CreditCard, activeBg: 'bg-violet-600' },
  attendance: { label: 'Attendance', icon: BarChart2, activeBg: 'bg-indigo-600' },
  biometric: { label: 'Biometric', icon: Fingerprint, activeBg: 'bg-emerald-600' },
};

const ALL_TABS: TabType[] = ['payroll', 'attendance', 'biometric'];

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<TabType>('attendance');

  return (
    <div className="w-full min-h-screen bg-slate-50/50 dark:bg-transparent">
      {/* Page Header */}
      <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/80 backdrop-blur px-4 sm:px-6 md:px-8 py-4">
        <div>
          <h1 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">Reports & Analytics</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Attendance, payroll, and biometric data consolidated</p>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 mt-4">
          {ALL_TABS.map((tabId) => {
            const cfg = TAB_CONFIG[tabId];
            const Icon = cfg.icon;
            const isActive = activeTab === tabId;
            return (
              <button
                key={tabId}
                onClick={() => setActiveTab(tabId)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${isActive
                    ? `${cfg.activeBg} text-white shadow-md scale-[1.02]`
                    : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                  }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {cfg.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      <div className="px-4 sm:px-6 md:px-8 py-5">
        {activeTab === 'payroll' && <PayrollTransactionsTab />}
        {activeTab === 'attendance' && <AttendanceReportsTab />}
        {activeTab === 'biometric' && <ThumbReportsTab />}
      </div>
    </div>
  );
}
