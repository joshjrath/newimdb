/** The last few server errors (kept in memory), so the error page can say what broke. */
export interface LoggedError {
  at: string;
  path: string;
  digest: string | null;
  message: string;
}

const g = globalThis as unknown as { __errors?: LoggedError[] };

export function logError(e: LoggedError) {
  g.__errors = [e, ...(g.__errors ?? [])].slice(0, 20);
}

export const recentErrors = () => g.__errors ?? [];
