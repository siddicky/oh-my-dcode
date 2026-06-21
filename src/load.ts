/**
 * Shared runtime-only module loader.
 *
 * Dynamically imports a package the typechecker should not resolve (so the
 * orchestration core stays typecheckable and unit-testable without the heavy
 * optional peers installed). The non-literal specifier is typed as `any`; each
 * caller casts the result to the minimal surface it relies on.
 */
export async function loadOptionalModule<T>(
  moduleName: string,
  hint: string,
): Promise<T> {
  try {
    return (await import(moduleName)) as unknown as T;
  } catch (err) {
    throw new Error(`${hint} Underlying error: ${(err as Error).message}`);
  }
}
