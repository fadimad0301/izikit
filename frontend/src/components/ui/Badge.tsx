import { cn } from '@/lib/utils';

type BadgeVariant = 'gold' | 'success' | 'error' | 'neutral';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  gold: 'bg-seal-gold/15 text-seal-gold',
  success: 'bg-success-600/10 text-success-600',
  error: 'bg-error-600/10 text-error-600',
  neutral: 'bg-ink-900/8 text-ink-900',
};

export function Badge({ className, variant = 'neutral', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
        VARIANT_CLASSES[variant],
        className,
      )}
      {...props}
    />
  );
}
