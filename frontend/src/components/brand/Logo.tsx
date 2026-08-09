import Link from 'next/link';
import { cn } from '@/lib/utils';

interface LogoProps {
  className?: string;
  href?: string | false;
}

export function Logo({ className, href = '/' }: LogoProps) {
  const mark = (
    <span
      className={cn('inline-flex items-center gap-2 font-serif text-xl text-ink-900', className)}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-ink-900 font-sans text-sm font-semibold text-seal-gold">
        D
      </span>
      Doxi
    </span>
  );

  if (!href) return mark;

  return (
    <Link href={href} aria-label="Retour à l’accueil Doxi">
      {mark}
    </Link>
  );
}
