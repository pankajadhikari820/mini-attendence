import React from 'react';

export const CardSkeleton: React.FC<{ rows?: number }> = ({ rows = 3 }) => (
  <div className="space-y-3 animate-pulse">
    {Array.from({ length: rows }).map((_, i) => (
      <div
        key={i}
        className="h-14 rounded-xl bg-stone-200/70 dark:bg-stone-800/70"
      />
    ))}
  </div>
);

export const StatGridSkeleton: React.FC = () => (
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
    {[0, 1, 2, 3].map((i) => (
      <div
        key={i}
        className="h-28 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5"
      >
        <div className="h-3.5 w-20 bg-stone-200 dark:bg-stone-800 rounded mb-4" />
        <div className="h-8 w-16 bg-stone-200 dark:bg-stone-800 rounded" />
      </div>
    ))}
  </div>
);

interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  actionLabel,
  onAction,
}) => (
  <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-6 py-12 text-center">
    <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">{title}</h3>
    <p className="mt-1.5 text-sm text-stone-500 dark:text-stone-400 max-w-md mx-auto">
      {description}
    </p>
    {actionLabel && onAction && (
      <button
        type="button"
        onClick={onAction}
        className="mt-5 inline-flex items-center justify-center rounded-lg bg-[#C25E00] hover:bg-[#A84F00] text-white px-4 py-2 text-sm font-medium transition-colors"
      >
        {actionLabel}
      </button>
    )}
  </div>
);
