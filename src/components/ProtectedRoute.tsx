import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../types';

interface ProtectedRouteProps {
  allowedRoles?: UserRole[];
  allowPending?: boolean;
  children: React.ReactNode;
}

export function getHomePathForRole(role?: UserRole): string {
  if (role === 'super_admin') return '/super-admin';
  if (role === 'admin') return '/admin';
  if (role === 'manager') return '/manager';
  if (role === 'member') return '/member';
  if (role === 'parent') return '/parent';
  return '/login';
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  allowedRoles,
  allowPending = false,
  children,
}) => {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAF9F6] dark:bg-[#0F0F11]">
        <div className="w-7 h-7 rounded-full border-2 border-stone-300 dark:border-stone-700 border-t-[#C25E00] animate-spin" />
      </div>
    );
  }

  if (!user || !profile) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  if (profile.status === 'pending' || profile.status === 'inactive') {
    if (allowPending) return <>{children}</>;
    return <Navigate to="/pending" replace />;
  }

  if (allowPending && profile.status === 'active') {
    return <Navigate to={getHomePathForRole(profile.role)} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return <Navigate to={getHomePathForRole(profile.role)} replace />;
  }

  return <>{children}</>;
};
