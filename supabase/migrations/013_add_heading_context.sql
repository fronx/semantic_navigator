-- Fix: Add heading_context column that was blocked by constraint change in 012
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS heading_context text[];
