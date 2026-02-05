/**
 * Batch Grading Routes
 * POST /api/v1/batch/grade - Grade all pending submissions for an assignment
 */

const { batchGradeSchema } = require('../schemas/grade');

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
async function batchRoutes(fastify, options) {
  
  /**
   * POST /api/v1/batch/grade
   * Grade all pending submissions for an assignment
   */
  fastify.post('/grade', {
    schema: batchGradeSchema,
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])]
  }, async (request, reply) => {
    const { assignment_id, force } = request.body;
    const userId = request.user.id;

    // Verify assignment belongs to this instructor
    const assignmentResult = await fastify.db.query(
      'SELECT id, instructor_id, rubric_id FROM assignments WHERE id = $1',
      [assignment_id]
    );

    if (assignmentResult.rows.length === 0) {
      return reply.status(404).send({ error: 'Assignment not found' });
    }

    const assignment = assignmentResult.rows[0];

    if (assignment.instructor_id !== userId && request.user.role !== 'admin') {
      return reply.status(403).send({ error: 'Not authorized to grade this assignment' });
    }

    if (!assignment.rubric_id) {
      return reply.status(400).send({ error: 'Assignment has no rubric configured' });
    }

    // Get pending submissions
    let statusFilter = "status = 'pending'";
    if (force) {
      statusFilter = "status IN ('pending', 'graded', 'failed')";
    }

    const submissionsResult = await fastify.db.query(
      `SELECT id FROM submissions WHERE assignment_id = $1 AND ${statusFilter}`,
      [assignment_id]
    );

    if (submissionsResult.rows.length === 0) {
      return reply.send({
        message: 'No submissions to grade',
        graded: 0,
        failed: 0
      });
    }

    // Start batch grading (async process)
    const submissionIds = submissionsResult.rows.map(r => r.id);
    
    // Log the batch operation
    const auditService = require('../services/audit-service');
    await auditService.logAction(fastify.db, {
      userId,
      action: auditService.ACTIONS.GRADE_BATCH,
      resourceType: 'assignment',
      resourceId: assignment_id,
      newValue: { submission_count: submissionIds.length, force },
      ipAddress: request.ip,
      userAgent: request.headers['user-agent']
    });

    // For now, return immediately and process async
    // In production, this would queue to Redis/Bull
    const gradingService = require('../services/grading-service');
    
    // Don't await - let it run in background
    gradingService.batchGradeAssignment(fastify.db, assignment_id, force)
      .then(results => {
        fastify.log.info({ assignment_id, results }, 'Batch grading completed');
      })
      .catch(err => {
        fastify.log.error({ assignment_id, error: err.message }, 'Batch grading failed');
      });

    return reply.status(202).send({
      message: 'Batch grading started',
      assignment_id,
      submissions_queued: submissionIds.length,
      status: 'processing'
    });
  });

  /**
   * GET /api/v1/batch/status/:assignmentId
   * Check batch grading status
   */
  fastify.get('/status/:assignmentId', {
    schema: {
      params: {
        type: 'object',
        required: ['assignmentId'],
        properties: {
          assignmentId: { type: 'string', format: 'uuid' }
        }
      }
    },
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])]
  }, async (request, reply) => {
    const { assignmentId } = request.params;

    const result = await fastify.db.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'grading') AS grading,
        COUNT(*) FILTER (WHERE status = 'graded') AS graded,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed,
        COUNT(*) AS total
      FROM submissions
      WHERE assignment_id = $1
    `, [assignmentId]);

    const stats = result.rows[0];

    return reply.send({
      assignment_id: assignmentId,
      pending: parseInt(stats.pending),
      grading: parseInt(stats.grading),
      graded: parseInt(stats.graded),
      failed: parseInt(stats.failed),
      total: parseInt(stats.total),
      progress_percent: stats.total > 0 
        ? Math.round((parseInt(stats.graded) + parseInt(stats.failed)) / parseInt(stats.total) * 100)
        : 0
    });
  });
}

module.exports = batchRoutes;
