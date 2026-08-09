import { Newsreader, IBM_Plex_Mono, Plus_Jakarta_Sans } from 'next/font/google';

export const newsreader = Newsreader({
  subsets: ['latin'],
  variable: '--font-newsreader',
  display: 'swap',
  style: ['normal', 'italic'],
});

export const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
});

// General Sans (from the design brief) isn't on Google Fonts and self-hosting
// external .woff2 files isn't reliable to automate here — Plus Jakarta Sans is
// a close geometric-sans substitute. Swap in the real General Sans later via
// next/font/local without touching any other file (the --font-general-sans
// CSS variable name is kept stable in globals.css for that reason).
export const generalSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-general-sans',
  display: 'swap',
});
