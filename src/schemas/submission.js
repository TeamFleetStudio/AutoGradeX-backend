/**
 * JSON Schema Definitions for Submission Validation
 * Used by Fastify's built-in AJV validation
 */

const createSubmissionSchema = {
  body: {
    type: 'object',
    required: ['assignment_id'],
    properties: {
      assignment_id: {
        type: 'string',
        format: 'uuid',
        description: 'UUID of the assignment being submitted to'
      },
      content: {
        type: 'string',
        minLength: 1,
        maxLength: 50000,
        description: 'Text content of the submission'
      },
      image_url: {
        type: 'string',
        description: 'URL or base64 string of handwritten submission image'
      },
      submission_type: {
        type: 'string',
        enum: ['text', 'handwritten'],
        default: 'text',
        description: 'Type of submission: text or handwritten (image-based)'
      },
      status: {
        type: 'string',
        enum: ['draft', 'submitted'],
        default: 'submitted',
        description: 'Submission status (draft or submitted)'
      },
      version: {
        type: 'integer',
        minimum: 1,
        maximum: 10,
        default: 1,
        description: 'Submission version (for resubmissions)'
      },
      pdf_url: {
        type: 'string',
        description: 'Legacy: URL of PDF file'
      },
      file_name: {
        type: 'string',
        description: 'Name of uploaded file'
      }
    },
    additionalProperties: false
  }
};

const getSubmissionSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: {
        type: 'string',
        format: 'uuid'
      }
    }
  }
};

const listSubmissionsSchema = {
  querystring: {
    type: 'object',
    properties: {
      assignment_id: {
        type: 'string',
        format: 'uuid'
      },
      status: {
        type: 'string',
        enum: ['pending', 'grading', 'graded', 'failed']
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

const submissionResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    student_id: { type: 'string', format: 'uuid' },
    assignment_id: { type: 'string', format: 'uuid' },
    content: { type: 'string' },
    pdf_url: { type: ['string', 'null'] },
    version: { type: 'integer' },
    status: { type: 'string', enum: ['pending', 'grading', 'graded', 'failed'] },
    submitted_at: { type: 'string', format: 'date-time' }
  }
};

module.exports = {
  createSubmissionSchema,
  getSubmissionSchema,
  listSubmissionsSchema,
  submissionResponseSchema
};
