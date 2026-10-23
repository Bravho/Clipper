/** A refusal the API turns into `{ error, code }` with the given HTTP status. */
export class CampaignError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "bad_key"
      | "not_live"
      | "ended"
      | "invalid"
      | "bad_install"
      | "no_session"
      | "limit"
      | "forbidden",
    message: string,
    readonly status: number = 400,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "CampaignError";
  }
}
