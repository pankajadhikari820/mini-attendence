import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useTranslation } from '../hooks/useTranslation';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  const { t } = useTranslation();

  if (isOnline) return null;

  return (
    <div
      role="alert"
      className="fixed bottom-16 md:bottom-4 left-4 right-4 md:right-auto z-50 flex items-center gap-2.5 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/90 px-4 py-2.5 text-xs font-medium text-amber-900 dark:text-amber-200 shadow-md"
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>{t('common.offlineBanner')}</span>
    </div>
  );
};
