/**
 * Test Setup and Utilities
 */

// Load environment variables for tests
require('dotenv').config({ path: '.env.test' });

// Set test environment
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-testing-only';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://postgres:password@localhost:5432/autogradex_test';

// Global test utilities
global.testUtils = {
  /**
   * Generate a mock user object
   */
  mockUser: (overrides = {}) => ({
    id: 'test-user-id-' + Math.random().toString(36).slice(2),
    email: `test${Math.random().toString(36).slice(2)}@example.com`,
    name: 'Test User',
    role: 'instructor',
    ...overrides
  }),

  /**
   * Generate a mock submission
   */
  mockSubmission: (overrides = {}) => ({
    id: 'test-submission-id-' + Math.random().toString(36).slice(2),
    student_id: 'test-student-id',
    assignment_id: 'test-assignment-id',
    content: 'This is a test submission content.',
    version: 1,
    status: 'pending',
    submitted_at: new Date().toISOString(),
    ...overrides
  }),

  /**
   * Generate a mock rubric
   */
  mockRubric: (overrides = {}) => ({
    id: 'test-rubric-id-' + Math.random().toString(36).slice(2),
    name: 'Test Rubric',
    description: 'A test rubric for unit testing',
    type: 'essay',
    criteria: {
      thesis: { max_points: 25, description: 'Clear thesis statement' },
      evidence: { max_points: 25, description: 'Supporting evidence' },
      organization: { max_points: 25, description: 'Logical organization' },
      grammar: { max_points: 25, description: 'Grammar and mechanics' }
    },
    total_points: 100,
    is_template: false,
    ...overrides
  }),

  /**
   * Generate a mock assignment
   */
  mockAssignment: (overrides = {}) => ({
    id: 'test-assignment-id-' + Math.random().toString(36).slice(2),
    title: 'Test Assignment',
    description: 'A test assignment for unit testing',
    course_code: 'TEST101',
    instructor_id: 'test-instructor-id',
    rubric_id: 'test-rubric-id',
    due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    max_resubmissions: 2,
    total_points: 100,
    status: 'active',
    ...overrides
  }),

  /**
   * Generate a mock grade
   */
  mockGrade: (overrides = {}) => ({
    id: 'test-grade-id-' + Math.random().toString(36).slice(2),
    submission_id: 'test-submission-id',
    score: 85,
    feedback: 'Good work overall.',
    rubric_scores: {
      thesis: { points: 22, feedback: 'Clear thesis' },
      evidence: { points: 20, feedback: 'Good evidence' },
      organization: { points: 23, feedback: 'Well organized' },
      grammar: { points: 20, feedback: 'Minor errors' }
    },
    graded_at: new Date().toISOString(),
    graded_by: null,
    ...overrides
  })
};

// Clean up after all tests
afterAll(async () => {
  // Any global cleanup
});
