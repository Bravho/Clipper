import { IClipRequestRepository } from "@/repositories/interfaces/IClipRequestRepository";
import {
  ClipRequest,
  CreateClipRequestInput,
  UpdateClipRequestInput,
  UpdateStaffFieldsInput,
} from "@/domain/models/ClipRequest";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { Platform } from "@/domain/enums/Platform";
import { EditorType } from "@/domain/enums/EditorType";
import { EffortClass } from "@/domain/enums/EffortClass";
import { CREDITS_CONFIG } from "@/config/credits";
import { pool } from "@/lib/db";

function rowToClipRequest(row: Record<string, unknown>): ClipRequest {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    title: row.title as string,
    description: row.description as string,
    targetAudience: row.target_audience as string,
    targetPlatforms: (row.target_platforms as string[]) as Platform[],
    preferredStyle: (row.preferred_style as string) ?? "",
    preferredLanguage: (row.preferred_language as string) ?? "",
    durationSeconds: row.duration_seconds as number,
    status: row.status as RequestStatus,
    estimatedDueDate: row.estimated_due_date
      ? new Date(row.estimated_due_date as string)
      : null,
    confirmedDueDate: row.confirmed_due_date
      ? new Date(row.confirmed_due_date as string)
      : null,
    dueDateConfirmed: row.due_date_confirmed as boolean,
    holdReason: (row.hold_reason as string) ?? null,
    rejectionReason: (row.rejection_reason as string) ?? null,
    queuePosition:
      row.queue_position != null ? (row.queue_position as number) : null,
    creditConfirmed: row.credit_confirmed as boolean,
    rightsConfirmed: row.rights_confirmed as boolean,
    creditsCost: row.credits_cost as number,
    assignedEditorId: (row.assigned_editor_id as string) ?? null,
    editorType: (row.editor_type as EditorType) ?? null,
    priceBaht: parseFloat((row.price_baht as string) ?? "0"),
    creditsUsed: (row.credits_used as number) ?? 0,
    discountBaht: parseFloat((row.discount_baht as string) ?? "0"),
    amountPaidBaht: parseFloat((row.amount_paid_baht as string) ?? "0"),
    revisionCount: (row.revision_count as number) ?? 0,
    submittedAt: row.submitted_at
      ? new Date(row.submitted_at as string)
      : null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    effortClass: (row.effort_class as EffortClass) ?? null,
    assignedStaffId: (row.assigned_staff_id as string) ?? null,
  };
}

// Columns that can be updated via the requester-facing update() method.
const REQUESTER_UPDATE_COLS: Record<string, string> = {
  title: "title",
  description: "description",
  targetAudience: "target_audience",
  targetPlatforms: "target_platforms",
  preferredStyle: "preferred_style",
  preferredLanguage: "preferred_language",
  durationSeconds: "duration_seconds",
};

// Extra columns that can be set via updateStatus().
const STATUS_EXTRA_COLS: Record<string, string> = {
  holdReason: "hold_reason",
  rejectionReason: "rejection_reason",
  confirmedDueDate: "confirmed_due_date",
  dueDateConfirmed: "due_date_confirmed",
  estimatedDueDate: "estimated_due_date",
  queuePosition: "queue_position",
  submittedAt: "submitted_at",
  creditConfirmed: "credit_confirmed",
  rightsConfirmed: "rights_confirmed",
  assignedStaffId: "assigned_staff_id",
  assignedEditorId: "assigned_editor_id",
  editorType: "editor_type",
  priceBaht: "price_baht",
  creditsUsed: "credits_used",
  discountBaht: "discount_baht",
  amountPaidBaht: "amount_paid_baht",
  revisionCount: "revision_count",
};

