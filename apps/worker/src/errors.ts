/** A job failure that is safe to show to the user. The message is German. */
export class JobFailure extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "JobFailure";
    this.code = code;
    this.retryable = retryable;
  }
}

/** True when a failed job may succeed on a later attempt. */
export function isRetryableCode(code: string): boolean {
  return [
    "extraction_failed",
    "ai_unavailable",
    "source_unavailable",
    "export_failed",
    "internal",
  ].includes(code);
}
