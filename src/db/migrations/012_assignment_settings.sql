-- AutoGradeX Database Schema
-- Migration 010: Assignment Settings Toggles
-- Adds columns for assignment grading and submission settings

-- Add settings columns to assignments table
ALTER TABLE assignments 
ADD COLUMN IF NOT EXISTS allow_late_submissions BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS ai_grading_enabled BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS show_feedback_to_students BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS require_review_before_publish BOOLEAN DEFAULT FALSE;

-- Add index for commonly queried settings
CREATE INDEX IF NOT EXISTS idx_assignments_ai_grading ON assignments(ai_grading_enabled);
CREATE INDEX IF NOT EXISTS idx_assignments_require_review ON assignments(require_review_before_publish);

-- Add comment for documentation
COMMENT ON COLUMN assignments.allow_late_submissions IS 'Allow students to submit after due date';
COMMENT ON COLUMN assignments.ai_grading_enabled IS 'Enable automatic AI grading for submissions';
COMMENT ON COLUMN assignments.show_feedback_to_students IS 'Show AI-generated feedback to students';
COMMENT ON COLUMN assignments.require_review_before_publish IS 'Require instructor review before grades are visible';
