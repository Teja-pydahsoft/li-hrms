"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { api } from "@/lib/api";
import { auth } from "@/lib/auth";
import { setWorkspaceDataFromLogin } from "@/contexts/WorkspaceContext";
import LiquidEther from "@/components/LiquidEther";
import "@/components/LiquidEther.css";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [ssoVerifying, setSsoVerifying] = useState(false);
  const ssoAttempted = useRef(false);

  // Check if already authenticated or if we need to clear session for SSO
  useEffect(() => {
    const ssoToken = searchParams.get("token");

    // If a new SSO token is present, we must clear the old session FIRST
    if (ssoToken && !ssoAttempted.current) {
      const currentToken = auth.getToken();
      // Only logout if there is actually something to clear
      if (currentToken) {
        console.log("SSO Token detected in URL. Clearing existing local sessions to prioritize new login.");
        auth.logout();
      }
      setChecking(false);
      return;
    }

    const token = auth.getToken();
    const user = auth.getUser();

    if (token && user) {
      // Already authenticated, redirect to dashboard
      const dashboardPath = auth.getRoleBasedPath(user.role);
      router.replace(dashboardPath);
    } else {
      setChecking(false);
    }
  }, [router, searchParams]);

  // SSO: when URL has ?token=..., verify with backend and log in
  useEffect(() => {
    if (checking || ssoAttempted.current) return;
    const ssoToken = searchParams.get("token");
    if (!ssoToken) return;

    ssoAttempted.current = true;
    setSsoVerifying(true);
    setError("");

    api
      .ssoLogin(ssoToken)
      .then((response) => {
        if (response.success && response.data) {
          auth.setToken(response.data.token);
          auth.setUser(response.data.user);
          if (response.data.user.role !== "super_admin") {
            setWorkspaceDataFromLogin({
              workspaces: response.data.workspaces || [],
              activeWorkspace: response.data.activeWorkspace || response.data.workspaces?.[0],
            });
          }
          const dashboardPath = auth.getRoleBasedPath(response.data.user.role);
          // Remove token from URL before redirect
          router.replace(dashboardPath);
        } else {
          setError(response.message || "SSO login failed.");
          setSsoVerifying(false);
          router.replace("/login", { scroll: false });
        }
      })
      .catch((err) => {
        setError("SSO verification failed. Please sign in with your credentials.");
        setSsoVerifying(false);
        router.replace("/login", { scroll: false });
      });
  }, [checking, searchParams, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await api.login(identifier, password);

      if (response.success && response.data) {
        // Store token and user data
        auth.setToken(response.data.token);
        auth.setUser(response.data.user);

        // Navigate based on role
        const dashboardPath = auth.getRoleBasedPath(response.data.user.role);
        router.push(dashboardPath);
      } else {
        setError(response.message || "Login failed. Please check your credentials.");
      }
    } catch (err) {
      setError("An unexpected error occurred. Please try again.");
      console.error("Login error:", err);
    } finally {
      setLoading(false);
    }
  };

  // Show loading while checking authentication
  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-green-600 border-t-transparent"></div>
          <p className="text-gray-600 font-light">Checking authentication...</p>
        </div>
      </div>
    );
  }

  // Show verifying state when logging in via SSO token
  if (ssoVerifying) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-green-600 border-t-transparent"></div>
          <p className="text-gray-600 font-light">Verifying SSO token...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-white px-6 py-12">
      {/* LiquidEther Background - Same as home page */}
      {/* <div className="absolute inset-0 z-0 w-full h-full">
        <LiquidEther
          colors={['#22c55e', '#10b981', '#16a34a']}
          mouseForce={20}
          cursorSize={100}
          isViscous={false}
          viscous={30}
          iterationsViscous={32}
          iterationsPoisson={32}
          resolution={0.5}
          isBounce={false}
          autoDemo={true}
          autoSpeed={0.5}
          autoIntensity={2.2}
          takeoverDuration={0.25}
          autoResumeDelay={3000}
          autoRampDuration={0.6}
        />
      </div> */}

      {/* Login Content */}
      <div className="relative z-10 w-full max-w-md">
        {/* Back to Home Link */}
        <Link
          href="/"
          className="inline-flex items-center text-green-600 hover:text-green-700 mb-8 text-sm font-medium drop-shadow-md"
        >
          ← Back to Home
        </Link>

        {/* Login Card with Glass Effect */}
        <div className="bg-white/80 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20 p-8">
          {/* Logo/Brand */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-green-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              Welcome Back
            </h1>
            <p className="text-gray-500">
              Sign in to your HRMS account
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Identifier Field */}
            <div>
              <label
                htmlFor="identifier"
                className="block text-sm font-medium text-gray-700 mb-1.5"
              >
                Email, Username or Employee No
              </label>
              <input
                id="identifier"
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all bg-white/50 backdrop-blur-sm focus:bg-white/80"
                placeholder="Enter your credentials"
              />
            </div>

            {/* Password Field */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all bg-white/50 backdrop-blur-sm focus:bg-white/80 pr-12"
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none p-1"
                >
                  {showPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-4 bg-gradient-to-r from-green-600 to-green-600 text-white font-semibold rounded-xl hover:from-green-700 hover:to-green-700 transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          {/* Demo Credentials (optional - for development) */}
          <div className="mt-6 pt-6 border-t border-gray-100">
            <p className="text-xs text-center text-gray-400">
              HRMS - Human Resource Management System
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-green-600 border-t-transparent"></div>
          <p className="text-gray-600 font-light">Loading...</p>
        </div>
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}
