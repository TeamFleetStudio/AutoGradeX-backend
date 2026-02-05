-- AutoGradeX Database Schema
-- Migration 004: Add file_name column to submissions
-- PostgreSQL 15+

-- Add file_name column to store original uploaded file name
ALTER TABLE submissions 
ADD COLUMN IF NOT EXISTS file_name TEXT;

-- Add index for file-based queries
CREATE INDEX IF NOT EXISTS idx_submissions_file_name ON submissions(file_name);
