/**
 * Input Validation Utilities
 * Provides validation and sanitization functions for API inputs
 * @module services/validation
 */

const logger = require('./logger');

/**
 * Common validation patterns
 */
const PATTERNS = {
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  SAFE_STRING: /^[\w\s\-.,!?'"():;@#$%&*+=\[\]{}|\\/<>~`^]+$/,
};

/**
 * Validation error class
 */
class ValidationError extends Error {
  constructor(message, field, code = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.code = code;
    this.statusCode = 400;
  }
}

/**
 * Validate UUID format
 * @param {string} value - Value to validate
 * @param {string} fieldName - Field name for error message
 * @returns {string} Valid UUID
 * @throws {ValidationError} If invalid
 */
function validateUUID(value, fieldName = 'id') {
  if (!value || typeof value !== 'string') {
    throw new ValidationError(`${fieldName} is required`, fieldName, 'MISSING_FIELD');
  }
  
  if (!PATTERNS.UUID.test(value)) {
    throw new ValidationError(`${fieldName} must be a valid UUID`, fieldName, 'INVALID_UUID');
  }
  
  return value.toLowerCase();
}

/**
 * Validate email format
 * @param {string} value - Value to validate
 * @param {string} fieldName - Field name for error message
 * @returns {string} Valid email (lowercase, trimmed)
 * @throws {ValidationError} If invalid
 */
function validateEmail(value, fieldName = 'email') {
  if (!value || typeof value !== 'string') {
    throw new ValidationError(`${fieldName} is required`, fieldName, 'MISSING_FIELD');
  }
  
  const trimmed = value.trim().toLowerCase();
  
  if (!PATTERNS.EMAIL.test(trimmed)) {
    throw new ValidationError(`${fieldName} must be a valid email address`, fieldName, 'INVALID_EMAIL');
  }
  
  if (trimmed.length > 255) {
    throw new ValidationError(`${fieldName} is too long (max 255 characters)`, fieldName, 'FIELD_TOO_LONG');
  }
  
  return trimmed;
}

/**
 * Validate and sanitize a required string
 * @param {string} value - Value to validate
 * @param {string} fieldName - Field name for error message
 * @param {Object} options - Validation options
 * @param {number} [options.minLength=1] - Minimum length
 * @param {number} [options.maxLength=10000] - Maximum length
 * @param {boolean} [options.trim=true] - Whether to trim whitespace
 * @returns {string} Sanitized string
 * @throws {ValidationError} If invalid
 */
function validateString(value, fieldName, options = {}) {
  const { minLength = 1, maxLength = 10000, trim = true } = options;
  
  if (value === undefined || value === null) {
    throw new ValidationError(`${fieldName} is required`, fieldName, 'MISSING_FIELD');
  }
  
  if (typeof value !== 'string') {
    throw new ValidationError(`${fieldName} must be a string`, fieldName, 'INVALID_TYPE');
  }
  
  let sanitized = trim ? value.trim() : value;
  
  if (sanitized.length < minLength) {
    throw new ValidationError(
      `${fieldName} must be at least ${minLength} characters`,
      fieldName,
      'FIELD_TOO_SHORT'
    );
  }
  
  if (sanitized.length > maxLength) {
    throw new ValidationError(
      `${fieldName} must be at most ${maxLength} characters`,
      fieldName,
      'FIELD_TOO_LONG'
    );
  }
  
  return sanitized;
}

/**
 * Validate optional string (allows null/undefined)
 * @param {string|null|undefined} value - Value to validate
 * @param {string} fieldName - Field name for error message
 * @param {Object} options - Validation options
 * @returns {string|null} Sanitized string or null
 */
function validateOptionalString(value, fieldName, options = {}) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return validateString(value, fieldName, options);
}

/**
 * Validate a number within range
 * @param {number|string} value - Value to validate
 * @param {string} fieldName - Field name for error message
 * @param {Object} options - Validation options
 * @param {number} [options.min] - Minimum value
 * @param {number} [options.max] - Maximum value
 * @param {boolean} [options.integer=false] - Must be integer
 * @returns {number} Validated number
 * @throws {ValidationError} If invalid
 */
