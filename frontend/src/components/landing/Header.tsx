'use client';

import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';

const NAV_LINKS = [
  { href: '#comment-ca-marche', label: 'Comment ça marche' },
  { href: '#tarifs', label: 'Tarifs' },
  { href: '#faq', label: 'FAQ' },
];

export function Header() {
  const { user, loading } = useAuth();

  return (
    <header className="sticky top-0 z-50 border-b border-ink-900/8 bg-paper-50/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <Logo />
        <nav className="hidden items-center gap-6 text-sm font-medium text-ink-900/70 md:flex">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="hover:text-ink-900">
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {!loading && user ? (
            <Link href="/cv">
              <Button size="sm">Mon espace</Button>
            </Link>
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost" size="sm">
                  Se connecter
                </Button>
              </Link>
              <Link href="/signup">
                <Button size="sm">Créer mon compte</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
