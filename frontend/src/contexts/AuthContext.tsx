'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { auth, User } from '@/lib/auth';

interface AuthContextType {
    user: User | null;
    loading: boolean;
    login: (token: string, user: User) => void;
    logout: () => void;
    checkAuth: () => void;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
    login: () => { },
    logout: () => { },
    checkAuth: () => { },
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    const checkAuth = () => {
        const loadedUser = auth.getUser();
        setUser(loadedUser);
        setLoading(false);
    };

    const login = (token: string, userData: User) => {
        auth.setToken(token);
        auth.setUser(userData);
        setUser(userData);
    };

    const logout = () => {
        auth.logout();
        setUser(null);
    };

    useEffect(() => {
        checkAuth();

        // Listen for global logout events (e.g. from 401 handlers in api.ts)
        const handleGlobalLogout = () => {
            console.log('[AuthContext] Global logout event received');
            // JUST update local state, do NOT call auth.logout() again as it dispatches the event
            setUser(null);
            localStorage.removeItem('user'); // Ensure local storage user is gone

            // Redirect to login page
            window.location.href = '/login';
        };

        window.addEventListener('auth-logout', handleGlobalLogout);
        return () => window.removeEventListener('auth-logout', handleGlobalLogout);
    }, []);

    return (
        <AuthContext.Provider value={{ user, loading, login, logout, checkAuth }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
