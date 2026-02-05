-- AutoGradeX Database Schema
-- Migration 001: Initial Tables
-- PostgreSQL 15+

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'instructor', 'student', 'ta')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- ============================================
-- STUDENTS TABLE
-- ============================================
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  student_number TEXT,
  section TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_students_user_id ON students(user_id);
CREATE INDEX idx_students_section ON students(section);

-- ============================================
-- RUBRICS TABLE
-- ============================================
CREATE TABLE rubrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  type VARCHAR(50), -- essay, coding, quiz, lab, other
  criteria JSONB NOT NULL,
  total_points INT NOT NULL,
  is_template BOOLEAN DEFAULT FALSE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_rubrics_created_by ON rubrics(created_by);
CREATE INDEX idx_rubrics_type ON rubrics(type);
CREATE INDEX idx_rubrics_is_template ON rubrics(is_template);

-- ============================================
-- ASSIGNMENTS TABLE
-- ============================================
CREATE TABLE assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  course_code VARCHAR(20),
  instructor_id UUID NOT NULL REFERENCES users(id),
  rubric_id UUID REFERENCES rubrics(id),
  due_date TIMESTAMP,
  max_resubmissions INT DEFAULT 2,
  total_points INT DEFAULT 100,
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_assignments_instructor ON assignments(instructor_id);
CREATE INDEX idx_assignments_status ON assignments(status);
CREATE INDEX idx_assignments_course ON assignments(course_code);
CREATE INDEX idx_assignments_due_date ON assignments(due_date);

-- ============================================
-- SUBMISSIONS TABLE
-- ============================================
CREATE TABLE submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  content TEXT,
  pdf_url TEXT,
  version INT DEFAULT 1,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'grading', 'graded', 'failed')),
  submitted_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(student_id, assignment_id, version)
);

CREATE INDEX idx_submissions_student ON submissions(student_id);
CREATE INDEX idx_submissions_assignment ON submissions(assignment_id);
CREATE INDEX idx_submissions_status ON submissions(status);
CREATE INDEX idx_submissions_submitted_at ON submissions(submitted_at);

-- ============================================
-- GRADES TABLE
-- ============================================
CREATE TABLE grades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  score INT NOT NULL CHECK (score >= 0 AND score <= 100),
  feedback TEXT,
  rubric_scores JSONB,
  ai_response JSONB, -- Store raw AI response for debugging
  graded_at TIMESTAMP DEFAULT NOW(),
  graded_by UUID REFERENCES users(id), -- NULL = AI, set = human override
  
  UNIQUE(submission_id)
);

CREATE INDEX idx_grades_submission ON grades(submission_id);
CREATE INDEX idx_grades_graded_at ON grades(graded_at);
CREATE INDEX idx_grades_score ON grades(score);

-- ============================================
-- AUDIT LOGS TABLE (Immutable)
-- ============================================
CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  action VARCHAR(50) NOT NULL,
  resource_type VARCHAR(50) NOT NULL,
  resource_id UUID,
  old_value JSONB,
  new_value JSONB,
  ip_address INET,
  user_agent TEXT,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_timestamp ON audit_logs(timestamp);
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_action ON audit_logs(action);

-- Prevent UPDATE/DELETE on audit_logs (immutability)
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs are immutable - modifications not allowed';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_immutable
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

-- ============================================
-- FILE UPLOADS TABLE
-- ============================================
CREATE TABLE file_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  filename TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type VARCHAR(100),
  size_bytes BIGINT,
  storage_path TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_file_uploads_user ON file_uploads(user_id);

-- ============================================
-- UPDATED_AT TRIGGER FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to relevant tables
CREATE TRIGGER update_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rubrics_updated_at
BEFORE UPDATE ON rubrics
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_assignments_updated_at
BEFORE UPDATE ON assignments
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- SEED DATA: Default Rubric Templates
-- ============================================
INSERT INTO rubrics (id, name, description, type, criteria, total_points, is_template, created_by) VALUES
(
  gen_random_uuid(),
  'Standard Essay Rubric',
  'Comprehensive rubric for evaluating essay submissions with focus on thesis, evidence, and writing quality.',
  'essay',
  '{
    "thesis_clarity": {"max_points": 20, "description": "Clear, arguable thesis statement that addresses the prompt"},
    "evidence_quality": {"max_points": 25, "description": "Strong, relevant evidence supporting the thesis with proper citations"},
    "organization": {"max_points": 20, "description": "Logical structure with clear introduction, body paragraphs, and conclusion"},
    "analysis": {"max_points": 20, "description": "Deep analysis that connects evidence to thesis and shows critical thinking"},
    "grammar_style": {"max_points": 15, "description": "Clear writing with minimal grammatical errors and appropriate academic tone"}
  }',
  100,
  true,
  NULL
),
(
  gen_random_uuid(),
  'Code Review Rubric',
  'Evaluates code quality, functionality, documentation, and best practices adherence.',
  'coding',
  '{
    "functionality": {"max_points": 30, "description": "Code works correctly and meets all requirements"},
    "code_quality": {"max_points": 25, "description": "Clean, readable code following style guidelines and best practices"},
    "documentation": {"max_points": 20, "description": "Clear comments, docstrings, and README documentation"},
    "testing": {"max_points": 25, "description": "Comprehensive tests covering edge cases and main functionality"}
  }',
  100,
  true,
  NULL
),
(
  gen_random_uuid(),
  'Lab Report Rubric',
  'Scientific lab report evaluation covering hypothesis, methodology, results, and conclusions.',
  'lab',
  '{
    "introduction": {"max_points": 15, "description": "Clear background, purpose, and hypothesis"},
    "methodology": {"max_points": 20, "description": "Detailed, reproducible procedure with appropriate controls"},
    "results": {"max_points": 25, "description": "Accurate data presentation with appropriate figures and tables"},
    "analysis": {"max_points": 25, "description": "Thorough analysis connecting results to hypothesis"},
    "conclusion": {"max_points": 15, "description": "Summary of findings with implications and future directions"}
  }',
  100,
  true,
  NULL
),
(
  gen_random_uuid(),
  'Short Answer Rubric',
  'Simple rubric for short answer or quiz questions.',
  'quiz',
  '{
    "accuracy": {"max_points": 70, "description": "Factually correct and complete answer"},
    "explanation": {"max_points": 30, "description": "Clear reasoning or supporting details"}
  }',
  100,
  true,
  NULL
);
