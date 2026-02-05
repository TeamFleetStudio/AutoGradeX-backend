-- AutoGradeX Database Schema
-- Migration 002: Add reference_answer column to assignments
-- PostgreSQL 15+

-- Add reference_answer column to store model answers (hidden from students)
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS reference_answer TEXT;

-- Add course_id column to link assignments to courses properly
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS course_id UUID REFERENCES courses(id);

-- Create index for course_id
CREATE INDEX IF NOT EXISTS idx_assignments_course_id ON assignments(course_id);
