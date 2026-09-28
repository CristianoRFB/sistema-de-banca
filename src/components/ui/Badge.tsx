import type { HTMLAttributes } from 'react';

export function Badge({ tone = 'neutral', className = '', ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: 'neutral' | 'lime' | 'orange' | 'muted' }) {
  return <span className={`badge badge--${tone} ${className}`} {...props} />;
}
