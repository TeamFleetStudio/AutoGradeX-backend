/**
 * JSON Schema Definitions for Rubric Validation
 * Used by Fastify's built-in AJV validation
 */

const criterionSchema = {
  type: 'object',
  required: ['max_points', 'description'],
  properties: {
    max_points: {
      type: 'integer',
      minimum: 0,
      maximum: 100
    },
    description: {
      type: 'string',
      minLength: 1,
      maxLength: 500
    }
  },
  additionalProperties: false
};

const createRubricSchema = {
  body: {
    type: 'object',
    required: ['name', 'criteria', 'total_points'],
    properties: {
      name: {
        type: 'string',
        minLength: 1,
        maxLength: 200,
        description: 'Name of the rubric'
      },
      description: {
        type: 'string',
        maxLength: 1000,
        description: 'Optional description of the rubric'
      },
      type: {
        type: 'string',
        enum: ['essay', 'coding', 'quiz', 'lab', 'other'],
        description: 'Type of assignment this rubric is for'
      },
      criteria: {
        type: 'object',
        minProperties: 1,
        maxProperties: 20,
        additionalProperties: criterionSchema,
        description: 'Grading criteria as key-value pairs'
      },
      total_points: {
        type: 'integer',
        minimum: 1,
        maximum: 1000,
        description: 'Maximum total points for this rubric'
      },
      is_template: {
        type: 'boolean',
        default: false,
        description: 'Whether this rubric is a reusable template'
      }
    },
    additionalProperties: false
  }
};

const updateRubricSchema = {
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
      name: {
        type: 'string',
        minLength: 1,
        maxLength: 200
      },
      description: {
        type: 'string',
        maxLength: 1000
      },
      type: {
        type: 'string',
        enum: ['essay', 'coding', 'quiz', 'lab', 'other']
      },
      criteria: {
        type: 'object',
        minProperties: 1,
        maxProperties: 20,
        additionalProperties: criterionSchema
      },
      total_points: {
        type: 'integer',
        minimum: 1,
        maximum: 1000
      },
      is_template: {
        type: 'boolean'
      }
    },
    additionalProperties: false
  }
};

const getRubricSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' }
    }
  }
};

const listRubricsSchema = {
  querystring: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['essay', 'coding', 'quiz', 'lab', 'other']
      },
      is_template: {
        type: 'boolean'
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

const rubricResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    description: { type: ['string', 'null'] },
    type: { type: ['string', 'null'] },
    criteria: { type: 'object' },
    total_points: { type: 'integer' },
    is_template: { type: 'boolean' },
    created_by: { type: ['string', 'null'], format: 'uuid' },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' }
  }
};

module.exports = {
  criterionSchema,
  createRubricSchema,
  updateRubricSchema,
  getRubricSchema,
  listRubricsSchema,
  rubricResponseSchema
};
