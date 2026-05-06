/**
 * User-facing CLI argv / policy mistakes (mutually exclusive flags, missing values).
 * Lives outside `cli/` so policy and other layers can throw without depending on the parser module.
 */
export class CliArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliArgError";
  }
}
