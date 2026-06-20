/**
 * Minimal YAML helpers for emitting front-matter.
 *
 * Front-matter values such as descriptions ("…working code: expand → plan…")
 * and `provider:model` strings contain colons and other YAML-significant
 * characters. Emitted unquoted, a colon makes the parser read the value as a
 * nested mapping ("mapping values are not allowed here"). JSON string syntax is
 * a valid YAML double-quoted scalar, so `JSON.stringify` produces a safe,
 * correctly-escaped scalar for any single-line string.
 */

/** Render a string as a YAML-safe double-quoted scalar. */
export function yamlString(value: string): string {
  return JSON.stringify(value);
}
