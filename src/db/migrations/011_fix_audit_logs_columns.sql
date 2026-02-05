-- Fix audit_logs table to have all required columns
-- This migration handles both schema versions (001_init.sql and 009_audit_logs.sql)

-- Add old_value column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'audit_logs' AND column_name = 'old_value'
  ) THEN
    ALTER TABLE audit_logs ADD COLUMN old_value JSONB;
  END IF;
END $$;

-- Add new_value column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'audit_logs' AND column_name = 'new_value'
  ) THEN
    ALTER TABLE audit_logs ADD COLUMN new_value JSONB;
  END IF;
END $$;

-- Add timestamp column if it doesn't exist (some schemas use created_at instead)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'audit_logs' AND column_name = 'timestamp'
  ) THEN
    -- If created_at exists, rename it to timestamp
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'audit_logs' AND column_name = 'created_at'
    ) THEN
      ALTER TABLE audit_logs RENAME COLUMN created_at TO timestamp;
    ELSE
      ALTER TABLE audit_logs ADD COLUMN timestamp TIMESTAMP DEFAULT NOW();
    END IF;
  END IF;
END $$;

-- Add details column if it doesn't exist (for backward compatibility)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'audit_logs' AND column_name = 'details'
  ) THEN
    ALTER TABLE audit_logs ADD COLUMN details JSONB;
  END IF;
END $$;

-- Ensure indexes exist
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
