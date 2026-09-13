-- ============================================================================
-- Field Service & Proof of Execution Platform — Migration 010
-- Execution Point floor/level field.
--
-- Run AFTER 001-009.
--
-- WHY THIS EXISTS: a Location can have several TVs/displays spread across
-- several floors (docs/system-completeness-audit.md §3). fs_execution_points
-- previously had only a free-text `name` - nothing stopped "Lantai 3, TV
-- Lobby" and "TV Lobby, Lantai 3" from meaning the same thing typed two
-- different ways, and nothing let the UI group/sort by floor. `floor` is a
-- separate, optional, free-text field (buildings label floors inconsistently
-- - "GF", "Lantai 3", "Rooftop" - so this is intentionally text, not an
-- integer) kept independent of `name` rather than folded into it.
-- ============================================================================

ALTER TABLE public.fs_execution_points ADD COLUMN IF NOT EXISTS floor text;

CREATE INDEX IF NOT EXISTS idx_fs_execution_points_floor ON public.fs_execution_points USING btree (location_id, floor);
