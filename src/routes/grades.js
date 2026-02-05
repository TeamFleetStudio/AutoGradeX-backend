/**
 * Grades Routes
 * Grade management and retrieval
 */

const { v4: uuidv4 } = require('uuid');

async function gradesRoutes(fastify, options) {
  /**
   * GET /api/v1/grades
   * List grades (filtered by role)
   */
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { role, id: userId } = request.user;
    const { assignment_id, limit = 50, offset = 0 } = request.query;

    let query;
    let params;

    if (role === 'student') {
      const studentResult = await fastify.db.query(
        'SELECT id FROM students WHERE user_id = $1',
        [userId]
      );

      if (studentResult.rows.length === 0) {
        return { success: true, data: [] };
      }

      query = `
        SELECT g.*, s.version as submission_version, s.is_late, a.title as assignment_title, a.total_points, a.due_date as assignment_due_date
        FROM grades g
        JOIN submissions s ON g.submission_id = s.id
        JOIN assignments a ON s.assignment_id = a.id
        WHERE s.student_id = $1
        ${assignment_id ? 'AND s.assignment_id = $2' : ''}
        ORDER BY g.graded_at DESC
        LIMIT $${assignment_id ? 3 : 2}
        OFFSET $${assignment_id ? 4 : 3}
      `;
      params = assignment_id 
        ? [studentResult.rows[0].id, assignment_id, limit, offset]
        : [studentResult.rows[0].id, limit, offset];
    } else {
      query = `
        SELECT g.*, s.version as submission_version, s.is_late, st.name as student_name, 
               a.title as assignment_title, a.total_points, a.due_date as assignment_due_date
        FROM grades g
        JOIN submissions s ON g.submission_id = s.id
        JOIN students st ON s.student_id = st.id
        JOIN assignments a ON s.assignment_id = a.id
        WHERE a.instructor_id = $1
        ${assignment_id ? 'AND s.assignment_id = $2' : ''}
        ORDER BY g.graded_at DESC
        LIMIT $${assignment_id ? 3 : 2}
        OFFSET $${assignment_id ? 4 : 3}
      `;
      params = assignment_id 
        ? [userId, assignment_id, limit, offset]
        : [userId, limit, offset];
    }

    const result = await fastify.db.query(query, params);

    return {
      success: true,
      data: result.rows
    };
  });

  /**
   * GET /api/v1/grades/:id
   * Get grade by ID
   */
  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request) => {
    const { id } = request.params;
    const { role, id: userId } = request.user;

    const result = await fastify.db.query(
      `SELECT g.*, s.content as submission_content, s.version as submission_version,
              st.name as student_name, st.user_id as student_user_id,
              a.title as assignment_title, a.instructor_id, a.total_points
       FROM grades g
       JOIN submissions s ON g.submission_id = s.id
       JOIN students st ON s.student_id = st.id
       JOIN assignments a ON s.assignment_id = a.id
       WHERE g.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      throw fastify.createError(404, 'Grade not found', 'GRADE_NOT_FOUND');
    }

    const grade = result.rows[0];

    // Authorization check
    if (role === 'student' && grade.student_user_id !== userId) {
      throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
    }

    if (role === 'instructor' && grade.instructor_id !== userId) {
      throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
    }

    return {
      success: true,
      data: grade
    };
  });

  /**
   * GET /api/v1/grades/submission/:submissionId
   * Get grade by submission ID
   */
  fastify.get('/submission/:submissionId', { preHandler: [fastify.authenticate] }, async (request) => {
    const { submissionId } = request.params;
    const { role, id: userId } = request.user;

    const result = await fastify.db.query(
      `SELECT g.*, s.content as submission_content, s.version as submission_version,
              st.name as student_name, st.user_id as student_user_id,
              a.title as assignment_title, a.instructor_id, a.total_points
       FROM grades g
       JOIN submissions s ON g.submission_id = s.id
       JOIN students st ON s.student_id = st.id
       JOIN assignments a ON s.assignment_id = a.id
       WHERE g.submission_id = $1`,
      [submissionId]
    );

    if (result.rows.length === 0) {
      throw fastify.createError(404, 'Grade not found for submission', 'GRADE_NOT_FOUND');
    }

    const grade = result.rows[0];

    // Authorization check
    if (role === 'student' && grade.student_user_id !== userId) {
      throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
    }

    if (role === 'instructor' && grade.instructor_id !== userId) {
      throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
    }

    return {
      success: true,
      data: grade
    };
  });

  /**
   * PUT /api/v1/grades/:id
   * Update grade (instructor override)
   */
  fastify.put('/:id', {
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])]
  }, async (request) => {
    const { id } = request.params;
    const { score, feedback, rubric_scores } = request.body;
    const userId = request.user.id;

    // Check grade exists and belongs to instructor's assignment
    const checkResult = await fastify.db.query(
      `SELECT g.id, a.instructor_id 
       FROM grades g
       JOIN submissions s ON g.submission_id = s.id
       JOIN assignments a ON s.assignment_id = a.id
       WHERE g.id = $1`,
      [id]
    );

    if (checkResult.rows.length === 0) {
      throw fastify.createError(404, 'Grade not found', 'GRADE_NOT_FOUND');
    }

    if (checkResult.rows[0].instructor_id !== userId) {
      throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
    }

    // Update grade
    const result = await fastify.db.query(
      `UPDATE grades 
       SET score = COALESCE($1, score),
           feedback = COALESCE($2, feedback),
           rubric_scores = COALESCE($3, rubric_scores),
           graded_by = $4,
           graded_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [score, feedback, rubric_scores ? JSON.stringify(rubric_scores) : null, userId, id]
    );

    // Log to audit table for compliance (FERPA/GDPR)
    try {
      await fastify.db.query(
        `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          userId,
          'GRADE_UPDATED',
          'grade',
          id,
          JSON.stringify({
            previous_score: checkResult.rows[0].score,
            new_score: score,
            feedback_updated: !!feedback,
          }),
        ]
      );
    } catch (auditErr) {
      // Log audit failure but don't fail the request
      fastify.log.warn({ gradeId: id, error: auditErr.message }, 'Failed to write audit log');
    }

    return {
      success: true,
      data: result.rows[0]
    };
  });
}

module.exports = gradesRoutes;
