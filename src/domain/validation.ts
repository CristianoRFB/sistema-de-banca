export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };

export function success<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

export function failure<T = never>(
  ...issues: ValidationIssue[]
): ValidationResult<T> {
  return { ok: false, issues };
}

export function issue(
  code: string,
  path: string,
  message: string,
): ValidationIssue {
  return { code, path, message };
}

export class DomainRuleError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DomainRuleError";
    this.code = code;
  }
}