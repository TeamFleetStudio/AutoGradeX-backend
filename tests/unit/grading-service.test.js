/**
 * Unit Tests for Grading Service
 */

const gradingService = require('../../src/services/grading-service');
const openaiService = require('../../src/services/openai-service');

// Mock OpenAI service
jest.mock('../../src/services/openai-service');

describe('Grading Service', () => {
  let mockDb;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock database
    mockDb = {
      query: jest.fn(),
      getClient: jest.fn()
    };
  });

  describe('validateSubmission', () => {
    it('should throw error for empty content', () => {
      expect(() => gradingService.validateSubmission('')).toThrow('Submission content cannot be empty');
    });

    it('should throw error for whitespace-only content', () => {
      expect(() => gradingService.validateSubmission('   \n\t  ')).toThrow('Submission content cannot be empty');
    });

    it('should accept valid content', () => {
      expect(() => gradingService.validateSubmission('This is valid content.')).not.toThrow();
    });
  });

  describe('calculateTotalScore', () => {
    it('should sum rubric scores correctly', () => {
      const rubricScores = {
        thesis: { points: 20 },
        evidence: { points: 25 },
        organization: { points: 18 }
      };

      const total = gradingService.calculateTotalScore(rubricScores);
      expect(total).toBe(63);
    });

    it('should return 0 for empty rubric scores', () => {
      expect(gradingService.calculateTotalScore({})).toBe(0);
    });

    it('should handle missing points property', () => {
      const rubricScores = {
        thesis: { feedback: 'good' },
        evidence: { points: 20 }
      };

      const total = gradingService.calculateTotalScore(rubricScores);
      expect(total).toBe(20);
    });
  });

  describe('gradeSubmissionById', () => {
    const mockSubmission = global.testUtils.mockSubmission();
    const mockAssignment = global.testUtils.mockAssignment();
    const mockRubric = global.testUtils.mockRubric();

    beforeEach(() => {
      const mockClient = {
        query: jest.fn(),
        release: jest.fn()
      };

      mockDb.getClient.mockResolvedValue(mockClient);

      // Mock submission query
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [mockSubmission] }) // Get submission
        .mockResolvedValueOnce({ rows: [mockAssignment] }) // Get assignment
        .mockResolvedValueOnce({ rows: [mockRubric] }) // Get rubric
        .mockResolvedValueOnce({ rows: [] }) // Update status to grading
        .mockResolvedValueOnce({ rows: [{ id: 'grade-id' }] }) // Insert grade
        .mockResolvedValueOnce({ rows: [] }) // Update status to graded
        .mockResolvedValueOnce({ rows: [] }); // COMMIT
    });

    it('should throw error if submission not found', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [] }), // No submission found
        release: jest.fn()
      };
      mockDb.getClient.mockResolvedValue(mockClient);

      await expect(gradingService.gradeSubmissionById(mockDb, 'non-existent-id'))
        .rejects.toThrow('Submission not found');
    });

    it('should call OpenAI service for grading', async () => {
      const mockGradeResult = {
        score: 85,
        feedback: 'Good work',
        rubric_scores: {
          thesis: { points: 22, feedback: 'Clear' }
        }
      };

      openaiService.gradeSubmission.mockResolvedValue(mockGradeResult);

      // Note: This test would need more complete mocking to work properly
      // This is a template for the actual implementation
    });
  });

  describe('getAssignmentStats', () => {
    it('should calculate correct statistics', async () => {
      mockDb.query.mockResolvedValue({
        rows: [
          { score: 85 },
          { score: 90 },
          { score: 75 },
          { score: 80 },
          { score: 95 }
        ]
      });

      const stats = await gradingService.getAssignmentStats(mockDb, 'assignment-id');

      expect(stats.count).toBe(5);
      expect(stats.average).toBe(85);
      expect(stats.min).toBe(75);
      expect(stats.max).toBe(95);
    });

    it('should handle empty results', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      const stats = await gradingService.getAssignmentStats(mockDb, 'assignment-id');

      expect(stats.count).toBe(0);
      expect(stats.average).toBe(0);
    });
  });
});
