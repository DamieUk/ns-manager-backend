export class HttpError extends Error {
  public readonly status: number;
  // Extra fields sent along with `message` in the error response.
  public readonly details?: Record<string, unknown>;

  constructor(status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}
