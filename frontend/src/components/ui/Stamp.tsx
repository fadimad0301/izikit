'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useReducedMotion } from '@/lib/motion';

interface StampProps {
  /** Diameter in px. */
  size?: number;
  delay?: number;
  className?: string;
  /** Content inside the ring — defaults to a checkmark icon when omitted. */
  children?: React.ReactNode;
}

// The Doxi signature motif: an ink-stamp settling onto a document. Tuned for
// a light overshoot then a firm settle — premium, not a toy bounce. Reused
// wherever the product wants to say "this is confirmed/complete": the Hero
// illustration (with the "VALIDÉ" label) and the CV reveal (icon-only).
export function Stamp({ size = 64, delay = 0.6, className, children }: StampProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      style={{ width: size, height: size }}
      className={cn(
        'flex items-center justify-center rounded-full border-4 border-seal-gold text-seal-gold',
        className,
      )}
      initial={{ opacity: 0, scale: reduceMotion ? 1 : 1.4, rotate: reduceMotion ? -18 : -24 }}
      animate={{ opacity: 1, scale: 1, rotate: -18 }}
      transition={
        reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 26, delay }
      }
      aria-hidden="true"
    >
      {children ?? (
        <svg
          className="h-1/2 w-1/2"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      )}
    </motion.div>
  );
}
