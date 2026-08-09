import { forwardRef, useId } from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string | undefined;
  helperText?: string | undefined;
  error?: string | undefined;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, helperText, error, id, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const helperId = `${inputId}-helper`;
    const errorId = `${inputId}-error`;

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-ink-900">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : helperText ? helperId : undefined}
          className={cn(
            'h-11 rounded-xl border bg-white px-3.5 text-sm text-charcoal-900 outline-none transition-colors',
            'placeholder:text-charcoal-900/40',
            'focus:border-seal-gold focus:ring-2 focus:ring-seal-gold/30',
            error ? 'border-error-600' : 'border-ink-900/15',
            className,
          )}
          {...props}
        />
        {error ? (
          <p id={errorId} className="text-xs text-error-600">
            {error}
          </p>
        ) : (
          helperText && (
            <p id={helperId} className="text-xs text-charcoal-900/60">
              {helperText}
            </p>
          )
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';
