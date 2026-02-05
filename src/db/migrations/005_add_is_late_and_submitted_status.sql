-- AutoGradeX Database Schema
-- Migration 005: Add is_late column and submitted status to submissions
-- PostgreSQL 15+

-- Add is_late column to track late submissions
ALTER TABLE submissions 
ADD COLUMN IF NOT EXISTS is_late BOOLEAN DEFAULT FALSE;

-- Update submissions status CHECK constraint to include 'submitted'
ALTER TABLE submissions 
DROP CONSTRAINT IF EXISTS submissions_status_check;

ALTER TABLE submissions 
ADD CONSTRAINT submissions_status_check 
CHECK (status IN ('draft', 'pending', 'submitted', 'grading', 'graded', 'failed'));

-- Update any existing 'pending' submissions to 'submitted' (they were actual submissions)
UPDATE submissions SET status = 'submitted' WHERE status = 'pending';

-- Create index for is_late queries
CREATE INDEX IF NOT EXISTS idx_submissions_is_late ON submissions(is_late);
