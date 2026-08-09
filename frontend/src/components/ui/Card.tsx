import { cn } from '@/lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  bordered?: boolean;
  elevated?: boolean;
}

export function Card({ className, bordered = false, elevated = false, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl bg-white p-6 transition-shadow duration-200',
        bordered && 'border border-ink-900/10',
        elevated ? 'shadow-doxi-3' : bordered && 'shadow-doxi-1 hover:shadow-doxi-2',
        className,
      )}
      {...props}
    />
  );
}
