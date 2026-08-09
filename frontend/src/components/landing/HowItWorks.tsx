'use client';

import { useRef, useEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Section } from './Section';
import { useReducedMotion } from '@/lib/motion';

const STEPS = [
  {
    n: '01',
    title: 'Décris ton profil',
    body: 'Ton pays cible, ton domaine d’études, ton parcours — Doxi structure ton CV en quelques minutes.',
  },
  {
    n: '02',
    title: 'Reçois ta checklist',
    body: 'La liste exacte des documents attendus pour ta procédure, avec un plan d’action clair.',
  },
  {
    n: '03',
    title: 'Prépare et dépose ton dossier',
    body: 'Génère tes documents, suis ton avancement, et dépose un dossier complet et conforme.',
  },
];

// The one deliberately "cinematic" scroll moment on the page, per the design
// brief's "un seul moment fort par page" guidance — everything else on this
// page uses plain Framer Motion.
export function HowItWorks() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion || !sectionRef.current) return;
    gsap.registerPlugin(ScrollTrigger);

    const ctx = gsap.context(() => {
      gsap.from('[data-step]', {
        opacity: 0,
        y: 32,
        duration: 0.5,
        stagger: 0.15,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top 75%',
        },
      });
    }, sectionRef);

    return () => ctx.revert();
  }, [reduceMotion]);

  return (
    <Section id="comment-ca-marche">
      <div ref={sectionRef}>
        <p className="text-xs font-semibold tracking-wide text-seal-gold uppercase">Méthode</p>
        <h2 className="mt-2 max-w-xl font-serif text-3xl text-ink-900">
          Trois étapes vers ton admission
        </h2>
        <div className="mt-10 grid gap-8 md:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.n} data-step>
              <span className="font-mono text-sm text-seal-gold">{step.n}</span>
              <h3 className="mt-2 font-medium text-ink-900">{step.title}</h3>
              <p className="mt-2 text-sm text-charcoal-900/70">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
