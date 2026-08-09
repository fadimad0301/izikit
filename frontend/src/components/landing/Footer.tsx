import { Logo } from '@/components/brand/Logo';

export function Footer() {
  return (
    <footer className="bg-ink-900 text-paper-50/70">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 md:flex-row md:items-center md:justify-between">
        <Logo className="text-paper-50" />
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <a href="#comment-ca-marche" className="hover:text-paper-50">
            Comment ça marche
          </a>
          <a href="#tarifs" className="hover:text-paper-50">
            Tarifs
          </a>
          <a href="#faq" className="hover:text-paper-50">
            FAQ
          </a>
        </nav>
        <p className="text-xs text-paper-50/50">
          © {new Date().getFullYear()} Doxi. Tous droits réservés.
        </p>
      </div>
    </footer>
  );
}
