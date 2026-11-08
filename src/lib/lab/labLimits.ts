/**
 * Lab limits that both the browser and the server can import.
 * Kept free of Node-only modules (no fs/path), so client bundles can use it.
 */

/** Hard cap on credits one lab run may reserve. */
export const LAB_LEDGER_PER_RUN_CAP = 350;
