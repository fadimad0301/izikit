// /admin/* layout — gates every admin page behind GET /api/admin/me,
// redirects non-admins to /. Restyled to Doxi tokens (adapted from
// examples/frontend-pages/admin/layout.tsx, which ships unstyled).
'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';

interface AdminMe {
  admin: { id: string; email: string; role: 'ADMIN' | 'SUPERADMIN' };
}

const NAV = [
  { href: '/admin/users', label: 'Utilisateurs' },
  { href: '/admin/orders', label: 'Commandes' },
  { href: '/admin/procedures', label: 'Procédures' },
  { href: '/admin/audit-log', label: "Journal d'audit" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState<AdminMe['admin'] | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api<AdminMe>('/api/admin/me');
        if (!cancelled) setAdmin(res.admin);
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError) {
            router.replace('/');
          } else {
            router.replace('/');
          }
        }
      } finally {
        if (!cancelled) setChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!checked || !admin) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-paper-50">
        <p className="text-sm text-charcoal-900/60">Vérification des accès…</p>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen bg-paper-50">
      <aside className="w-60 shrink-0 border-r border-ink-900/10 bg-white p-5">
        <h1 className="mb-6 font-serif text-xl text-ink-900">Admin Doxi</h1>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                  active ? 'bg-ink-900 text-paper-50' : 'text-ink-900/80 hover:bg-paper-100'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <p className="mt-8 text-xs text-charcoal-900/60">
          Connecté en tant que
          <br />
          <span className="font-medium text-ink-900">{admin.email}</span>
          <br />
          <span className="text-charcoal-900/50">{admin.role}</span>
        </p>
      </aside>
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  );
}
