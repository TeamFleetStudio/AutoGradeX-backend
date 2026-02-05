-- AutoGradeX Database Schema
-- Migration 002: Courses and Enrollments
-- PostgreSQL 15+

-- ============================================
-- COURSES TABLE
-- ============================================
CREATE TABLE courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(20) NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  instructor_id UUID NOT NULL REFERENCES users(id),
  term VARCHAR(20), -- e.g., 'Fall 2025', 'Spring 2026'
  year INT,
  enrollment_code VARCHAR(10) UNIQUE, -- Code students use to enroll
  allow_self_enrollment BOOLEAN DEFAULT TRUE,
  max_students INT DEFAULT 500,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_courses_instructor ON courses(instructor_id);
CREATE INDEX idx_courses_code ON courses(code);
CREATE INDEX idx_courses_enrollment_code ON courses(enrollment_code);
CREATE INDEX idx_courses_status ON courses(status);
CREATE INDEX idx_courses_term_year ON courses(term, year);

-- ============================================
-- COURSE ENROLLMENTS TABLE
-- ============================================
CREATE TABLE course_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('pending', 'active', 'dropped', 'completed')),
  enrolled_at TIMESTAMP DEFAULT NOW(),
  dropped_at TIMESTAMP,
  
  UNIQUE(course_id, student_id)
);

CREATE INDEX idx_enrollments_course ON course_enrollments(course_id);
CREATE INDEX idx_enrollments_student ON course_enrollments(student_id);
CREATE INDEX idx_enrollments_status ON course_enrollments(status);

-- ============================================
-- UPDATE ASSIGNMENTS TABLE
-- Add foreign key to courses
-- ============================================
ALTER TABLE assignments ADD COLUMN course_id UUID REFERENCES courses(id);
CREATE INDEX idx_assignments_course_id ON assignments(course_id);

-- ============================================
-- APPLY UPDATED_AT TRIGGER TO COURSES
-- ============================================
CREATE TRIGGER update_courses_updated_at
BEFORE UPDATE ON courses
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- HELPER FUNCTION: Generate enrollment code
-- ============================================
CREATE OR REPLACE FUNCTION generate_enrollment_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT := '';
  i INT;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- VIEW: Student's enrolled courses with assignment counts
-- ============================================
CREATE OR REPLACE VIEW student_courses_view AS
SELECT 
  ce.student_id,
  c.id as course_id,
  c.code as course_code,
  c.name as course_name,
  c.description,
  c.term,
  c.year,
  u.name as instructor_name,
  ce.enrolled_at,
  ce.status as enrollment_status,
  (SELECT COUNT(*) FROM assignments a WHERE a.course_id = c.id AND a.status = 'active') as active_assignments,
  (SELECT COUNT(*) FROM assignments a WHERE a.course_id = c.id) as total_assignments
FROM course_enrollments ce
JOIN courses c ON ce.course_id = c.id
JOIN users u ON c.instructor_id = u.id;

-- ============================================
-- VIEW: Course roster with student stats
-- ============================================
CREATE OR REPLACE VIEW course_roster_view AS
SELECT 
  ce.course_id,
  s.id as student_id,
  s.user_id,
  s.name as student_name,
  s.student_number,
  u.email,
  ce.status as enrollment_status,
  ce.enrolled_at,
  (
    SELECT COUNT(*) 
    FROM submissions sub 
    JOIN assignments a ON sub.assignment_id = a.id 
    WHERE sub.student_id = s.id AND a.course_id = ce.course_id
  ) as submissions_count,
  (
    SELECT AVG(g.score) 
    FROM grades g 
    JOIN submissions sub ON g.submission_id = sub.id 
    JOIN assignments a ON sub.assignment_id = a.id 
    WHERE sub.student_id = s.id AND a.course_id = ce.course_id
  ) as avg_score
FROM course_enrollments ce
JOIN students s ON ce.student_id = s.id
JOIN users u ON s.user_id = u.id;