export class PostgresClipRequestRepository
  implements IClipRequestRepository
{
  constructor(private db = pool) {}

  // ── Requester queries ─────────────────────────────────────────────────────

  async findById(id: string): Promise<ClipRequest | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM clip_requests WHERE id = $1",
      [id]
    );
    return rows[0] ? rowToClipRequest(rows[0]) : null;
  }

  async findByUserId(userId: string): Promise<ClipRequest[]> {
    const { rows } = await this.db.query(
      "SELECT * FROM clip_requests WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    );
    return rows.map(rowToClipRequest);
  }

  async findByUserIdAndStatus(
    userId: string,
    statuses: RequestStatus[]
  ): Promise<ClipRequest[]> {
    const { rows } = await this.db.query(
      "SELECT * FROM clip_requests WHERE user_id = $1 AND status = ANY($2::text[]) ORDER BY updated_at DESC",
      [userId, statuses]
    );
    return rows.map(rowToClipRequest);
  }

  // ── Editor queries ────────────────────────────────────────────────────────

  async findByEditorId(editorId: string): Promise<ClipRequest[]> {
    const { rows } = await this.db.query(
      "SELECT * FROM clip_requests WHERE assigned_editor_id = $1 ORDER BY updated_at DESC",
      [editorId]
    );
    return rows.map(rowToClipRequest);
  }

  async findByEditorIdAndStatus(
    editorId: string,
    statuses: RequestStatus[]
  ): Promise<ClipRequest[]> {
    const { rows } = await this.db.query(
      "SELECT * FROM clip_requests WHERE assigned_editor_id = $1 AND status = ANY($2::text[]) ORDER BY updated_at DESC",
      [editorId, statuses]
    );
    return rows.map(rowToClipRequest);
  }

  // ── Staff queries ─────────────────────────────────────────────────────────

  async findByStatus(statuses: RequestStatus[]): Promise<ClipRequest[]> {
    const { rows } = await this.db.query(
      "SELECT * FROM clip_requests WHERE status = ANY($1::text[]) ORDER BY submitted_at ASC NULLS LAST, created_at ASC",
      [statuses]
    );
    return rows.map(rowToClipRequest);
  }

  async findAll(limit?: number): Promise<ClipRequest[]> {
    const { rows } = await this.db.query(
      limit
        ? "SELECT * FROM clip_requests ORDER BY updated_at DESC LIMIT $1"
        : "SELECT * FROM clip_requests ORDER BY updated_at DESC",
      limit ? [limit] : []
    );
    return rows.map(rowToClipRequest);
  }

  async countByStatus(): Promise<Partial<Record<RequestStatus, number>>> {
    const { rows } = await this.db.query(
      "SELECT status, COUNT(*)::int AS count FROM clip_requests GROUP BY status"
    );
    const result: Partial<Record<RequestStatus, number>> = {};
    for (const row of rows) {
      result[row.status as RequestStatus] = row.count as number;
    }
    return result;
  }

  async findOverdue(): Promise<ClipRequest[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM clip_requests
       WHERE confirmed_due_date < NOW()
         AND status NOT IN ('delivered','rejected','on_hold','draft')
       ORDER BY confirmed_due_date ASC`
    );
    return rows.map(rowToClipRequest);
  }

  async findPendingDueDateConfirmation(): Promise<ClipRequest[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM clip_requests
       WHERE status IN ('accepted_for_production','editing','under_review')
         AND due_date_confirmed = false
       ORDER BY submitted_at ASC NULLS LAST`
    );
    return rows.map(rowToClipRequest);
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  async create(input: CreateClipRequestInput): Promise<ClipRequest> {
    const { rows } = await this.db.query(
      `INSERT INTO clip_requests (
         user_id, title, description, target_audience,
         target_platforms, preferred_style, preferred_language,
         duration_seconds, credits_cost
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        input.userId,
        input.title,
        input.description,
        input.targetAudience,
        input.targetPlatforms,
        input.preferredStyle,
        input.preferredLanguage,
        input.durationSeconds,
        CREDITS_CONFIG.REQUEST_COST_CREDITS,
      ]
    );
    return rowToClipRequest(rows[0]);
  }

  async update(id: string, input: UpdateClipRequestInput): Promise<ClipRequest> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue;
      const col = REQUESTER_UPDATE_COLS[key];
      if (!col) continue;
      sets.push(`${col} = $${idx++}`);
      values.push(value);
    }

    if (sets.length === 0) {
      const { rows } = await this.db.query(
        "SELECT * FROM clip_requests WHERE id = $1",
        [id]
      );
      if (!rows[0]) throw new Error(`ClipRequest not found: ${id}`);
      return rowToClipRequest(rows[0]);
    }

    sets.push(`updated_at = NOW()`);
    values.push(id);

    const { rows } = await this.db.query(
      `UPDATE clip_requests SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!rows[0]) throw new Error(`ClipRequest not found: ${id}`);
    return rowToClipRequest(rows[0]);
  }

  async updateStaffFields(
    id: string,
    input: UpdateStaffFieldsInput
  ): Promise<ClipRequest> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (input.effortClass !== undefined) {
      sets.push(`effort_class = $${idx++}`);
      values.push(input.effortClass);
    }

    if (sets.length === 0) {
      const { rows } = await this.db.query(
        "SELECT * FROM clip_requests WHERE id = $1",
        [id]
      );
      if (!rows[0]) throw new Error(`ClipRequest not found: ${id}`);
      return rowToClipRequest(rows[0]);
    }

    sets.push(`updated_at = NOW()`);
    values.push(id);

    const { rows } = await this.db.query(
      `UPDATE clip_requests SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!rows[0]) throw new Error(`ClipRequest not found: ${id}`);
    return rowToClipRequest(rows[0]);
  }

  async updateStatus(
    id: string,
    status: RequestStatus,
    extra?: Partial<
      Pick<
        ClipRequest,
        | "holdReason"
        | "rejectionReason"
        | "confirmedDueDate"
        | "dueDateConfirmed"
        | "estimatedDueDate"
        | "queuePosition"
        | "submittedAt"
        | "creditConfirmed"
        | "rightsConfirmed"
        | "assignedStaffId"
        | "assignedEditorId"
        | "editorType"
        | "priceBaht"
        | "creditsUsed"
        | "discountBaht"
        | "amountPaidBaht"
        | "revisionCount"
      >
    >
  ): Promise<ClipRequest> {
    const sets = [`status = $1`, `updated_at = NOW()`];
    const values: unknown[] = [status];
    let idx = 2;

    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        if (value === undefined) continue;
        const col = STATUS_EXTRA_COLS[key];
        if (!col) continue;
        sets.push(`${col} = $${idx++}`);
        values.push(value);
      }
    }

    values.push(id);
    const { rows } = await this.db.query(
      `UPDATE clip_requests SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!rows[0]) throw new Error(`ClipRequest not found: ${id}`);
    return rowToClipRequest(rows[0]);
  }

  async delete(id: string): Promise<void> {
    await this.db.query("DELETE FROM clip_requests WHERE id = $1", [id]);
  }
}
