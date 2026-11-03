/** Errors the repository layer raises; the HTTP layer maps `status` straight onto the response. */
export type RepoErrorCode = "not_found" | "conflict" | "needs_confirmation" | "invalid";

const STATUS: Record<RepoErrorCode, number> = { not_found: 404, conflict: 409, needs_confirmation: 409, invalid: 400 };

export class RepoError extends Error {
  readonly status: number;
  constructor(
    public code: RepoErrorCode,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}
