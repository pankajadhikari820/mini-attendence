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
  Menu,
  ScanLine,
  Settings,
  ShieldCheck,
  Users,
  UserCog,
  X,
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
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
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
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNotifOpen(false);
        setMobileDrawerOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  // Automatically close mobile drawer on route navigation
  useEffect(() => {
    setMobileDrawerOpen(false);
    setNotifOpen(false);
  }, [location.pathname]);

  // Prevent background body scroll while mobile drawer is open
  useEffect(() => {
    if (!mobileDrawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileDrawerOpen]);

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
    setMobileDrawerOpen(false);
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

  const renderSidebarBody = (isMobileDrawer = false) => (
    <>
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
            className="mb-3 flex items-center justify-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] text-white px-4 py-2.5 min-h-[44px] text-sm font-medium transition-colors"
          >
            <ScanLine className="w-4 h-4 shrink-0" />
            <span className="whitespace-nowrap">{t('nav.startAttendance')}</span>
          </Link>
        ) : profile?.role === 'member' ? (
          <Link
            to="/mark"
            className="mb-3 flex items-center justify-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] text-white px-4 py-2.5 min-h-[44px] text-sm font-medium transition-colors"
          >
            <ScanLine className="w-4 h-4 shrink-0" />
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
                `flex items-center gap-3 rounded-xl px-3 ${
                  isMobileDrawer ? 'py-2.5 min-h-[44px]' : 'py-2'
                } text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-stone-100 dark:bg-stone-800/90 text-[#C25E00] dark:text-amber-400'
                    : 'text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800/50 hover:text-stone-900 dark:hover:text-stone-100'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </NavLink>
          );
        })}

        {isMobileDrawer && (
          <div className="pt-3 px-1">
            <PWAInstallButton />
          </div>
        )}
      </nav>

      <div className="p-3 border-t border-stone-200 dark:border-stone-800 space-y-2 pb-safe">
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
          className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 min-h-[42px] text-sm text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-900 dark:hover:text-stone-100 transition-colors"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span>{t('common.logout')}</span>
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-[#FAF9F6] dark:bg-[#0F0F11] text-stone-900 dark:text-stone-100 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:flex-col md:w-60 lg:w-64 border-r border-stone-200 dark:border-stone-800 bg-white dark:bg-[#141416] fixed inset-y-0 left-0 z-30 no-print">
        <div className="h-16 px-5 flex items-center border-b border-stone-200 dark:border-stone-800">
          <Link to={homePath}>
            <Logo />
          </Link>
        </div>
        {renderSidebarBody(false)}
      </aside>

      {/* Mobile Slide-Over Navigation Drawer */}
      {mobileDrawerOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex no-print" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-xs"
            onClick={() => setMobileDrawerOpen(false)}
          />
          <aside className="relative w-[min(84vw,300px)] max-w-full bg-white dark:bg-[#141416] h-full flex flex-col border-r border-stone-200 dark:border-stone-800 shadow-2xl z-10">
            <div className="h-14 px-4 flex items-center justify-between border-b border-stone-200 dark:border-stone-800 shrink-0">
              <Link to={homePath} onClick={() => setMobileDrawerOpen(false)}>
                <Logo />
              </Link>
              <button
                type="button"
                onClick={() => setMobileDrawerOpen(false)}
                aria-label={t('common.close')}
                className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {renderSidebarBody(true)}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:pl-60 lg:pl-64 min-w-0">
        <header className="sticky top-0 z-20 h-14 md:h-16 border-b border-stone-200 dark:border-stone-800 bg-[#FAF9F6]/90 dark:bg-[#0F0F11]/90 backdrop-blur-md px-3 sm:px-4 md:px-8 flex items-center justify-between gap-2 sm:gap-4 no-print">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(true)}
              aria-label="Open navigation menu"
              className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg border border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>
            <Link to={homePath} className="md:hidden shrink-0">
              <Logo compact />
            </Link>
            <h1 className="text-sm sm:text-base md:text-lg font-semibold tracking-tight text-stone-900 dark:text-stone-100 truncate">
              {pageHeading}
            </h1>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
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
                className="relative inline-flex items-center justify-center w-10 h-10 rounded-lg border border-stone-200 dark:border-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#C25E00] text-white text-[10px] font-semibold flex items-center justify-center tabular-nums">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="fixed inset-x-3 top-16 sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-80 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-xl overflow-hidden z-40">
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

        <main className="flex-1 w-full max-w-6xl mx-auto px-3.5 sm:px-4 md:px-8 py-5 pb-24 md:py-8 md:pb-10">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <nav
        aria-label="Primary"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-stone-200 dark:border-stone-800 bg-white/95 dark:bg-[#141416]/95 backdrop-blur-md pb-safe no-print"
      >
        <div className="h-16 flex items-center justify-around px-1">
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
                  `flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0 min-h-[48px] px-1 py-1.5 rounded-lg text-[10px] sm:text-[11px] font-medium transition-colors ${
                    isActive ? 'text-[#C25E00]' : 'text-stone-500 dark:text-stone-400'
                  }`
                }
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span className="truncate max-w-full">{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
};
