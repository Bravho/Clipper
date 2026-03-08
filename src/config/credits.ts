/**
 * Credit system configuration.
 *
 * All credit values are defined here so they can be changed in one place.
 * Business rule: new requesters receive SIGNUP_BONUS_CREDITS on registration.
 *
 * TODO: When a billing/purchase system is added, define credit packages here.
 */
export const CREDITS_CONFIG = {
  /** Free credits granted to every new requester account */
  SIGNUP_BONUS_CREDITS: 30,

  /** Credits charged per clip request submission (future) */
  REQUEST_COST_CREDITS: 10,
} as const;
