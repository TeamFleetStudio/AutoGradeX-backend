-- AutoGradeX Database Schema
-- Migration 003: Add draft status to submissions
-- PostgreSQL 15+

-- Update submissions status CHECK constraint to include 'draft'
ALTER TABLE submissions 
DROP CONSTRAINT IF EXISTS submissions_status_check;

ALTER TABLE submissions 
ADD CONSTRAINT submissions_status_check 
CHECK (status IN ('draft', 'pending', 'grading', 'graded', 'failed'));
