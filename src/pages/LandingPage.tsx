import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Briefcase,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock,
  GraduationCap,
  HelpCircle,
  KeyRound,
  Languages,
  Layers,
  LayoutDashboard,
  LogIn,
  MapPin,
  Menu,
  QrCode,
  School,
  Send,
  ShieldCheck,
  UserPlus,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../hooks/useTranslation';
import { useToast } from '../context/ToastContext';
import { submitContactMessage } from '../services/communicationService';
import { getFirebaseErrorKey } from '../utils/helpers';
import { Logo } from '../components/Logo';
import { LanguageToggle } from '../components/LanguageToggle';
import { ThemeToggle } from '../components/ThemeToggle';
import { PWAInstallButton } from '../components/PWAInstallButton';
import { getHomePathForRole } from '../components/ProtectedRoute';

const fadeUp = {
  initial: { opacity: 0, y: 14 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.15 },
  transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const },
};

export const LandingPage: React.FC = () => {
  const { user, profile } = useAuth();
  const { t } = useTranslation();
  const { showToast } = useToast();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const dashboardPath = profile ? getHomePathForRole(profile.role) : '/login';

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactName.trim() || !contactEmail.trim() || !contactMessage.trim()) {
      showToast(t('errors.requiredFields'), 'error');
      return;
    }
    setSending(true);
    try {
      await submitContactMessage({
        name: contactName,
        email: contactEmail,
        message: contactMessage,
      });
      setSent(true);
      setContactName('');
      setContactEmail('');
      setContactMessage('');
      showToast(t('landing.contactSent'), 'success');
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setSending(false);
    }
  };

  const steps = [
    { num: '01', icon: Building2, title: t('landing.step1Title'), desc: t('landing.step1Desc') },
    { num: '02', icon: QrCode, title: t('landing.step2Title'), desc: t('landing.step2Desc') },
    { num: '03', icon: BarChart3, title: t('landing.step3Title'), desc: t('landing.step3Desc') },
  ];

  const features = [
    { icon: QrCode, title: t('landing.feat1Title'), desc: t('landing.feat1Desc') },
    { icon: MapPin, title: t('landing.feat2Title'), desc: t('landing.feat2Desc') },
    { icon: Users, title: t('landing.feat3Title'), desc: t('landing.feat3Desc') },
    { icon: BarChart3, title: t('landing.feat4Title'), desc: t('landing.feat4Desc') },
    { icon: CalendarClock, title: t('landing.feat5Title'), desc: t('landing.feat5Desc') },
    { icon: Languages, title: t('landing.feat6Title'), desc: t('landing.feat6Desc') },
  ];

  const audiences = [
    {
      icon: GraduationCap,
      title: t('landing.whoCollege'),
      flow: t('landing.whoCollegeFlow'),
      desc: t('landing.whoCollegeDesc'),
    },
    {
      icon: School,
      title: t('landing.whoSchool'),
      flow: t('landing.whoSchoolFlow'),
      desc: t('landing.whoSchoolDesc'),
    },
    {
      icon: BookOpen,
      title: t('landing.whoCoaching'),
      flow: t('landing.whoCoachingFlow'),
      desc: t('landing.whoCoachingDesc'),
    },
    {
      icon: Briefcase,
      title: t('landing.whoCompany'),
      flow: t('landing.whoCompanyFlow'),
      desc: t('landing.whoCompanyDesc'),
    },
  ];

  const pillars = [
    { icon: Zap, title: t('landing.why1Title'), desc: t('landing.why1Desc') },
    { icon: Clock, title: t('landing.why2Title'), desc: t('landing.why2Desc') },
    { icon: ShieldCheck, title: t('landing.why3Title'), desc: t('landing.why3Desc') },
  ];

  const faqs = [
    { q: t('landing.faq1Q'), a: t('landing.faq1A') },
    { q: t('landing.faq2Q'), a: t('landing.faq2A') },
    { q: t('landing.faq3Q'), a: t('landing.faq3A') },
    { q: t('landing.faq4Q'), a: t('landing.faq4A') },
    { q: t('landing.faq5Q'), a: t('landing.faq5A') },
  ];

  return (
    <div className="min-h-screen bg-[#FAF9F6] dark:bg-[#0F0F11] text-stone-900 dark:text-stone-100">
      {/* Sticky Top Bar */}
      <header className="sticky top-0 z-40 border-b border-stone-200/80 dark:border-stone-800/80 bg-[#FAF9F6]/90 dark:bg-[#0F0F11]/90 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-3.5 sm:px-6 h-16 flex items-center justify-between gap-3 sm:gap-6">
          <Link to="/" className="shrink-0">
            <Logo />
          </Link>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-stone-600 dark:text-stone-400">
            <a href="#how-it-works" className="hover:text-stone-900 dark:hover:text-stone-100 transition-colors whitespace-nowrap shrink-0">
              {t('nav.howItWorks')}
            </a>
            <a href="#features" className="hover:text-stone-900 dark:hover:text-stone-100 transition-colors whitespace-nowrap shrink-0">
              {t('nav.features')}
            </a>
            <a href="#who-its-for" className="hover:text-stone-900 dark:hover:text-stone-100 transition-colors whitespace-nowrap shrink-0">
              {t('nav.whoItsFor')}
            </a>
            <a href="#faq" className="hover:text-stone-900 dark:hover:text-stone-100 transition-colors whitespace-nowrap shrink-0">
              {t('nav.faq')}
            </a>
          </nav>

          <div className="hidden md:flex items-center gap-2.5 shrink-0">
            <LanguageToggle />
            <ThemeToggle />
            {user && profile ? (
              <Link
                to={dashboardPath}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#C25E00] hover:bg-[#A84F00] text-white px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0"
              >
                <LayoutDashboard className="w-4 h-4 shrink-0" />
                <span>{t('landing.ctaDashboard')}</span>
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="px-3 py-2 text-sm font-medium text-stone-700 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100 transition-colors whitespace-nowrap shrink-0"
                >
                  {t('common.login')}
                </Link>
                <Link
                  to="/register"
                  className="inline-flex items-center justify-center rounded-lg bg-[#C25E00] hover:bg-[#A84F00] text-white px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0"
                >
                  {t('landing.ctaStart')}
                </Link>
              </>
            )}
          </div>

          <div className="flex md:hidden items-center gap-1.5 shrink-0">
            <LanguageToggle />
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setMobileMenuOpen((o) => !o)}
              aria-label="Toggle menu"
              aria-expanded={mobileMenuOpen}
              className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-stone-200 dark:border-stone-800 bg-[#FAF9F6] dark:bg-[#0F0F11] px-4 py-4 space-y-1 shadow-lg">
            <a
              href="#how-it-works"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-3 px-2 py-2.5 min-h-[44px] rounded-xl text-sm font-medium text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800/60"
            >
              <Zap className="w-4 h-4 text-[#C25E00] shrink-0" />
              <span>{t('nav.howItWorks')}</span>
            </a>
            <a
              href="#features"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-3 px-2 py-2.5 min-h-[44px] rounded-xl text-sm font-medium text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800/60"
            >
              <Layers className="w-4 h-4 text-[#C25E00] shrink-0" />
              <span>{t('nav.features')}</span>
            </a>
            <a
              href="#who-its-for"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-3 px-2 py-2.5 min-h-[44px] rounded-xl text-sm font-medium text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800/60"
            >
              <Users className="w-4 h-4 text-[#C25E00] shrink-0" />
              <span>{t('nav.whoItsFor')}</span>
            </a>
            <a
              href="#faq"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-3 px-2 py-2.5 min-h-[44px] rounded-xl text-sm font-medium text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800/60"
            >
              <HelpCircle className="w-4 h-4 text-[#C25E00] shrink-0" />
              <span>{t('nav.faq')}</span>
            </a>
            <div className="pt-3 mt-2 border-t border-stone-200 dark:border-stone-800 flex items-center gap-2.5">
              {user && profile ? (
                <Link
                  to={dashboardPath}
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[#C25E00] text-white px-4 py-3 min-h-[44px] text-sm font-medium"
                >
                  <LayoutDashboard className="w-4 h-4" />
                  <span>{t('landing.ctaDashboard')}</span>
                </Link>
              ) : (
                <>
                  <Link
                    to="/login"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-stone-300 dark:border-stone-700 px-4 py-3 min-h-[44px] text-sm font-medium"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>{t('common.login')}</span>
                  </Link>
                  <Link
                    to="/register"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#C25E00] text-white px-4 py-3 min-h-[44px] text-sm font-medium"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>{t('landing.ctaStart')}</span>
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      {/* 1. Hero Section */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-14 sm:pt-16 sm:pb-20 md:pt-24 md:pb-28">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-10 items-center">
          <div className="lg:col-span-7">
            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-stone-900 dark:text-stone-50 leading-[1.1]">
              {t('landing.heroTitle')}
            </h1>
            <p className="mt-4 sm:mt-5 text-base sm:text-lg text-stone-600 dark:text-stone-400 leading-relaxed max-w-xl">
              {t('landing.heroSubtitle')}
            </p>
            <div className="mt-7 sm:mt-8 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3">
              <Link
                to={user && profile ? dashboardPath : '/register'}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] text-white px-6 py-3 min-h-[46px] text-sm font-medium transition-colors"
              >
                <span>{user && profile ? t('landing.ctaDashboard') : t('landing.ctaStart')}</span>
                <ArrowRight className="w-4 h-4 shrink-0" />
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex items-center justify-center rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 hover:bg-stone-50 dark:hover:bg-stone-800 text-stone-800 dark:text-stone-200 px-5 py-3 min-h-[46px] text-sm font-medium transition-colors"
              >
                {t('landing.ctaHow')}
              </a>
            </div>
          </div>

          {/* Mark Your Attendance Card */}
          <div className="lg:col-span-5 flex justify-center lg:justify-end">
            <div className="w-full max-w-sm rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-6 sm:p-7 shadow-sm">
              <div className="w-11 h-11 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200/80 dark:border-amber-900/60 flex items-center justify-center text-[#C25E00]">
                <QrCode className="w-5 h-5" />
              </div>

              <h2 className="mt-5 text-xl sm:text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
                {t('landing.markCardTitle')}
              </h2>
              <p className="mt-2 text-sm text-stone-600 dark:text-stone-400 leading-relaxed">
                {t('landing.markCardSubtitle')}
              </p>

              <div className="mt-6 grid grid-cols-1 min-[360px]:grid-cols-2 gap-3">
                <Link
                  to="/mark?tab=scan"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] text-white px-4 py-3 min-h-[44px] text-sm font-medium transition-colors whitespace-nowrap"
                >
                  <QrCode className="w-4 h-4 shrink-0" />
                  <span>{t('landing.markCardScanBtn')}</span>
                </Link>
                <Link
                  to="/mark?tab=code"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 hover:bg-stone-50 dark:hover:bg-stone-800 text-stone-800 dark:text-stone-100 px-4 py-3 min-h-[44px] text-sm font-medium transition-colors whitespace-nowrap"
                >
                  <KeyRound className="w-4 h-4 shrink-0" />
                  <span>{t('landing.markCardIdBtn')}</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. How it works */}
      <section
        id="how-it-works"
        className="border-t border-stone-200/80 dark:border-stone-800/80 py-14 sm:py-20 md:py-28"
      >
        <motion.div {...fadeUp} className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-xl">
            <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
              {t('landing.stepsHeading')}
            </h2>
            <p className="mt-3 text-sm sm:text-base text-stone-600 dark:text-stone-400">
              {t('landing.stepsSub')}
            </p>
          </div>

          <div className="mt-9 sm:mt-12 grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-6">
            {steps.map((step) => {
              const Icon = step.icon;
              return (
                <div
                  key={step.num}
                  className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-6 sm:p-7"
                >
                  <div className="flex items-center justify-between">
                    <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200/70 dark:border-amber-900/50 text-[#C25E00] flex items-center justify-center">
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className="font-mono text-xs font-semibold text-stone-400 tabular-nums">
                      {step.num}
                    </span>
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-stone-900 dark:text-stone-100">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm text-stone-600 dark:text-stone-400 leading-relaxed">
                    {step.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </motion.div>
      </section>

      {/* 3. What you get (6 items) */}
      <section
        id="features"
        className="border-t border-stone-200/80 dark:border-stone-800/80 py-14 sm:py-20 md:py-28"
      >
        <motion.div {...fadeUp} className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-xl">
            <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
              {t('landing.featuresHeading')}
            </h2>
            <p className="mt-3 text-sm sm:text-base text-stone-600 dark:text-stone-400">
              {t('landing.featuresSub')}
            </p>
          </div>

          <div className="mt-9 sm:mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-8 sm:gap-y-10">
            {features.map((feat, idx) => {
              const Icon = feat.icon;
              return (
                <div
                  key={idx}
                  className="pt-5 border-t border-stone-200 dark:border-stone-800"
                >
                  <div className="w-9 h-9 rounded-lg bg-stone-100 dark:bg-stone-800/80 text-[#C25E00] flex items-center justify-center mb-3.5">
                    <Icon className="w-4 h-4" />
                  </div>
                  <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
                    {feat.title}
                  </h3>
                  <p className="mt-2 text-sm text-stone-600 dark:text-stone-400 leading-relaxed">
                    {feat.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </motion.div>
      </section>

      {/* 4. Who is it for (4 cards) */}
      <section
        id="who-its-for"
        className="border-t border-stone-200/80 dark:border-stone-800/80 py-14 sm:py-20 md:py-28"
      >
        <motion.div {...fadeUp} className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-xl">
            <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
              {t('landing.whoHeading')}
            </h2>
            <p className="mt-3 text-sm sm:text-base text-stone-600 dark:text-stone-400">
              {t('landing.whoSub')}
            </p>
          </div>

          <div className="mt-9 sm:mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
            {audiences.map((aud, idx) => {
              const Icon = aud.icon;
              const flowParts = aud.flow.split('→').map((s) => s.trim()).filter(Boolean);
              return (
                <div
                  key={idx}
                  className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-6 flex flex-col justify-between"
                >
                  <div>
                    <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-[#C25E00] flex items-center justify-center mb-4">
                      <Icon className="w-5 h-5" />
                    </div>
                    <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
                      {aud.title}
                    </h3>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs font-medium text-[#C25E00]">
                      {flowParts.map((part, pIdx) => (
                        <React.Fragment key={pIdx}>
                          <span>{part}</span>
                          {pIdx < flowParts.length - 1 && (
                            <ArrowRight className="w-3 h-3 shrink-0 opacity-75" aria-hidden="true" />
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                    <p className="mt-3 text-sm text-stone-600 dark:text-stone-400 leading-relaxed">
                      {aud.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      </section>

      {/* 5. Simple. Fast. Safe. */}
      <section className="border-t border-stone-200/80 dark:border-stone-800/80 py-14 sm:py-20 md:py-28 bg-white dark:bg-[#141416]">
        <motion.div {...fadeUp} className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-xl">
            <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
              {t('landing.whyHeading')}
            </h2>
            <p className="mt-3 text-sm sm:text-base text-stone-600 dark:text-stone-400">
              {t('landing.whySub')}
            </p>
          </div>

          <div className="mt-9 sm:mt-12 grid grid-cols-1 md:grid-cols-3 gap-7 sm:gap-8">
            {pillars.map((item, idx) => {
              const Icon = item.icon;
              return (
                <div key={idx} className="flex flex-col">
                  <div className="w-10 h-10 rounded-xl bg-stone-100 dark:bg-stone-800 text-[#C25E00] flex items-center justify-center mb-4">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="text-xl font-semibold text-stone-900 dark:text-stone-100">
                    {item.title}
                  </h3>
                  <p className="mt-2.5 text-sm text-stone-600 dark:text-stone-400 leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </motion.div>
      </section>

      {/* 6. FAQ Accordions */}
      <section
        id="faq"
        className="border-t border-stone-200/80 dark:border-stone-800/80 py-14 sm:py-20 md:py-28"
      >
        <motion.div {...fadeUp} className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
            {t('landing.faqHeading')}
          </h2>
          <p className="mt-3 text-sm sm:text-base text-stone-600 dark:text-stone-400">
            {t('landing.faqSub')}
          </p>

          <div className="mt-8 sm:mt-10 divide-y divide-stone-200 dark:divide-stone-800 border-t border-b border-stone-200 dark:border-stone-800">
            {faqs.map((faq, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div key={idx}>
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    aria-expanded={isOpen}
                    className="w-full py-4 sm:py-5 min-h-[52px] flex items-center justify-between gap-4 text-left"
                  >
                    <span className="text-sm sm:text-base font-medium text-stone-900 dark:text-stone-100">
                      {faq.q}
                    </span>
                    <ChevronDown
                      className={`w-5 h-5 text-stone-400 shrink-0 transition-transform duration-200 ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <p className="pb-5 text-sm text-stone-600 dark:text-stone-400 leading-relaxed pr-4 sm:pr-8">
                      {faq.a}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </motion.div>
      </section>

      {/* 7. Contact Form */}
      <section
        id="contact"
        className="border-t border-stone-200/80 dark:border-stone-800/80 py-14 sm:py-20 md:py-28"
      >
        <motion.div {...fadeUp} className="max-w-xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
            {t('landing.contactHeading')}
          </h2>
          <p className="mt-3 text-sm sm:text-base text-stone-600 dark:text-stone-400">
            {t('landing.contactSub')}
          </p>

          {sent ? (
            <div className="mt-8 rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 p-6 flex items-start gap-3 text-sm text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
              <span>{t('landing.contactSent')}</span>
            </div>
          ) : (
            <form
              onSubmit={handleContactSubmit}
              className="mt-8 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-8 space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                  {t('landing.contactName')}
                </label>
                <input
                  type="text"
                  required
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C25E00]/30 focus:border-[#C25E00]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                  {t('landing.contactEmail')}
                </label>
                <input
                  type="email"
                  required
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C25E00]/30 focus:border-[#C25E00]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                  {t('landing.contactMessage')}
                </label>
                <textarea
                  rows={4}
                  required
                  value={contactMessage}
                  onChange={(e) => setContactMessage(e.target.value)}
                  className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C25E00]/30 focus:border-[#C25E00] resize-none"
                />
              </div>
              <button
                type="submit"
                disabled={sending}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] disabled:opacity-60 text-white px-5 py-3 min-h-[44px] text-sm font-medium transition-colors"
              >
                <Send className="w-4 h-4 shrink-0" />
                <span>{sending ? t('common.saving') : t('landing.contactSend')}</span>
              </button>
            </form>
          )}
        </motion.div>
      </section>

      {/* 8. Footer */}
      <footer className="border-t border-stone-200 dark:border-stone-800 py-10 sm:py-12 pb-safe">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <Logo />
            <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
              {t('landing.footerTagline')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm text-stone-600 dark:text-stone-400">
            <a href="#how-it-works" className="hover:text-stone-900 dark:hover:text-stone-100">
              {t('nav.howItWorks')}
            </a>
            <a href="#features" className="hover:text-stone-900 dark:hover:text-stone-100">
              {t('nav.features')}
            </a>
            <a href="#faq" className="hover:text-stone-900 dark:hover:text-stone-100">
              {t('nav.faq')}
            </a>
            <Link to="/login" className="hover:text-stone-900 dark:hover:text-stone-100">
              {t('common.login')}
            </Link>
            <Link to="/register" className="hover:text-stone-900 dark:hover:text-stone-100">
              {t('landing.ctaStart')}
            </Link>
            <PWAInstallButton compact />
            <LanguageToggle />
          </div>
        </div>
      </footer>
    </div>
  );
};
