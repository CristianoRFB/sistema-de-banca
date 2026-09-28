import { DomainRuleError } from "../validation";
import type { ValidationIssue } from "../validation";

export class SchemaValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(issues.map((entry) => entry.path + ": " + entry.message).join(" "));
    this.name = "SchemaValidationError";
    this.issues = issues;
  }
}

export function rejectSchema(
  code: string,
  path: string,
  message: string,
): never {
  throw new SchemaValidationError([{ code, path, message }]);
}

export type SafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: SchemaValidationError };

export interface RuntimeSchema<T> {
  parse(input: unknown): T;
  safeParse(input: unknown): SafeParseResult<T>;
}

export function createSchema<T>(
  parseValue: (input: unknown) => T,
): RuntimeSchema<T> {
  const parse = (input: unknown): T => {
    try {
      return parseValue(input);
    } catch (error) {
      if (error instanceof DomainRuleError) {
        throw new SchemaValidationError([
          { code: error.code, path: "value", message: error.message },
        ]);
      }
      throw error;
    }
  };
  return {
    parse,
    safeParse(input) {
      try {
        return { success: true, data: parse(input) };
      } catch (error) {
        if (error instanceof SchemaValidationError) {
          return { success: false, error };
        }
        throw error;
      }
    },
  };
}

export function record(input: unknown, path = "value"): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new SchemaValidationError([
      { code: "EXPECTED_OBJECT", path, message: "Informe um objeto." },
    ]);
  }
  return input as Record<string, unknown>;
}

export function string(
  value: unknown,
  path: string,
  options: { minLength?: number; allowEmpty?: boolean } = {},
): string {
  if (typeof value !== "string") {
    throw new SchemaValidationError([
      { code: "EXPECTED_STRING", path, message: "Informe um texto." },
    ]);
  }
  if (!options.allowEmpty && value.trim().length < (options.minLength ?? 1)) {
    throw new SchemaValidationError([
      { code: "STRING_TOO_SHORT", path, message: "Este texto não pode ficar vazio." },
    ]);
  }
  return value;
}

export function nullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return string(value, path, { allowEmpty: true });
}

export function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new SchemaValidationError([
      { code: "EXPECTED_BOOLEAN", path, message: "Informe um valor booleano." },
    ]);
  }
  return value;
}

export function integer(
  value: unknown,
  path: string,
  options: { min?: number; max?: number } = {},
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < (options.min ?? 0) ||
    (options.max !== undefined && value > options.max)
  ) {
    throw new SchemaValidationError([
      { code: "EXPECTED_INTEGER", path, message: "Informe um número inteiro válido." },
    ]);
  }
  return value;
}

export function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SchemaValidationError([
      { code: "EXPECTED_NUMBER", path, message: "Informe um número válido." },
    ]);
  }
  return value;
}

export function nullableNumber(value: unknown, path: string): number | null {
  return value === null ? null : finiteNumber(value, path);
}

export function date(value: unknown, path: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new SchemaValidationError([
      { code: "EXPECTED_DATE", path, message: "Informe uma data válida." },
    ]);
  }
  return new Date(value.getTime());
}

export function nullableDate(value: unknown, path: string): Date | null {
  return value === null ? null : date(value, path);
}

export function enumValue<T extends Record<string, string>>(
  values: T,
  value: unknown,
  path: string,
): T[keyof T] {
  if (
    typeof value !== "string" ||
    !(Object.values(values) as string[]).includes(value)
  ) {
    throw new SchemaValidationError([
      { code: "INVALID_ENUM", path, message: "O valor informado não é reconhecido." },
    ]);
  }
  return value as T[keyof T];
}
