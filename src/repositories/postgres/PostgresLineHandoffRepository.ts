import { pool } from '@/lib/db';
import { ILineHandoffRepository } from '../interfaces/ILineHandoffRepository';

export class PostgresLineHandoffRepository implements ILineHandoffRepository {
  constructor(private db = pool) {}
  async reserveNotification(shopUserId: string, maximum: number): Promise<boolean> {
    const result = await this.db.query(`INSERT INTO line_handoff_notification_limits (shop_user_id,window_start)
      VALUES ($1,date_trunc('minute',NOW())) ON CONFLICT (shop_user_id,window_start)
      DO UPDATE SET count=line_handoff_notification_limits.count+1
      WHERE line_handoff_notification_limits.count < $2 RETURNING count`, [shopUserId, maximum]);
    return !!result.rowCount;
  }
}
