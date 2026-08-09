import { Badge } from '@/components/ui';

// Real program/institution names Doxi's checklists are built against —
// not placeholder copy. Extend as new procedures are added to the catalog.
const PROGRAMS = ['Campus France', 'Chevening', 'Bourses Canada', 'AMCI Maroc', 'YTB Türkiye'];

export function TrustBar() {
  return (
    <div className="border-y border-ink-900/8 bg-paper-100">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-4 py-6">
        <span className="text-xs font-medium tracking-wide text-charcoal-900/50 uppercase">
          Checklists conformes aux exigences de
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {PROGRAMS.map((name) => (
            <Badge key={name} variant="neutral" className="gap-1.5">
              <svg
                className="h-3 w-3 text-success-600"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              {name}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}
