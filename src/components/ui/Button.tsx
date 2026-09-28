import type { ButtonHTMLAttributes } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'normal' | 'small';
  block?: boolean;
};

export function Button({ variant = 'primary', size = 'normal', block = false, className = '', ...props }: ButtonProps) {
  return <button className={`button button--${variant} button--${size}${block ? ' button--block' : ''} ${className}`} {...props} />;
}
