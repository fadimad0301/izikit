'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useReducedMotion, DURATION } from '@/lib/motion';

interface ProgressBarProps {
  value: number;
  max?: number;
  label?: string;
  className?: string;
}

export function ProgressBar({ value, max = 100, label, className }: ProgressBarProps) {
  const reduceMotion = useReducedMotion();
  const pct = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && <span className="text-xs font-medium text-ink-900/70">{label}</span>}
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        className="h-2 w-full overflow-hidden rounded-full bg-ink-900/10"
      >
        <motion.div
          className="h-full rounded-full bg-seal-gold"
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ duration: reduceMotion ? 0 : DURATION.slow }}
        />
      </div>
    </div>
  );
}
