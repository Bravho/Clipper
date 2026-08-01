/**
 * PostgreSQL implementation of the publication repository.
 *
 * Style matches the other Postgres repositories: raw `pg`, hand-written SQL, a
 * `rowTo…` mapper per aggregate, no ORM.
 *
 * The one operation that must be transactional is `createWithTargets`: the
 * publication and its destinations are a single fact ("we are going to publish
 * this video to these accounts"), and a partial write there would leave a post
 * that reconciliation could neither complete nor abandon.
 */

import { pool } from "@/lib/db";
import type { PoolClient } from "pg";
import type {
  ManagementPublication,
  ManagementPublicationTarget,
  CreatePublicationInput,
  UpdatePublicationTargetFields,
  PublicationWithTargets,
} from "@/domain/models/ManagementPublication";
import {
  ManagementPublicationStatus,
  ManagementPublicationTargetStatus,
  ManagementPublishMode,
} from "@/domain/enums/ManagementStatus";
import type { IManagementPublicationRepository } from "@/repositories/interfaces/IManagementPublicationRepositories";

type Row = Record<string, unknown>;

const asDate = (v: unknown): Date => new Date(v as string);
const asDateOrNull = (v: unknown): Date | null => (v ? new Date(v as string) : null);

function rowToPublication(row: Row): ManagementPublication {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    managementContentId: row.management_content_id as string,
    publishMode: row.publish_mode as ManagementPublishMode,
    scheduledAt: asDateOrNull(row.scheduled_at),
    timezone: (row.timezone as string) ?? null,
    status: row.status as ManagementPublicationStatus,
    providerPostId: (row.provider_post_id as string) ?? null,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

function rowToTarget(row: Row): ManagementPublicationTarget {
  return {
    id: row.id as string,
    publicationId: row.publication_id as string,
    socialConnectionId: row.social_connection_id as string,
    platform: row.platform as string,
    caption: (row.caption as string) ?? "",
    title: (row.title as string) ?? null,
    description: (row.description as string) ?? null,
    hashtags: (row.hashtags as string[]) ?? [],
    managementContentAssetId: (row.management_content_asset_id as string) ?? null,
    uploadBundleId: (row.upload_bundle_id as string) ?? null,
    providerPostId: (row.provider_post_id as string) ?? null,
    providerResultId: (row.provider_result_id as string) ?? null,
    status: row.status as ManagementPublicationTargetStatus,
    errorCode: (row.error_code as string) ?? null,
    errorMessage: (row.error_message as string) ?? null,
    publishedUrl: (row.published_url as string) ?? null,
    scheduledAt: asDateOrNull(row.scheduled_at),
    publishedAt: asDateOrNull(row.published_at),
    providerMetadata: (row.provider_metadata as Record<string, unknown>) ?? null,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

export class PostgresManagementPublicationRepository
  implements IManagementPublicationRepository
{
  constructor(private db = pool) {}

  async createWithTargets(input: CreatePublicationInput): Promise<PublicationWithTargets> {
    const client: PoolClient = await this.db.connect();
    try {
      await client.query("BEGIN");

      const pub = await client.query(
        `INSERT INTO management_publications
           (user_id, management_content_id, publish_mode, scheduled_at, timezone,
            status, entitlement_type, access_pass_id, publish_entitlement_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          input.userId,
          input.managementContentId,
          input.publishMode,
          input.scheduledAt,
          input.timezone,
          ManagementPublicationStatus.Draft,
          input.entitlementType,
          input.accessPassId,
          input.publishEntitlementId,
        ]
      );
      const publication = rowToPublication(pub.rows[0]);

      const targets: ManagementPublicationTarget[] = [];
      for (const t of input.targets) {
        const { rows } = await client.query(
          `INSERT INTO management_publication_targets
             (publication_id, social_connection_id, platform, caption, title,
              description, hashtags, management_content_asset_id, status, scheduled_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING *`,
          [
            publication.id,
            t.socialConnectionId,
            t.platform,
            t.caption,
            t.title,
            t.description,
            t.hashtags,
            t.managementContentAssetId,
            ManagementPublicationTargetStatus.Draft,
            t.scheduledAt,
          ]
        );
        targets.push(rowToTarget(rows[0]));
      }

      await client.query("COMMIT");
      return { publication, targets };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async findById(id: string): Promise<ManagementPublication | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM management_publications WHERE id = $1",
      [id]
    );
    return rows[0] ? rowToPublication(rows[0]) : null;
  }

  async findByUserId(userId: string): Promise<ManagementPublication[]> {
    const { rows } = await this.db.query(
      "SELECT * FROM management_publications WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    );
    return rows.map(rowToPublication);
  }

  async findByContentId(managementContentId: string): Promise<ManagementPublication[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM management_publications
        WHERE management_content_id = $1 ORDER BY created_at DESC`,
      [managementContentId]
    );
    return rows.map(rowToPublication);
  }

  async findTargets(publicationId: string): Promise<ManagementPublicationTarget[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM management_publication_targets
        WHERE publication_id = $1 ORDER BY created_at ASC`,
      [publicationId]
    );
    return rows.map(rowToTarget);
  }

  async findWithTargets(id: string): Promise<PublicationWithTargets | null> {
    const publication = await this.findById(id);
    if (!publication) return null;
    const targets = await this.findTargets(id);
    return { publication, targets };
  }

  async setProviderPostId(id: string, providerPostId: string): Promise<void> {
    await this.db.query(
      `UPDATE management_publications
          SET provider_post_id = COALESCE(provider_post_id, $2), updated_at = NOW()
        WHERE id = $1`,
      [id, providerPostId]
    );
  }

  async updateStatus(
    id: string,
    status: ManagementPublicationStatus
  ): Promise<ManagementPublication> {
    const { rows } = await this.db.query(
      `UPDATE management_publications
          SET status = $2, updated_at = NOW()
        WHERE id = $1
      RETURNING *`,
      [id, status]
    );
    if (!rows[0]) throw new Error("Management publication not found.");
    return rowToPublication(rows[0]);
  }

  async updateTarget(
    targetId: string,
    fields: UpdatePublicationTargetFields
  ): Promise<ManagementPublicationTarget> {
    // COALESCE keeps a column unchanged when its parameter is undefined/null,
    // except where a null is a meaningful clear (error fields on success). We
    // pass explicit nulls only through the dedicated clear columns below.
    const { rows } = await this.db.query(
      `UPDATE management_publication_targets
          SET status            = COALESCE($2, status),
              provider_post_id  = COALESCE($3, provider_post_id),
              provider_result_id = COALESCE($4, provider_result_id),
              error_code        = $5,
              error_message     = $6,
              published_url     = COALESCE($7, published_url),
              published_at      = COALESCE($8, published_at),
              scheduled_at      = COALESCE($9, scheduled_at),
              provider_metadata = COALESCE($10, provider_metadata),
              caption           = COALESCE($11, caption),
              title             = COALESCE($12, title),
              description       = COALESCE($13, description),
              hashtags          = COALESCE($14, hashtags),
              updated_at = NOW()
        WHERE id = $1
      RETURNING *`,
      [
        targetId,
        fields.status ?? null,
        fields.providerPostId ?? null,
        fields.providerResultId ?? null,
        fields.errorCode ?? null,
        fields.errorMessage ?? null,
        fields.publishedUrl ?? null,
        fields.publishedAt ?? null,
        fields.scheduledAt ?? null,
        fields.providerMetadata ?? null,
        fields.caption ?? null,
        fields.title ?? null,
        fields.description ?? null,
        fields.hashtags ?? null,
      ]
    );
    if (!rows[0]) throw new Error("Management publication target not found.");
    return rowToTarget(rows[0]);
  }

  async setTargetUploadBundle(
    targetId: string,
    uploadBundleId: string
  ): Promise<void> {
    // COALESCE keeps a bundle link immutable once set — a retry or reconcile can
    // never re-attribute a spent token to a different bundle.
    await this.db.query(
      `UPDATE management_publication_targets
          SET upload_bundle_id = COALESCE(upload_bundle_id, $2), updated_at = NOW()
        WHERE id = $1`,
      [targetId, uploadBundleId]
    );
  }
}
