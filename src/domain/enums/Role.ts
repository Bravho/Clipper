/**
 * User roles in the Clipper platform.
 *
 * - Requester: External user who submits clip requests. Requesters now also
 *              perform all production actions (triggering the AI pipeline,
 *              voice recording, approval gates, and self-service status
 *              transitions) that were previously gated behind a Staff/Editor role.
 * - Admin:     Platform administrator with full access
 *
 * NOTE: Public signup can only create Requester accounts.
 *       Admin accounts are provisioned via seed/internal tooling.
 */
export enum Role {
  Requester = "requester",
  Admin = "admin",
}
