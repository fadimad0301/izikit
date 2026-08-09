import { cn } from '@/lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  bordered?: boolean;
  elevated?: boolean;
}

export function Card({ className, bordered = false, elevated = false, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl bg-white p-6',
        bordered && 'border border-ink-900/10',
        elevated && 'shadow-lg shadow-ink-900/5',
        className,
      )}
      {...props}
    />
  );
}
