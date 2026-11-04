/** Preserve useful CAD errors while explaining how to recover from an updated app. */
export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
      message,
    )
  )
    return 'This tool could not load. Save your project, reload the page, then open the saved project and try again.';
  return message;
}
