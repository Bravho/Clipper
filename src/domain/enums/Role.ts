/**
 * User roles in the Clipper platform.
 *
 * - Requester: External user who submits clip requests
 * - Staff:     Internal team member who processes requests
 * - Admin:     Platform administrator with full access
 *
 * NOTE: Public signup can only create Requester accounts.
 *       Staff and Admin accounts are provisioned via seed/internal tooling.
 */
export enum Role {
  Requester = "requester",
  Staff = "staff",
  Admin = "admin",
}
