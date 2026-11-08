import { ILineHandoffRepository } from '@/repositories/interfaces/ILineHandoffRepository';

export class LineHandoffService {
  constructor(private repo: ILineHandoffRepository) {}
  reserveNotification(shopUserId: string): Promise<boolean> {
    const configured = Number(process.env.LINE_HANDOFF_FORWARD_PER_SHOP_PER_MIN);
    return this.repo.reserveNotification(shopUserId, Number.isInteger(configured) && configured > 0 ? configured : 6);
  }
}
