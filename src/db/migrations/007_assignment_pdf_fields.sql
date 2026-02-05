-- ============================================
-- Migration: Add PDF support fields to assignments
-- ============================================

-- Add PDF URL fields for question and reference answer documents
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS question_pdf_url TEXT;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS reference_pdf_url TEXT;

-- Add cached extracted text fields (to avoid re-extracting on every grade)
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS question_text_extracted TEXT;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS reference_text_extracted TEXT;

-- Add indexes for PDF queries
CREATE INDEX IF NOT EXISTS idx_assignments_has_question_pdf ON assignments((question_pdf_url IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_assignments_has_reference_pdf ON assignments((reference_pdf_url IS NOT NULL));

COMMENT ON COLUMN assignments.question_pdf_url IS 'Path to uploaded PDF containing the assignment question';
COMMENT ON COLUMN assignments.reference_pdf_url IS 'Path to uploaded PDF containing the model/reference answer';
COMMENT ON COLUMN assignments.question_text_extracted IS 'Cached text extracted from question PDF';
COMMENT ON COLUMN assignments.reference_text_extracted IS 'Cached text extracted from reference PDF for AI grading';
