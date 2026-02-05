/**
 * JSON Schema Definitions for Grade Validation
 * Used by Fastify's built-in AJV validation
 */

const rubricScoreSchema = {
  type: 'object',
  properties: {
    points: {
      type: 'number',
      minimum: 0
    },
    feedback: {
      type: 'string',
      maxLength: 1000
    }
  },
  required: ['points']
};

const getGradeSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' }
    }
  }
};

const getGradeBySubmissionSchema = {
  params: {
    type: 'object',
    required: ['submissionId'],
    properties: {
      submissionId: { type: 'string', format: 'uuid' }
    }
  }
};

const updateGradeSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' }
    }
  },
  body: {
    type: 'object',
    properties: {
      score: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
        description: 'Overridden score (0-100)'
      },
      feedback: {
        type: 'string',
        maxLength: 5000,
        description: 'Instructor feedback'
      },
      rubric_scores: {
        type: 'object',
        additionalProperties: rubricScoreSchema,
        description: 'Per-criterion scores and feedback'
      }
    },
    additionalProperties: false
  }
};

const listGradesSchema = {
  querystring: {
    type: 'object',
    properties: {
      assignment_id: {
        type: 'string',
        format: 'uuid'
      },
      student_id: {
        type: 'string',
        format: 'uuid'
      },
      min_score: {
        type: 'integer',
        minimum: 0,
        maximum: 100
      },
      max_score: {
        type: 'integer',
        minimum: 0,
        maximum: 100
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        default: 20
      },
      offset: {
        type: 'integer',
        minimum: 0,
        default: 0
      }
    }
  }
};

const gradeResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    submission_id: { type: 'string', format: 'uuid' },
    score: { type: 'integer' },
    feedback: { type: ['string', 'null'] },
    rubric_scores: { type: ['object', 'null'] },
    graded_at: { type: 'string', format: 'date-time' },
    graded_by: { type: ['string', 'null'], format: 'uuid' }
  }
};

const batchGradeSchema = {
  body: {
    type: 'object',
    required: ['assignment_id'],
    properties: {
      assignment_id: {
        type: 'string',
        format: 'uuid',
        description: 'Assignment to grade all pending submissions for'
      },
      force: {
        type: 'boolean',
        default: false,
        description: 'Re-grade already graded submissions'
      }
    },
    additionalProperties: false
  }
};

module.exports = {
  rubricScoreSchema,
  getGradeSchema,
  getGradeBySubmissionSchema,
  updateGradeSchema,
  listGradesSchema,
  gradeResponseSchema,
  batchGradeSchema
};
