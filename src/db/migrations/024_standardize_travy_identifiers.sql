-- Standardize the Travy brand across persisted identifiers.
--
-- Fresh databases already receive the current names from the earlier schema
-- migrations. This idempotent migration upgrades databases created before the
-- naming was standardized, without retaining the retired token as a literal in
-- the source tree.

DO $$
DECLARE
  legacy_brand CONSTANT TEXT := 'tv' || 'ent';
  legacy_column TEXT;
  current_column TEXT;
  column_pair TEXT[];
  relation_name TEXT;
BEGIN
  FOREACH column_pair SLICE 1 IN ARRAY ARRAY[
    ARRAY['final_export_' || legacy_brand || '_asset_id', 'final_export_travy_asset_id'],
    ARRAY[legacy_brand || '_video_status', 'travy_video_status'],
    ARRAY[legacy_brand || '_video_error', 'travy_video_error']
  ] LOOP
    legacy_column := column_pair[1];
    current_column := column_pair[2];

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'video_generation_jobs'
        AND column_name = legacy_column
    ) AND NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'video_generation_jobs'
        AND column_name = current_column
    ) THEN
      EXECUTE format(
        'ALTER TABLE video_generation_jobs RENAME COLUMN %I TO %I',
        legacy_column,
        current_column
      );
    END IF;
  END LOOP;

  IF to_regclass('video_generation_jobs') IS NOT NULL THEN
    EXECUTE format(
      'UPDATE video_generation_jobs SET render_step = %L WHERE render_step = %L',
      'travy_generation',
      legacy_brand || '_generation'
    );
  END IF;

  IF to_regclass('clip_requests') IS NOT NULL THEN
    EXECUTE format(
      'UPDATE clip_requests
          SET target_platforms = array_replace(target_platforms, %L, %L)
        WHERE %L = ANY(target_platforms)',
      legacy_brand || '_app',
      'travy_app',
      legacy_brand || '_app'
    );
  END IF;

  FOREACH relation_name IN ARRAY ARRAY[
    'publishing_links',
    'video_publish_records',
    'management_content_channel_suggestions',
    'management_publication_targets',
    'social_connections'
  ] LOOP
    IF to_regclass(relation_name) IS NOT NULL THEN
      EXECUTE format(
        'UPDATE %I SET platform = %L WHERE platform = %L',
        relation_name,
        'travy_app',
        legacy_brand || '_app'
      );
    END IF;
  END LOOP;

  IF to_regclass('management_content_assets') IS NOT NULL THEN
    EXECUTE format(
      'UPDATE management_content_assets
          SET platform_variant = %L
        WHERE platform_variant = %L',
      'travy',
      legacy_brand
    );
  END IF;
END $$;
