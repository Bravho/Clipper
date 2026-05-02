/**
 * User roles in the Clipper platform.
 *
 * - Requester: External user who submits clip requests
 * - Editor:    Internal video editor who processes requests
 * - Admin:     Platform administrator with full access
 *
 * NOTE: Public signup can only create Requester accounts.
 *       Editor and Admin accounts are provisioned via seed/internal tooling.
 */
export enum Role {
  Requester = "requester",
  Editor = "editor",
  Admin = "admin",
}
