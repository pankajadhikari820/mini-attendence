import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { LanguageProvider } from './context/LanguageContext';
import { ToastProvider } from './context/ToastContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute, getHomePathForRole } from './components/ProtectedRoute';
import { OfflineIndicator } from './components/OfflineIndicator';

import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { PendingApprovalPage } from './pages/PendingApprovalPage';
import { AdminDashboard } from './pages/AdminDashboard';
import { ManageManagersPage } from './pages/ManageManagersPage';
import { ManagerDashboard } from './pages/ManagerDashboard';
import { ManageMembersPage } from './pages/ManageMembersPage';
import { StartAttendancePage } from './pages/StartAttendancePage';
import { MarkAttendancePage } from './pages/MarkAttendancePage';
import { MarkYourAttendancePage } from './pages/MarkYourAttendancePage';
import { LeavesPage } from './pages/LeavesPage';
import { AnnouncementsPage } from './pages/AnnouncementsPage';
import { ReportsPage } from './pages/ReportsPage';
import { MemberDashboard } from './pages/MemberDashboard';
import { SettingsPage } from './pages/SettingsPage';
import { NotFoundPage } from './pages/NotFoundPage';

const DashboardRedirect: React.FC = () => {
  const { profile, loading } = useAuth();
  if (loading) return null;
  if (!profile) return <Navigate to="/login" replace />;
  if (profile.status !== 'active') return <Navigate to="/pending" replace />;
  return <Navigate to={getHomePathForRole(profile.role)} replace />;
};

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <ToastProvider>
          <AuthProvider>
            <BrowserRouter>
              <OfflineIndicator />
              <Routes>
                {/* Public */}
                <Route path="/" element={<LandingPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/dashboard" element={<DashboardRedirect />} />

                {/* Pending / Inactive */}
                <Route
                  path="/pending"
                  element={
                    <ProtectedRoute allowPending>
                      <PendingApprovalPage />
                    </ProtectedRoute>
                  }
                />

                {/* Admin */}
                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute allowedRoles={['admin']}>
                      <AdminDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/managers"
                  element={
                    <ProtectedRoute allowedRoles={['admin']}>
                      <ManageManagersPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/members"
                  element={
                    <ProtectedRoute allowedRoles={['admin']}>
                      <ManageMembersPage adminView />
                    </ProtectedRoute>
                  }
                />

                {/* Manager */}
                <Route
                  path="/manager"
                  element={
                    <ProtectedRoute allowedRoles={['manager']}>
                      <ManagerDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/manager/members"
                  element={
                    <ProtectedRoute allowedRoles={['manager']}>
                      <ManageMembersPage />
                    </ProtectedRoute>
                  }
                />

                {/* Member */}
                <Route
                  path="/member"
                  element={
                    <ProtectedRoute allowedRoles={['member']}>
                      <MemberDashboard />
                    </ProtectedRoute>
                  }
                />

                {/* Shared Authenticated Routes */}
                <Route
                  path="/attendance"
                  element={
                    <ProtectedRoute allowedRoles={['admin', 'manager']}>
                      <StartAttendancePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/attendance/manual"
                  element={
                    <ProtectedRoute allowedRoles={['admin', 'manager']}>
                      <MarkAttendancePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/mark"
                  element={
                    <ProtectedRoute allowedRoles={['manager', 'member']}>
                      <MarkYourAttendancePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/reports"
                  element={
                    <ProtectedRoute allowedRoles={['admin', 'manager']}>
                      <ReportsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/leaves"
                  element={
                    <ProtectedRoute allowedRoles={['admin', 'manager', 'member']}>
                      <LeavesPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/announcements"
                  element={
                    <ProtectedRoute allowedRoles={['admin', 'manager', 'member']}>
                      <AnnouncementsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <ProtectedRoute allowedRoles={['admin', 'manager', 'member']}>
                      <SettingsPage />
                    </ProtectedRoute>
                  }
                />

                {/* 404 */}
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </BrowserRouter>
          </AuthProvider>
        </ToastProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