function validateNumber(value, fieldName, options = {}) {
  const { min, max, integer = false } = options;
  
  if (value === undefined || value === null || value === '') {
    throw new ValidationError(`${fieldName} is required`, fieldName, 'MISSING_FIELD');
  }
  
  const num = Number(value);
  
  if (isNaN(num)) {
    throw new ValidationError(`${fieldName} must be a valid number`, fieldName, 'INVALID_NUMBER');
  }
  
  if (integer && !Number.isInteger(num)) {
    throw new ValidationError(`${fieldName} must be an integer`, fieldName, 'INVALID_INTEGER');
  }
  
  if (min !== undefined && num < min) {
    throw new ValidationError(`${fieldName} must be at least ${min}`, fieldName, 'VALUE_TOO_SMALL');
  }
  
  if (max !== undefined && num > max) {
    throw new ValidationError(`${fieldName} must be at most ${max}`, fieldName, 'VALUE_TOO_LARGE');
  }
  
  return num;
}

/**
 * Validate array
 * @param {Array} value - Value to validate
 * @param {string} fieldName - Field name for error message
 * @param {Object} options - Validation options
 * @param {number} [options.minLength=0] - Minimum array length
 * @param {number} [options.maxLength=1000] - Maximum array length
 * @returns {Array} Validated array
 * @throws {ValidationError} If invalid
 */
function validateArray(value, fieldName, options = {}) {
  const { minLength = 0, maxLength = 1000 } = options;
  
  if (!Array.isArray(value)) {
    throw new ValidationError(`${fieldName} must be an array`, fieldName, 'INVALID_TYPE');
  }
  
  if (value.length < minLength) {
    throw new ValidationError(
      `${fieldName} must have at least ${minLength} items`,
      fieldName,
      'ARRAY_TOO_SHORT'
    );
  }
  
  if (value.length > maxLength) {
    throw new ValidationError(
      `${fieldName} must have at most ${maxLength} items`,
      fieldName,
      'ARRAY_TOO_LONG'
    );
  }
  
  return value;
}

/**
 * Validate enum value
 * @param {string} value - Value to validate
 * @param {string} fieldName - Field name for error message
 * @param {Array<string>} allowedValues - Allowed values
 * @returns {string} Validated value
 * @throws {ValidationError} If invalid
 */
function validateEnum(value, fieldName, allowedValues) {
  if (!value || typeof value !== 'string') {
    throw new ValidationError(`${fieldName} is required`, fieldName, 'MISSING_FIELD');
  }
  
  const normalized = value.toLowerCase().trim();
  
  if (!allowedValues.includes(normalized)) {
    throw new ValidationError(
      `${fieldName} must be one of: ${allowedValues.join(', ')}`,
      fieldName,
      'INVALID_ENUM'
    );
  }
  
  return normalized;
}

/**
 * Sanitize HTML/script tags from string (XSS prevention)
 * @param {string} value - Value to sanitize
 * @returns {string} Sanitized string
 */
function sanitizeHtml(value) {
  if (typeof value !== 'string') return value;
  
  return value
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Validate file upload
 * @param {Object} file - Multipart file object
 * @param {Object} options - Validation options
 * @param {number} [options.maxSize=10485760] - Max file size in bytes (default 10MB)
 * @param {Array<string>} [options.allowedTypes] - Allowed MIME types
 * @returns {Object} Validated file object
 * @throws {ValidationError} If invalid
 */
function validateFile(file, options = {}) {
  const { maxSize = 10 * 1024 * 1024, allowedTypes } = options;
  
  if (!file) {
    throw new ValidationError('File is required', 'file', 'MISSING_FILE');
  }
  
  if (file.size && file.size > maxSize) {
    const maxMB = Math.round(maxSize / (1024 * 1024));
    throw new ValidationError(
      `File size must be less than ${maxMB}MB`,
      'file',
      'FILE_TOO_LARGE'
    );
  }
  
  if (allowedTypes && file.mimetype && !allowedTypes.includes(file.mimetype)) {
    throw new ValidationError(
      `File type must be one of: ${allowedTypes.join(', ')}`,
      'file',
      'INVALID_FILE_TYPE'
    );
  }
  
  return file;
}

/**
 * Create a validation middleware for request body
 * @param {Object} schema - Validation schema
 * @returns {Function} Fastify preHandler hook
 */
function createBodyValidator(schema) {
  return async (request, reply) => {
    try {
      const validated = {};
      
      for (const [field, validator] of Object.entries(schema)) {
        validated[field] = validator(request.body[field], field);
      }
      
      request.validatedBody = validated;
    } catch (error) {
      if (error instanceof ValidationError) {
        return reply.status(400).send({
          success: false,
          error: error.message,
          code: error.code,
          field: error.field,
        });
      }
      throw error;
    }
  };
}

module.exports = {
  ValidationError,
  validateUUID,
  validateEmail,
  validateString,
  validateOptionalString,
  validateNumber,
  validateArray,
  validateEnum,
  sanitizeHtml,
  validateFile,
  createBodyValidator,
  PATTERNS,
};
