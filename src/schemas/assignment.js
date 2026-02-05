/**
 * JSON Schema Definitions for Assignment Validation
 * Used by Fastify's built-in AJV validation
 */

const createAssignmentSchema = {
  body: {
    type: 'object',
    required: ['title'],
    properties: {
      title: {
        type: 'string',
        minLength: 1,
        maxLength: 200,
        description: 'Assignment title'
      },
      description: {
        type: 'string',
        maxLength: 5000,
        description: 'Assignment description/instructions'
      },
      course_code: {
        type: 'string',
        maxLength: 20,
        description: 'Course code (e.g., CS101)'
      },
      course_id: {
        type: ['string', 'null'],
        format: 'uuid',
        description: 'Course UUID (alternative to course_code)'
      },
      rubric_id: {
        type: ['string', 'null'],
        format: 'uuid',
        description: 'UUID of the rubric to use for grading'
      },
      due_date: {
        type: ['string', 'null'],
        format: 'date-time',
        description: 'Due date in ISO 8601 format'
      },
      max_resubmissions: {
        type: 'integer',
        minimum: 0,
        maximum: 10,
        default: 2,
        description: 'Maximum number of resubmissions allowed'
      },
      total_points: {
        type: 'integer',
        minimum: 1,
        maximum: 1000,
        default: 100,
        description: 'Maximum points for this assignment'
      },
      status: {
        type: 'string',
        enum: ['draft', 'active', 'closed'],
        default: 'draft',
        description: 'Assignment status'
      },
      assignment_type: {
        type: 'string',
        enum: ['standard', 'quiz', 'essay', 'project'],
        default: 'standard',
        description: 'Type of assignment'
      },
      allow_late_submissions: {
        type: 'boolean',
        default: true,
        description: 'Whether to allow late submissions'
      },
      ai_grading_enabled: {
        type: 'boolean',
        default: true,
        description: 'Whether AI grading is enabled'
      },
      show_feedback_to_students: {
        type: 'boolean',
        default: true,
        description: 'Whether to show feedback to students'
      },
      require_review_before_publish: {
        type: 'boolean',
        default: false,
        description: 'Whether to require review before publishing grades'
      },
      reference_answer: {
        type: ['string', 'null'],
        maxLength: 10000,
        description: 'Reference or model answer for grading'
      }
    },
    additionalProperties: false
  }
};

const updateAssignmentSchema = {
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
      title: {
        type: 'string',
        minLength: 1,
        maxLength: 200
      },
      description: {
        type: 'string',
        maxLength: 5000
      },
      course_code: {
        type: 'string',
        maxLength: 20
      },
      rubric_id: {
        type: 'string',
        format: 'uuid'
      },
      due_date: {
        type: 'string',
        format: 'date-time'
      },
      max_resubmissions: {
        type: 'integer',
        minimum: 0,
        maximum: 10
      },
      total_points: {
        type: 'integer',
        minimum: 1,
        maximum: 1000
      },
      status: {
        type: 'string',
        enum: ['draft', 'active', 'closed']
      }
    },
    additionalProperties: false
  }
};

const getAssignmentSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' }
    }
  }
};

const listAssignmentsSchema = {
  querystring: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['draft', 'active', 'closed']
      },
      course_code: {
        type: 'string',
        maxLength: 20
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

const assignmentResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    title: { type: 'string' },
    description: { type: ['string', 'null'] },
    course_code: { type: ['string', 'null'] },
    instructor_id: { type: 'string', format: 'uuid' },
    rubric_id: { type: ['string', 'null'], format: 'uuid' },
    due_date: { type: ['string', 'null'], format: 'date-time' },
    max_resubmissions: { type: 'integer' },
    total_points: { type: 'integer' },
    status: { type: 'string', enum: ['draft', 'active', 'closed'] },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' }
  }
};

module.exports = {
  createAssignmentSchema,
  updateAssignmentSchema,
  getAssignmentSchema,
  listAssignmentsSchema,
  assignmentResponseSchema
};
