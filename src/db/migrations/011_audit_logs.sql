-- Audit Logs Migration
-- audit_logs table already exists in 001_init.sql
-- This migration adds additional columns and enhancements

-- Add details column if it doesn't exist
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details JSONB;

-- Create or replace indexes for common query patterns
DROP INDEX IF EXISTS idx_audit_logs_user_id;
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);

DROP INDEX IF EXISTS idx_audit_logs_action;
CREATE INDEX idx_audit_logs_action ON audit_logs(action);

DROP INDEX IF EXISTS idx_audit_logs_resource;
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);

DROP INDEX IF EXISTS idx_audit_timestamp;
CREATE INDEX idx_audit_timestamp ON audit_logs(timestamp);

-- Comment for documentation
COMMENT ON TABLE audit_logs IS 'Immutable audit log for compliance. No UPDATE or DELETE allowed.';
COMMENT ON COLUMN audit_logs.action IS 'Action performed: GRADE_CREATED, GRADE_UPDATED, SUBMISSION_CREATED, USER_LOGIN, etc.';
COMMENT ON COLUMN audit_logs.resource_type IS 'Type of resource: grade, submission, assignment, user';
COMMENT ON COLUMN audit_logs.details IS 'JSON object with additional context (e.g., previous/new values)';

-- Create a trigger to prevent updates and deletes (immutability)
CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs are immutable. Updates and deletes are not allowed.';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_audit_update ON audit_logs;
CREATE TRIGGER prevent_audit_update
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_log_modification();
