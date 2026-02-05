/**
 * Anonymization Service
 * Strips PII for privacy compliance (FERPA/GDPR)
 */

const crypto = require('crypto');

/**
 * Hash a value for anonymization
 * @param {string} value - Value to hash
 * @param {string} salt - Salt for hashing
 * @returns {string} - Anonymized hash
 */
function hashValue(value, salt = process.env.ANONYMIZATION_SALT || 'default-salt') {
  return crypto.createHmac('sha256', salt).update(value).digest('hex').slice(0, 12);
}

/**
 * Anonymize user data
 * @param {Object} user - User object
 * @returns {Object} - Anonymized user object
 */
function anonymizeUser(user) {
  return {
    id: user.id,
    anonymized_id: hashValue(user.id),
    role: user.role,
    // Remove PII
    email: undefined,
    name: undefined,
    student_number: undefined
  };
}

/**
 * Anonymize submission for export
 * @param {Object} submission - Submission object
 * @returns {Object} - Anonymized submission
 */
function anonymizeSubmission(submission) {
  return {
    id: submission.id,
    student_hash: hashValue(submission.student_id),
    assignment_id: submission.assignment_id,
    version: submission.version,
    status: submission.status,
    submitted_at: submission.submitted_at,
    // Exclude actual content for privacy
    content_length: submission.content ? submission.content.length : 0
  };
}

/**
 * Anonymize grade for export
 * @param {Object} grade - Grade object
 * @returns {Object} - Anonymized grade
 */
function anonymizeGrade(grade) {
  return {
    id: grade.id,
    submission_id: grade.submission_id,
    score: grade.score,
    rubric_scores: grade.rubric_scores,
    graded_at: grade.graded_at,
    // Remove feedback if it might contain PII
    feedback_provided: !!grade.feedback,
    feedback_length: grade.feedback ? grade.feedback.length : 0
  };
}

/**
 * Redact email addresses from text
 * @param {string} text - Text containing potential emails
 * @returns {string} - Text with emails redacted
 */
function redactEmails(text) {
  if (!text) return text;
  return text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REDACTED]');
}

/**
 * Redact phone numbers from text
 * @param {string} text - Text containing potential phone numbers
 * @returns {string} - Text with phone numbers redacted
 */
function redactPhoneNumbers(text) {
  if (!text) return text;
  // Match various phone formats
  return text.replace(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, '[PHONE_REDACTED]');
}

/**
 * Redact all PII from text
 * @param {string} text - Text to clean
 * @returns {string} - Cleaned text
 */
function redactPii(text) {
  if (!text) return text;
  let cleaned = redactEmails(text);
  cleaned = redactPhoneNumbers(cleaned);
  return cleaned;
}

/**
 * Create anonymized dataset for research/analysis
 * @param {Array<Object>} submissions - Array of submissions with grades
 * @returns {Array<Object>} - Anonymized dataset
 */
function createAnonymizedDataset(submissions) {
  return submissions.map(sub => ({
    submission_hash: hashValue(sub.id),
    student_hash: hashValue(sub.student_id),
    assignment_id: sub.assignment_id,
    version: sub.version,
    content_length: sub.content ? sub.content.length : 0,
    word_count: sub.content ? sub.content.split(/\s+/).length : 0,
    submitted_at: sub.submitted_at,
    grade: sub.grade ? {
      score: sub.grade.score,
      rubric_scores: sub.grade.rubric_scores,
      graded_at: sub.grade.graded_at,
      was_overridden: !!sub.grade.graded_by
    } : null
  }));
}

/**
 * Generate GDPR-compliant data export for a user
 * @param {Object} userData - User's complete data
 * @returns {Object} - Formatted export
 */
function generateGdprExport(userData) {
  return {
    export_date: new Date().toISOString(),
    user: {
      id: userData.user.id,
      email: userData.user.email,
      name: userData.user.name,
      role: userData.user.role,
      created_at: userData.user.created_at
    },
    submissions: (userData.submissions || []).map(sub => ({
      id: sub.id,
      assignment_id: sub.assignment_id,
      content: sub.content,
      version: sub.version,
      status: sub.status,
      submitted_at: sub.submitted_at
    })),
    grades: (userData.grades || []).map(grade => ({
      id: grade.id,
      submission_id: grade.submission_id,
      score: grade.score,
      feedback: grade.feedback,
      graded_at: grade.graded_at
    })),
    audit_logs: (userData.auditLogs || []).map(log => ({
      action: log.action,
      resource_type: log.resource_type,
      timestamp: log.timestamp
    }))
  };
}

module.exports = {
  hashValue,
  anonymizeUser,
  anonymizeSubmission,
  anonymizeGrade,
  redactEmails,
  redactPhoneNumbers,
  redactPii,
  createAnonymizedDataset,
  generateGdprExport
};
