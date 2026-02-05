/**
 * Export Routes
 * GET /api/v1/export/grades - Export grades as CSV
 * GET /api/v1/export/audit - Export audit logs
 * GET /api/v1/export/gdpr - GDPR data export for a user
 */

const { generateCsv } = require('../services/file-service');
const { createAnonymizedDataset, generateGdprExport } = require('../services/anonymization');

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
async function exportRoutes(fastify, options) {

  /**
   * GET /api/v1/export/grades/:assignmentId
   * Export grades for an assignment as CSV
   */
  fastify.get('/grades/:assignmentId', {
    schema: {
      params: {
        type: 'object',
        required: ['assignmentId'],
        properties: {
          assignmentId: { type: 'string', format: 'uuid' }
        }
      },
      querystring: {
        type: 'object',
        properties: {
          format: {
            type: 'string',
            enum: ['csv', 'json'],
            default: 'csv'
          },
          anonymize: {
            type: 'boolean',
            default: false
          }
        }
      }
    },
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])]
  }, async (request, reply) => {
    const { assignmentId } = request.params;
    const { format, anonymize } = request.query;
    const userId = request.user.id;

    // Verify assignment ownership
    const assignmentResult = await fastify.db.query(
      'SELECT id, title, instructor_id FROM assignments WHERE id = $1',
      [assignmentId]
    );

    if (assignmentResult.rows.length === 0) {
      return reply.status(404).send({ error: 'Assignment not found' });
    }

    const assignment = assignmentResult.rows[0];

    if (assignment.instructor_id !== userId && request.user.role !== 'admin') {
      return reply.status(403).send({ error: 'Not authorized to export this assignment' });
    }

    // Fetch grades with student info
    const gradesResult = await fastify.db.query(`
      SELECT 
        s.id AS submission_id,
        s.version,
        s.status,
        s.submitted_at,
        st.name AS student_name,
        st.student_number,
        u.email AS student_email,
        g.score,
        g.feedback,
        g.rubric_scores,
        g.graded_at,
        CASE WHEN g.graded_by IS NOT NULL THEN 'instructor' ELSE 'ai' END AS graded_by
      FROM submissions s
      JOIN students st ON s.student_id = st.id
      JOIN users u ON st.user_id = u.id
      LEFT JOIN grades g ON g.submission_id = s.id
      WHERE s.assignment_id = $1
      ORDER BY st.name, s.version
    `, [assignmentId]);

    let data = gradesResult.rows;

    if (anonymize) {
      data = createAnonymizedDataset(data.map(row => ({
        ...row,
        student_id: row.submission_id,
        grade: row.score ? {
          score: row.score,
          rubric_scores: row.rubric_scores,
          graded_at: row.graded_at,
          graded_by: row.graded_by
        } : null
      })));
    }

    // Log export action
    const auditService = require('../services/audit-service');
    await auditService.logAction(fastify.db, {
      userId,
      action: auditService.ACTIONS.DATA_EXPORT,
      resourceType: 'assignment',
      resourceId: assignmentId,
      newValue: { format, anonymize, record_count: data.length },
      ipAddress: request.ip,
      userAgent: request.headers['user-agent']
    });

    if (format === 'json') {
      return reply.send({
        assignment: {
          id: assignment.id,
          title: assignment.title
        },
        exported_at: new Date().toISOString(),
        data
      });
    }

    // CSV format
    const headers = anonymize
      ? ['submission_hash', 'student_hash', 'version', 'content_length', 'word_count', 'submitted_at', 'score', 'was_overridden']
      : ['student_name', 'student_number', 'student_email', 'version', 'status', 'submitted_at', 'score', 'graded_by', 'graded_at'];

    const csvContent = generateCsv(data, headers);

    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', `attachment; filename="${assignment.title.replace(/[^a-z0-9]/gi, '_')}_grades.csv"`);
    
    return reply.send(csvContent);
  });

  /**
   * GET /api/v1/export/audit
   * Export audit logs (admin only)
   */
  fastify.get('/audit', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          start_date: { type: 'string', format: 'date' },
          end_date: { type: 'string', format: 'date' },
          user_id: { type: 'string', format: 'uuid' },
          action: { type: 'string' },
          format: { type: 'string', enum: ['csv', 'json'], default: 'json' }
        }
      }
    },
    preHandler: [fastify.authenticate, fastify.authorize(['admin'])]
  }, async (request, reply) => {
    const { start_date, end_date, user_id, action, format } = request.query;

    let query = 'SELECT * FROM audit_logs WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (start_date) {
      query += ` AND timestamp >= $${paramIndex}`;
      params.push(start_date);
      paramIndex++;
    }

    if (end_date) {
      query += ` AND timestamp <= $${paramIndex}`;
      params.push(end_date + ' 23:59:59');
      paramIndex++;
    }

    if (user_id) {
      query += ` AND user_id = $${paramIndex}`;
      params.push(user_id);
      paramIndex++;
    }

    if (action) {
      query += ` AND action = $${paramIndex}`;
      params.push(action);
      paramIndex++;
    }

    query += ' ORDER BY timestamp DESC LIMIT 10000';

    const result = await fastify.db.query(query, params);

    if (format === 'csv') {
      const headers = ['id', 'user_id', 'action', 'resource_type', 'resource_id', 'timestamp', 'ip_address'];
      const csvContent = generateCsv(result.rows, headers);

      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', 'attachment; filename="audit_logs.csv"');
      
      return reply.send(csvContent);
    }

    return reply.send({
      count: result.rows.length,
      logs: result.rows
    });
  });

  /**
   * GET /api/v1/export/gdpr/:userId
   * GDPR-compliant data export for a user
   */
  fastify.get('/gdpr/:userId', {
    schema: {
      params: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'string', format: 'uuid' }
        }
      }
    },
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { userId } = request.params;

    // Users can only export their own data, admins can export anyone's
    if (userId !== request.user.id && request.user.role !== 'admin') {
      return reply.status(403).send({ error: 'Not authorized to export this data' });
    }

    // Fetch user data
    const userResult = await fastify.db.query(
      'SELECT id, email, name, role, created_at FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return reply.status(404).send({ error: 'User not found' });
    }

    // Fetch student record if exists
    const studentResult = await fastify.db.query(
      'SELECT id FROM students WHERE user_id = $1',
      [userId]
    );

    let submissions = [];
    let grades = [];

    if (studentResult.rows.length > 0) {
      const studentId = studentResult.rows[0].id;

      // Fetch submissions
      const subResult = await fastify.db.query(
        'SELECT * FROM submissions WHERE student_id = $1',
        [studentId]
      );
      submissions = subResult.rows;

      // Fetch grades
      const submissionIds = submissions.map(s => s.id);
      if (submissionIds.length > 0) {
        const gradeResult = await fastify.db.query(
          'SELECT * FROM grades WHERE submission_id = ANY($1)',
          [submissionIds]
        );
        grades = gradeResult.rows;
      }
    }

    // Fetch audit logs
    const auditResult = await fastify.db.query(
      'SELECT action, resource_type, resource_id, timestamp FROM audit_logs WHERE user_id = $1 ORDER BY timestamp',
      [userId]
    );

    const exportData = generateGdprExport({
      user: userResult.rows[0],
      submissions,
      grades,
      auditLogs: auditResult.rows
    });

    // Log this export
    const auditService = require('../services/audit-service');
    await auditService.logAction(fastify.db, {
      userId: request.user.id,
      action: auditService.ACTIONS.DATA_EXPORT,
      resourceType: 'user',
      resourceId: userId,
      newValue: { type: 'gdpr_export' },
      ipAddress: request.ip,
      userAgent: request.headers['user-agent']
    });

    reply.header('Content-Type', 'application/json');
    reply.header('Content-Disposition', `attachment; filename="gdpr_export_${userId}.json"`);

    return reply.send(exportData);
  });
}

module.exports = exportRoutes;
