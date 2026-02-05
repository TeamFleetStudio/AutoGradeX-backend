-- ============================================
-- Migration: Add Quiz Questions Support
-- ============================================

-- Assignment type field to distinguish quizzes from regular assignments
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS assignment_type VARCHAR(20) DEFAULT 'standard' 
  CHECK (assignment_type IN ('standard', 'quiz'));

-- Time limit for quizzes (in minutes)
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS time_limit_minutes INT;

-- Shuffle questions order for each student
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS shuffle_questions BOOLEAN DEFAULT FALSE;

-- Show correct answers after submission
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS show_correct_answers BOOLEAN DEFAULT TRUE;

-- ============================================
-- ASSIGNMENT_QUESTIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS assignment_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  question_order INT NOT NULL DEFAULT 1,
  question_type VARCHAR(20) NOT NULL CHECK (question_type IN ('multiple_choice', 'true_false', 'short_answer', 'essay')),
  question_text TEXT NOT NULL,
  question_image_url TEXT,
  
  -- For multiple choice / true-false: JSON array of options
  -- Format: [{"id": "a", "text": "Option A", "is_correct": false}, ...]
  options JSONB,
  
  -- For short answer: acceptable answers (AI will also evaluate)
  -- Format: ["answer1", "answer2", ...]
  correct_answers JSONB,
  
  -- For essay: reference answer for AI grading
  reference_answer TEXT,
  
  -- Points for this question
  points INT NOT NULL DEFAULT 10,
  
  -- Explanation shown after answering (optional)
  explanation TEXT,
  
  -- Partial credit allowed for short answer/essay
  allow_partial_credit BOOLEAN DEFAULT TRUE,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(assignment_id, question_order)
);

CREATE INDEX idx_assignment_questions_assignment ON assignment_questions(assignment_id);
CREATE INDEX idx_assignment_questions_type ON assignment_questions(question_type);

-- ============================================
-- SUBMISSION_ANSWERS TABLE
-- Stores individual answers to quiz questions
-- ============================================
CREATE TABLE IF NOT EXISTS submission_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES assignment_questions(id) ON DELETE CASCADE,
  
  -- Student's answer
  -- For multiple choice: selected option id (e.g., "a", "b")
  -- For true/false: "true" or "false"
  -- For short answer/essay: the text answer
  answer_text TEXT,
  
  -- For multiple choice with multiple correct answers
  selected_options JSONB,
  
  -- Grading results
  is_correct BOOLEAN,
  points_earned DECIMAL(5,2) DEFAULT 0,
  ai_feedback TEXT,
  
  -- Time spent on this question (seconds)
  time_spent_seconds INT,
  
  answered_at TIMESTAMP DEFAULT NOW(),
  graded_at TIMESTAMP,
  
  UNIQUE(submission_id, question_id)
);

CREATE INDEX idx_submission_answers_submission ON submission_answers(submission_id);
CREATE INDEX idx_submission_answers_question ON submission_answers(question_id);

-- Add quiz_started_at and quiz_submitted_at to track timing
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS quiz_started_at TIMESTAMP;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS quiz_time_remaining_seconds INT;

COMMENT ON TABLE assignment_questions IS 'Individual questions for quiz-type assignments';
COMMENT ON TABLE submission_answers IS 'Student answers to individual quiz questions';
COMMENT ON COLUMN assignments.assignment_type IS 'standard for regular assignments, quiz for multi-question quizzes';
COMMENT ON COLUMN assignment_questions.options IS 'JSON array of options for multiple choice questions';
COMMENT ON COLUMN assignment_questions.correct_answers IS 'JSON array of acceptable answers for short answer questions';
