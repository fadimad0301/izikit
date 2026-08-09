import { cn } from '@/lib/utils';

interface SectionProps extends React.HTMLAttributes<HTMLElement> {
  bg?: 'paper-50' | 'paper-100' | 'ink-900';
}

const BG_CLASSES: Record<NonNullable<SectionProps['bg']>, string> = {
  'paper-50': 'bg-paper-50',
  'paper-100': 'bg-paper-100',
  'ink-900': 'bg-ink-900 text-paper-50',
};

export function Section({ className, bg = 'paper-50', children, ...props }: SectionProps) {
  return (
    <section className={BG_CLASSES[bg]} {...props}>
      <div className={cn('mx-auto max-w-6xl px-4 py-16 md:py-24', className)}>{children}</div>
    </section>
  );
}
