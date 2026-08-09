'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useReducedMotion } from '@/lib/motion';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}

export function Toggle({ checked, onChange, disabled = false, label, className }: ToggleProps) {
  const reduceMotion = useReducedMotion();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seal-gold focus-visible:ring-offset-2',
        checked ? 'bg-ink-900' : 'bg-ink-900/20',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <motion.span
        className="h-4.5 w-4.5 rounded-full bg-white shadow"
        animate={{ x: checked ? 22 : 3 }}
        transition={
          reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 30 }
        }
      />
    </button>
  );
}
