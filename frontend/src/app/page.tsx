import { Header } from '@/components/landing/Header';
import { Hero } from '@/components/landing/Hero';
import { TrustBar } from '@/components/landing/TrustBar';
import { PainPoints } from '@/components/landing/PainPoints';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { Pricing } from '@/components/landing/Pricing';
import { Testimonials } from '@/components/landing/Testimonials';
import { Faq } from '@/components/landing/Faq';
import { Footer } from '@/components/landing/Footer';
import { Section } from '@/components/landing/Section';

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <Section className="py-16 md:py-20">
          <Hero />
        </Section>
        <TrustBar />
        <PainPoints />
        <HowItWorks />
        <Pricing />
        <Testimonials />
        <Faq />
      </main>
      <Footer />
    </>
  );
}
