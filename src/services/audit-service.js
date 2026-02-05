/**
 * Audit Service
 * Immutable audit logging for compliance (FERPA/GDPR)
 */

/**
 * Log an action to the audit table
 * @param {Object} fastify - Fastify instance
 * @param {Object} params - Audit log parameters
 * @param {string} params.userId - User who performed the action
 * @param {string} params.action - Action type (CREATE, UPDATE, DELETE, READ, etc.)
 * @param {string} params.resourceType - Resource type (submission, grade, user, etc.)
 * @param {string} params.resourceId - Resource UUID
 * @param {Object} params.oldValue - Previous value (for updates)
 * @param {Object} params.newValue - New value (for creates/updates)
 * @param {string} params.ipAddress - Client IP address
 * @param {string} params.userAgent - Client user agent
 * @returns {Promise<Object>} Audit log entry
 */
async function logAction(fastify, { userId, action, resourceType, resourceId, oldValue, newValue, ipAddress, userAgent }) {
  const result = await fastify.db.query(
    `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, old_value, new_value, ip_address, user_agent, timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     RETURNING id, timestamp`,
    [
      userId,
      action,
      resourceType,
      resourceId,
      oldValue ? JSON.stringify(oldValue) : null,
      newValue ? JSON.stringify(newValue) : null,
      ipAddress || null,
      userAgent || null
    ]
  );

  return result.rows[0];
}

/**
 * Get audit logs with filtering
 * @param {Object} fastify - Fastify instance
 * @param {Object} filters - Query filters
 * @returns {Promise<Array>} Audit log entries
 */
async function getAuditLogs(fastify, { userId, action, resourceType, resourceId, startDate, endDate, limit = 100, offset = 0 }) {
  let whereConditions = [];
  let params = [];
  let paramIndex = 1;

  if (userId) {
    whereConditions.push(`user_id = $${paramIndex}`);
    params.push(userId);
    paramIndex++;
  }

  if (action) {
    whereConditions.push(`action = $${paramIndex}`);
    params.push(action);
    paramIndex++;
  }

  if (resourceType) {
    whereConditions.push(`resource_type = $${paramIndex}`);
    params.push(resourceType);
    paramIndex++;
  }

  if (resourceId) {
    whereConditions.push(`resource_id = $${paramIndex}`);
    params.push(resourceId);
    paramIndex++;
  }

  if (startDate) {
    whereConditions.push(`timestamp >= $${paramIndex}`);
    params.push(startDate);
    paramIndex++;
  }

  if (endDate) {
    whereConditions.push(`timestamp <= $${paramIndex}`);
    params.push(endDate);
    paramIndex++;
  }

  params.push(limit, offset);

  const whereClause = whereConditions.length > 0 
    ? `WHERE ${whereConditions.join(' AND ')}` 
    : '';

  const result = await fastify.db.query(
    `SELECT al.*, u.email as user_email, u.name as user_name
     FROM audit_logs al
     LEFT JOIN users u ON al.user_id = u.id
     ${whereClause}
     ORDER BY al.timestamp DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params
  );

  return result.rows;
}

/**
 * Export audit logs for a user (GDPR data export)
 * @param {Object} fastify - Fastify instance
 * @param {string} userId - User UUID
 * @returns {Promise<Object>} User's audit history
 */
async function exportUserAuditHistory(fastify, userId) {
  // Get all actions performed by the user
  const actionsPerformed = await fastify.db.query(
    `SELECT action, resource_type, resource_id, new_value, timestamp
     FROM audit_logs
     WHERE user_id = $1
     ORDER BY timestamp DESC`,
    [userId]
  );

  // Get all actions performed on the user's resources
  const actionsOnResources = await fastify.db.query(
    `SELECT al.action, al.resource_type, al.resource_id, al.old_value, al.new_value, al.timestamp,
            u.email as performed_by_email
     FROM audit_logs al
     LEFT JOIN users u ON al.user_id = u.id
     WHERE al.resource_type = 'user' AND al.resource_id = $1
     ORDER BY al.timestamp DESC`,
    [userId]
  );

  return {
    user_id: userId,
    exported_at: new Date().toISOString(),
    actions_performed: actionsPerformed.rows,
    actions_on_account: actionsOnResources.rows
  };
}

/**
 * Delete user data (GDPR right to be forgotten)
 * Note: Audit logs are retained for compliance but anonymized
 * @param {Object} fastify - Fastify instance
 * @param {string} userId - User UUID
 * @returns {Promise<Object>} Deletion result
 */
async function anonymizeUserData(fastify, userId) {
  // Log the deletion request first
  await logAction(fastify, {
    userId,
    action: 'DATA_DELETION_REQUEST',
    resourceType: 'user',
    resourceId: userId,
    newValue: { requested_at: new Date().toISOString() }
  });

  // Anonymize user record (keep for audit trail reference)
  await fastify.db.query(
    `UPDATE users SET
       email = CONCAT('deleted_', id, '@anonymized.local'),
       name = 'Deleted User',
       password_hash = 'DELETED',
       updated_at = NOW()
     WHERE id = $1`,
    [userId]
  );

  // Anonymize student records
  await fastify.db.query(
    `UPDATE students SET
       name = 'Deleted Student',
       student_number = NULL,
       section = NULL
     WHERE user_id = $1`,
    [userId]
  );

  return {
    success: true,
    message: 'User data anonymized',
    user_id: userId,
    anonymized_at: new Date().toISOString()
  };
}

// Audit action constants
const AUDIT_ACTIONS = {
  CREATE: 'CREATE',
  READ: 'READ',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  SUBMISSION_GRADE: 'SUBMISSION_GRADE',
  GRADE_OVERRIDE: 'GRADE_OVERRIDE',
  DATA_EXPORT: 'DATA_EXPORT',
  DATA_DELETION_REQUEST: 'DATA_DELETION_REQUEST'
};

module.exports = {
  logAction,
  getAuditLogs,
  exportUserAuditHistory,
  anonymizeUserData,
  AUDIT_ACTIONS
};
