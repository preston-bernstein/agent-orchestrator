export class TfHostMismatchError extends Error {
  constructor(
    public readonly expectedHost: string,
    public readonly gotHost: string,
  ) {
    super(`tf egress refused: ${gotHost} ≠ ${expectedHost}`);
    this.name = "TfHostMismatchError";
  }
}

export class TfAuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`tf auth error: ${status}`);
    this.name = "TfAuthError";
  }
}

export class TfHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`tf http error: ${status}`);
    this.name = "TfHttpError";
  }
}

export class TfNetworkError extends Error {
  constructor(
    public override readonly cause: unknown,
    message = "tf network error",
  ) {
    super(message);
    this.name = "TfNetworkError";
  }
}
