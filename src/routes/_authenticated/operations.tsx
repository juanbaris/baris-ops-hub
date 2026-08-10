-- =============================================================
-- BARIS fp_movements — RESET & CORRECT BASELINE
-- Run in Supabase SQL Editor
-- Generated: 2026-08-10
--
-- What this does:
--   1. Deletes ALL fp_movements (removes wrong historical data)
--   2. Inserts correct balance-adjustment entries dated 2026-08-10
--      → FP Stock IGNORES these (uses fp_stock_baseline instead)
--      → FP Summary SHOWS these as correct August opening
--   3. Cold Chain (Illinois) stock added separately
-- =============================================================

BEGIN;

-- ── Step 1: clean slate ──────────────────────────────────────
DELETE FROM fp_movements;

-- ── Step 2: Lineage Newark opening balance (from FP Stock as of 2026-08-10) ──
INSERT INTO fp_movements
  (movement_date, type, sku, cases, warehouse, lot_number, concept, notes)
VALUES
  ('2026-08-10','In','XD',    3548,'Lineage Newark','RESET-20260810','Transfer','Stock reset – Lineage Newark balance 2026-08-10'),
  ('2026-08-10','In','PW',   10409,'Lineage Newark','RESET-20260810','Transfer','Stock reset – Lineage Newark balance 2026-08-10'),
  ('2026-08-10','In','HM',     798,'Lineage Newark','RESET-20260810','Transfer','Stock reset – Lineage Newark balance 2026-08-10'),
  ('2026-08-10','In','WD',     361,'Lineage Newark','RESET-20260810','Transfer','Stock reset – Lineage Newark balance 2026-08-10'),
  ('2026-08-10','In','Matcha',2513,'Lineage Newark','RESET-20260810','Transfer','Stock reset – Lineage Newark balance 2026-08-10');

-- WM = 0 (OOS), no entry needed.

-- ── Step 3: Cold Chain (Illinois) balance (from IL Inventory 2026-08-07, non-expired) ──
INSERT INTO fp_movements
  (movement_date, type, sku, cases, warehouse, lot_number, concept, notes)
VALUES
  ('2026-08-10','In','PW',   11,'Cold Chain','CC-RESET-20260810','Transfer','Cold Chain IL balance 2026-08-10 (lot A6156061)'),
  ('2026-08-10','In','HM',   19,'Cold Chain','CC-RESET-20260810','Transfer','Cold Chain IL balance 2026-08-10 (lots 251811+others)'),
  ('2026-08-10','In','Matcha', 2,'Cold Chain','CC-RESET-20260810','Transfer','Cold Chain IL balance 2026-08-10 (lot A6155451)');

COMMIT;

-- ── After running ──────────────────────────────────────────
-- FP Stock:    unchanged (still driven by fp_stock_baseline)
-- FP Summary:  Aug 2026 shows Opening=0, In=17,102 (resets), correct going forward
-- Cold Chain:  now visible in FP Stock → "Other Warehouses" card (PW=11, HM=19, Matcha=2)
-- ── Going forward ─────────────────────────────────────────
-- Log all new movements (production, shipments, transfers) in FP Movements tab as usual.
