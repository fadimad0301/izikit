import type { Metadata } from 'next';
import './globals.css';
import { newsreader, ibmPlexMono, generalSans } from './fonts';
import { ToastProvider } from '@/contexts/ToastContext';
import { AuthProvider } from '@/contexts/AuthContext';

export const metadata: Metadata = {
  title: 'Doxi — Prépare ton dossier d’études à l’étranger',
  description:
    "Doxi t'accompagne pour préparer ton CV, ta checklist de documents et ton dossier de candidature (bourses, admissions, visas).",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${newsreader.variable} ${generalSans.variable} ${ibmPlexMono.variable}`}
    >
      <body className={generalSans.className}>
        <ToastProvider>
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
