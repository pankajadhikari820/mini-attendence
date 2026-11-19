import React, { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Megaphone,
  ScanLine,
  Settings,
  ShieldCheck,
  Users,
  UserCog,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../hooks/useTranslation';
import type { AppNotification } from '../types';
import {
  markAllNotificationsRead,
  markNotificationRead,
  subscribeNotifications,
} from '../services/communicationService';
import { getInitials } from '../utils/helpers';
import { Logo } from './Logo';
import { LanguageToggle } from './LanguageToggle';
import { ThemeToggle } from './ThemeToggle';
import { PWAInstallButton } from './PWAInstallButton';
import { getHomePathForRole } from './ProtectedRoute';

interface LayoutProps {
  title?: string;
  children: React.ReactNode;
}

interface NavItem {
  to: string;
  label: string;
  icon: React.FC<{ className?: string }>;
  mobile?: boolean;
}

export const Layout: React.FC<LayoutProps> = ({ title, children }) => {
  const { profile, org, logout, getRoleLabel } = useAuth();
  const { t, formatTime } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profile?.uid) return;
    return subscribeNotifications(profile.uid, setNotifications);
  }, [profile?.uid]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const managerLabel = getRoleLabel('manager');
  const memberLabel = getRoleLabel('member');
  const homePath = getHomePathForRole(profile?.role);

  const navItems: NavItem[] = (() => {
    if (profile?.role === 'super_admin') {
      return [
        { to: '/super-admin', label: t('nav.organizations'), icon: Building2, mobile: true },
        { to: '/admin', label: t('nav.dashboard'), icon: LayoutDashboard, mobile: true },
        { to: '/academics', label: t('nav.academics'), icon: BookOpen },
        { to: '/timetable', label: t('nav.timetable'), icon: CalendarDays },
        { to: '/admin/managers', label: managerLabel, icon: UserCog },
        { to: '/admin/members', label: memberLabel, icon: Users },
        { to: '/reports', label: t('nav.reports'), icon: BarChart3, mobile: true },
        { to: '/audit-logs', label: t('nav.auditLogs'), icon: ShieldCheck, mobile: true },
        { to: '/settings', label: t('nav.settings'), icon: Settings, mobile: true },
      ];
    }
    if (profile?.role === 'admin') {
      return [
        { to: '/admin', label: t('nav.dashboard'), icon: LayoutDashboard, mobile: true },
        { to: '/attendance', label: t('nav.startAttendance'), icon: ScanLine, mobile: true },
        { to: '/academics', label: t('nav.academics'), icon: BookOpen },
        { to: '/timetable', label: t('nav.timetable'), icon: CalendarDays },
        { to: '/admin/managers', label: managerLabel, icon: UserCog, mobile: true },
        { to: '/admin/members', label: memberLabel, icon: Users },
        { to: '/attendance/manual', label: t('nav.manualBackup'), icon: ClipboardList },
        { to: '/reports', label: t('nav.reports'), icon: BarChart3, mobile: true },
        { to: '/leaves', label: t('nav.leaves'), icon: CalendarClock },
        { to: '/announcements', label: t('nav.announcements'), icon: Megaphone },
        { to: '/audit-logs', label: t('nav.auditLogs'), icon: ShieldCheck },
        { to: '/settings', label: t('nav.settings'), icon: Settings, mobile: true },
      ];
    }
    if (profile?.role === 'manager') {
      return [
        { to: '/manager', label: t('nav.dashboard'), icon: LayoutDashboard, mobile: true },
        { to: '/attendance', label: t('nav.startAttendance'), icon: ScanLine, mobile: true },
        { to: '/timetable', label: t('nav.timetable'), icon: CalendarDays, mobile: true },
        { to: '/mark', label: t('nav.markYourAttendance'), icon: CheckCircle2 },
        { to: '/attendance/manual', label: t('nav.manualBackup'), icon: ClipboardList },
        { to: '/manager/members', label: memberLabel, icon: Users },
        { to: '/reports', label: t('nav.reports'), icon: BarChart3, mobile: true },
        { to: '/leaves', label: t('nav.leaves'), icon: CalendarClock },
        { to: '/announcements', label: t('nav.announcements'), icon: Megaphone },
        { to: '/settings', label: t('nav.settings'), icon: Settings, mobile: true },
      ];
    }
    if (profile?.role === 'parent') {
      return [
        { to: '/parent', label: t('nav.parentPortal'), icon: GraduationCap, mobile: true },
        { to: '/timetable', label: t('nav.timetable'), icon: CalendarDays, mobile: true },
        { to: '/announcements', label: t('nav.announcements'), icon: Megaphone, mobile: true },
        { to: '/settings', label: t('nav.settings'), icon: Settings, mobile: true },
      ];
    }
    return [
      { to: '/member', label: t('nav.dashboard'), icon: LayoutDashboard, mobile: true },
      { to: '/mark', label: t('nav.markYourAttendance'), icon: ScanLine, mobile: true },
      { to: '/timetable', label: t('nav.timetable'), icon: CalendarDays, mobile: true },
      { to: '/leaves', label: t('nav.leaves'), icon: CalendarClock, mobile: true },
      { to: '/announcements', label: t('nav.announcements'), icon: Megaphone },
      { to: '/settings', label: t('nav.settings'), icon: Settings, mobile: true },
    ];
  })();

  const mobileItems = navItems.filter((item) => item.mobile);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const roleBadgeText =
    profile?.role === 'super_admin'
      ? t('common.superAdmin')
      : profile?.role === 'admin'
      ? t('common.admin')
      : profile?.role === 'manager'
      ? managerLabel
      : profile?.role === 'parent'
      ? t('common.parent')
      : memberLabel;

  const pageHeading =
    title || navItems.find((item) => item.to === location.pathname)?.label || t('nav.dashboard');

  return (
    <div className="min-h-screen bg-[#FAF9F6] dark:bg-[#0F0F11] text-stone-900 dark:text-stone-100 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:flex-col md:w-60 lg:w-64 border-r border-stone-200 dark:border-stone-800 bg-white dark:bg-[#141416] fixed inset-y-0 left-0 z-30 no-print">
        <div className="h-16 px-5 flex items-center border-b border-stone-200 dark:border-stone-800">
          <Link to={homePath}>
            <Logo />
          </Link>
        </div>

        {org && (
          <div className="px-5 py-3.5 border-b border-stone-100 dark:border-stone-800/80 flex items-center gap-2.5">
            {org.logoUrl && (
              <img
                src={org.logoUrl}
                alt={org.name}
                className="w-8 h-8 rounded-lg object-cover border border-stone-200 dark:border-stone-700 shrink-0"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-stone-900 dark:text-stone-100 truncate">
                {org.name}
              </p>
              <p className="text-xs text-stone-500 dark:text-stone-400 truncate mt-0.5 font-mono">
                {roleBadgeText}
                {profile?.memberId ? ` · ${profile.memberId}` : ''}
              </p>
            </div>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          {profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'super_admin' ? (
            <Link
              to="/attendance"
              className="mb-3 flex items-center justify-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] text-white px-4 py-2.5 text-sm font-medium transition-colors"
            >
              <ScanLine className="w-4 h-4" />
              <span className="whitespace-nowrap">{t('nav.startAttendance')}</span>
            </Link>
          ) : profile?.role === 'member' ? (
            <Link
              to="/mark"
              className="mb-3 flex items-center justify-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] text-white px-4 py-2.5 text-sm font-medium transition-colors"
            >
              <ScanLine className="w-4 h-4" />
              <span className="whitespace-nowrap">{t('nav.markYourAttendance')}</span>
            </Link>
          ) : null}

          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={
                  item.to === '/admin' ||
                  item.to === '/manager' ||
                  item.to === '/member' ||
                  item.to === '/parent' ||
                  item.to === '/super-admin' ||
                  item.to === '/attendance'
                }
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-stone-100 dark:bg-stone-800/90 text-stone-900 dark:text-stone-100'
                      : 'text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800/50 hover:text-stone-900 dark:hover:text-stone-100'
                  }`
                }
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="p-3 border-t border-stone-200 dark:border-stone-800 space-y-2">
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            {profile?.photoUrl ? (
              <img
                src={profile.photoUrl}
                alt={profile.name}
                className="w-8 h-8 rounded-full object-cover border border-stone-200 dark:border-stone-700 shrink-0"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-stone-200 dark:bg-stone-800 text-stone-700 dark:text-stone-200 flex items-center justify-center text-xs font-semibold shrink-0">
                {getInitials(profile?.name || '')}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-stone-900 dark:text-stone-100 truncate">
                {profile?.name}
              </p>
              <p className="text-xs text-stone-500 dark:text-stone-400 truncate">
                {profile?.email}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-900 dark:hover:text-stone-100 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>{t('common.logout')}</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:pl-60 lg:pl-64 min-w-0">
        <header className="sticky top-0 z-20 h-14 md:h-16 border-b border-stone-200 dark:border-stone-800 bg-[#FAF9F6]/90 dark:bg-[#0F0F11]/90 backdrop-blur-md px-4 md:px-8 flex items-center justify-between gap-4 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <div className="md:hidden">
              <Logo compact />
            </div>
            <h1 className="text-base md:text-lg font-semibold tracking-tight text-stone-900 dark:text-stone-100 truncate">
              {pageHeading}
            </h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden sm:block">
              <PWAInstallButton compact />
            </div>
            <LanguageToggle />
            <ThemeToggle />

            {/* Notification Bell */}
            <div ref={notifRef} className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((o) => !o)}
                aria-label={t('notifications.title')}
                className="relative inline-flex items-center justify-center w-9 h-9 rounded-lg border border-stone-200 dark:border-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#C25E00] text-white text-[10px] font-semibold flex items-center justify-center tabular-nums">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-xl overflow-hidden z-40">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 dark:border-stone-800">
                    <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                      {t('notifications.title')}
                    </span>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={() => markAllNotificationsRead(notifications)}
                        className="text-xs font-medium text-[#C25E00] hover:underline"
                      >
                        {t('notifications.markAllRead')}
                      </button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-stone-100 dark:divide-stone-800">
                    {notifications.length === 0 ? (
                      <p className="px-4 py-8 text-center text-xs text-stone-500 dark:text-stone-400">
                        {t('notifications.empty')}
                      </p>
                    ) : (
                      notifications.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            if (!item.read) markNotificationRead(item.id);
                          }}
                          className={`w-full text-left px-4 py-3 text-xs transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/60 ${
                            !item.read ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''
                          }`}
                        >
                          <p
                            className={`leading-relaxed ${
                              !item.read
                                ? 'font-medium text-stone-900 dark:text-stone-100'
                                : 'text-stone-600 dark:text-stone-400'
                            }`}
                          >
                            {item.text}
                          </p>
                          <p className="mt-1 text-[11px] text-stone-400">
                            {formatTime(item.createdAt?.toDate?.())}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 w-full max-w-6xl mx-auto px-4 md:px-8 py-6 pb-24 md:py-8 md:pb-10">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <nav
        aria-label="Primary"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 h-16 border-t border-stone-200 dark:border-stone-800 bg-white/95 dark:bg-[#141416]/95 backdrop-blur-md flex items-center justify-around px-1 no-print"
      >
        {mobileItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={
                item.to === '/admin' ||
                item.to === '/manager' ||
                item.to === '/member' ||
                item.to === '/parent' ||
                item.to === '/super-admin' ||
                item.to === '/attendance'
              }
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-0.5 min-w-[56px] py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                  isActive ? 'text-[#C25E00]' : 'text-stone-500 dark:text-stone-400'
                }`
              }
            >
              <Icon className="w-5 h-5" />
              <span className="truncate max-w-[68px]">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
};
