'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import LiquidEther from '@/components/LiquidEther';
import '@/components/LiquidEther.css';
import { ChevronRight, ShieldCheck, Zap, Users, BarChart3, Clock, CreditCard } from 'lucide-react';

export default function Home() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [currentLine, setCurrentLine] = useState(0);
  const [prevLine, setPrevLine] = useState(-1);

  const lines = [
    "Workforce Potential",
    "Employee Experience",
    "Talent Strategy",
    "Payroll Dynamics",
    "People Management",
    "Organizational Brilliance"
  ];

  useEffect(() => {
    // Check if user is already authenticated
    const token = auth.getToken();
    const user = auth.getUser();

    if (token && user) {
      // User is authenticated, redirect to their dashboard
      const dashboardPath = auth.getRoleBasedPath(user.role);
      router.replace(dashboardPath);
    } else {
      // No token, show welcome page
      setChecking(false);
    }

    // Headline rotation interval
    const timer = setInterval(() => {
      setPrevLine(currentLine);
      setCurrentLine((prev) => (prev + 1) % lines.length);
    }, 5000);

    return () => clearInterval(timer);
  }, [router, lines.length, currentLine]);

  // Show loading while checking authentication
  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent"></div>
          <p className="text-slate-600 font-light">Loading experience...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col min-h-screen overflow-hidden bg-slate-50 text-slate-900">
      {/* Hero Background Image with Overlay */}
      <div className="fixed inset-0 z-0 w-full h-full pointer-events-none">
        <img 
          src="/images/hero_bg.png" 
          alt="HRMS Background" 
          className="w-full h-full object-cover opacity-80"
        />
        <div className="absolute inset-0 hero-bg-overlay" />
      </div>

      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-black/5 h-20">
        <div className="max-w-7xl mx-auto h-full px-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl flex items-center justify-center shadow-lg">
              <ShieldCheck className="text-white w-6 h-6" />
            </div>
            <span className="text-xl font-display font-bold tracking-tight text-slate-900">
              <span className="text-emerald-600">HRMS</span>
            </span>
          </div>
          
          <Link
            href="/login"
            className="inline-flex items-center justify-center px-5 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-all shadow-md hover:shadow-lg active:scale-95"
          >
            Sign In
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <main className="relative z-10 min-h-screen flex items-center justify-center pt-20 pb-12">
        <div className="max-w-7xl mx-auto px-6 w-full">
          <div className="flex flex-col items-center text-center max-w-4xl mx-auto animate-fade-in-up">
            <h1 className="text-5xl md:text-7xl font-display font-bold tracking-tight text-slate-900 leading-[1.1] mb-8">
              Revolutionize your <br />
              <div className="h-[1.2em] relative flex justify-center">
                {/* Outgoing Line */}
                {prevLine !== -1 && (
                  <span 
                    key={`prev-${prevLine}`}
                    className="text-gradient absolute top-0 animate-headline-exit whitespace-nowrap"
                  >
                    {lines[prevLine]}
                  </span>
                )}
                {/* Incoming Line */}
                <span 
                  key={`curr-${currentLine}`}
                  className="text-gradient absolute top-0 animate-headline-enter whitespace-nowrap"
                >
                  {lines[currentLine]}
                </span>
              </div>
            </h1>
            
            <p className="text-lg md:text-xl text-slate-600 font-light mb-12 max-w-2xl leading-relaxed">
              Experience a seamless, professional HRMS platform designed to empower your employees and streamline your management processes.
            </p>

            <div className="flex flex-col sm:flex-row items-center gap-4">
              <Link
                href="/login"
                className="group relative inline-flex items-center justify-center px-8 py-4 text-lg font-semibold text-white bg-slate-900 rounded-xl overflow-hidden transition-all shadow-xl hover:shadow-2xl hover:-translate-y-0.5 active:scale-95"
              >
                Get Started Now
                <ChevronRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <button className="px-8 py-4 text-lg font-semibold text-slate-600 hover:text-emerald-600 transition-colors">
                View Live Demo
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 bg-white border-t border-slate-100 py-12">
        <div className="max-w-7xl mx-auto px-6 h-full">
          <div className="flex flex-col md:flex-row justify-between items-center gap-8">
            <div className="flex flex-col items-center md:items-start gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="text-emerald-600 w-5 h-5" />
                <span className="font-display font-bold text-slate-900">HRMS</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                A Product of <span className="text-emerald-600 font-semibold">PydahSoft</span>
              </p>
            </div>
            
            <div className="flex gap-8 text-sm text-slate-500">
              <a href="#" className="hover:text-emerald-600 transition-colors">Solutions</a>
              <a href="#" className="hover:text-emerald-600 transition-colors">Privacy</a>
              <a href="#" className="hover:text-emerald-600 transition-colors">Contact</a>
            </div>
            
            <div className="flex flex-col items-center md:items-end gap-1">
              <p className="text-sm text-slate-500 font-light">
                © {new Date().getFullYear()} HRMS. All rights reserved.
              </p>
              <p className="text-[10px] text-slate-300 uppercase tracking-widest">
                Designed & Developed by <span className="text-slate-400 font-medium">PydahSoft</span>
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}


