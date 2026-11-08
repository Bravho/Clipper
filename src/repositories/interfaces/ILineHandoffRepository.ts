/** Atomic notification budget shared by every worker process. */
export interface ILineHandoffRepository {
  reserveNotification(shopUserId: string, maximum: number): Promise<boolean>;
}
