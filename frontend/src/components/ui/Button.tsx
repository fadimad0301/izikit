'use client';

import { forwardRef } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useReducedMotion } from '@/lib/motion';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

// Native DOM handlers whose signatures collide with framer-motion's
// HTMLMotionProps equivalents (drag/animation events carry different
// argument shapes) — omit so `motion.button` wins.
type ConflictingNativeProps =
  | 'style'
  | 'onDrag'
  | 'onDragStart'
  | 'onDragEnd'
  | 'onAnimationStart'
  | 'onAnimationEnd'
  | 'onAnimationIteration';

interface ButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  ConflictingNativeProps
> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-ink-900 text-paper-50 hover:bg-ink-700 disabled:bg-ink-900/50',
  secondary: 'bg-paper-100 text-ink-900 border border-ink-900/20 hover:border-ink-900/40',
  ghost: 'bg-transparent text-ink-900 hover:bg-paper-100',
  danger: 'bg-error-600 text-paper-50 hover:bg-error-600/90',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-sm gap-1.5',
  md: 'h-11 px-5 text-sm gap-2',
  lg: 'h-13 px-6 text-base gap-2.5',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = 'primary', size = 'md', loading = false, disabled, children, ...props },
    ref,
  ) => {
    const reduceMotion = useReducedMotion();
    const isDisabled = disabled || loading;
    // exactOptionalPropertyTypes rejects `whileTap={undefined}` — conditionally
    // spread the animation props instead of passing an explicit undefined.
    const motionProps =
      reduceMotion || isDisabled ? {} : { whileTap: { scale: 0.97 }, whileHover: { y: -1 } };

    return (
      <motion.button
        ref={ref}
        type="button"
        disabled={isDisabled}
        {...motionProps}
        transition={{ duration: 0.12 }}
        className={cn(
          'inline-flex items-center justify-center rounded-xl font-medium transition-colors',
          'disabled:cursor-not-allowed disabled:opacity-70',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seal-gold focus-visible:ring-offset-2',
          VARIANT_CLASSES[variant],
          SIZE_CLASSES[size],
          className,
        )}
        {...props}
      >
        {loading && (
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        )}
        {children}
      </motion.button>
    );
  },
);

Button.displayName = 'Button';
