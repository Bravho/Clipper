/** Emergency rollback only. Native capability decides the normal default. */
export const LOCAL_FIRST_MEDIA_ENABLED =
  process.env.NEXT_PUBLIC_LOCAL_FIRST_MEDIA !== "false";
