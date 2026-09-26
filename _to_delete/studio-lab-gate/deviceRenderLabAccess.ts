/** Keep the unfinished phone render lab private on production deployments. */
export function canAccessDeviceRenderLab(email?: string | null): boolean {
  if (process.env.NODE_ENV === "development") return true;

  const allowedEmail = process.env.DEVICE_RENDER_LAB_TEST_EMAIL?.trim().toLowerCase();
  return Boolean(allowedEmail && email?.trim().toLowerCase() === allowedEmail);
}
