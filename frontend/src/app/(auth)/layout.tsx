import { Logo } from '@/components/brand/Logo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-paper-50 px-4 py-12">
      <Logo />
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}
