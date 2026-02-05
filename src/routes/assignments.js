/**
 * Assignments Routes
 * Assignment management
 */

const { v4: uuidv4 } = require('uuid');

const createAssignmentSchema = {
  body: {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string', minLength: 1 },
      description: { type: 'string' },
      reference_answer: { type: 'string' },
      course_code: { type: 'string' },
      course_id: { type: ['string', 'null'] },
      rubric_id: { type: ['string', 'null'] },
      due_date: { type: ['string', 'null'] },
      max_resubmissions: { type: 'integer', minimum: 0, maximum: 10 },
      total_points: { type: 'integer', minimum: 1 },
      status: { type: 'string', enum: ['draft', 'active', 'closed'] },
      assignment_type: { type: 'string', enum: ['standard', 'quiz', 'essay', 'project'] },
      time_limit_minutes: { type: 'integer', minimum: 1 },
      shuffle_questions: { type: 'boolean' },
      show_correct_answers: { type: 'boolean' },
      // Assignment settings toggles
      allow_late_submissions: { type: 'boolean' },
      ai_grading_enabled: { type: 'boolean' },
      show_feedback_to_students: { type: 'boolean' },
      require_review_before_publish: { type: 'boolean' }
    }
  }
};

async function assignmentsRoutes(fastify, options) {
  /**
   * POST /api/v1/assignments
   * Create a new assignment
   */
  fastify.post('/', {
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])],
    schema: createAssignmentSchema
  }, async (request, reply) => {
    const { 
      title, description, reference_answer, course_code, course_id: providedCourseId, rubric_id, 
      due_date, max_resubmissions, total_points, status, assignment_type,
      time_limit_minutes, shuffle_questions, show_correct_answers,
      // Assignment settings toggles
      allow_late_submissions, ai_grading_enabled, show_feedback_to_students, require_review_before_publish
    } = request.body;
    const userId = request.user.id;

    // Validate rubric if provided
    if (rubric_id) {
      const rubricCheck = await fastify.db.query(
        'SELECT id FROM rubrics WHERE id = $1 AND (created_by = $2 OR is_template = true)',
        [rubric_id, userId]
      );

      if (rubricCheck.rows.length === 0) {
        throw fastify.createError(404, 'Rubric not found', 'RUBRIC_NOT_FOUND');
      }
    }

    // Look up course_id from course_code if not provided directly
    let courseId = providedCourseId || null;
    if (!courseId && course_code) {
      const courseResult = await fastify.db.query(
        'SELECT id FROM courses WHERE code = $1 AND instructor_id = $2',
        [course_code, userId]
      );
      if (courseResult.rows.length > 0) {
        courseId = courseResult.rows[0].id;
      }
    }

    const result = await fastify.db.query(
      `INSERT INTO assignments (id, title, description, reference_answer, course_code, course_id, instructor_id, rubric_id, 
         due_date, max_resubmissions, total_points, status, assignment_type, time_limit_minutes, shuffle_questions, show_correct_answers,
         allow_late_submissions, ai_grading_enabled, show_feedback_to_students, require_review_before_publish, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW(), NOW())
       RETURNING *`,
      [
        uuidv4(), title, description || null, reference_answer || null, course_code || null, courseId, userId, rubric_id || null,
        due_date || null, max_resubmissions || 2, total_points || 100, status || 'draft',
        assignment_type || 'standard', time_limit_minutes || null, shuffle_questions || false, show_correct_answers !== false,
        allow_late_submissions !== false, ai_grading_enabled !== false, show_feedback_to_students !== false, require_review_before_publish || false
      ]
    );

    return reply.code(201).send({
      success: true,
      data: result.rows[0]
    });
  });

  /**
   * GET /api/v1/assignments
   * List assignments (filtered by role)
   */
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { role, id: userId } = request.user;
    const { status, course_code, limit = 50, offset = 0 } = request.query;

    let query;
    let params;

    if (role === 'student') {
      // Get student record first
      const studentResult = await fastify.db.query(
        'SELECT id FROM students WHERE user_id = $1',
        [userId]
      );

      if (studentResult.rows.length === 0) {
        return { success: true, data: [] };
      }

      const studentId = studentResult.rows[0].id;

      // Get all course_ids and course_codes the student is enrolled in
      const enrolledResult = await fastify.db.query(
        `SELECT c.id as course_id, c.code as course_code 
         FROM course_enrollments ce
         JOIN courses c ON ce.course_id = c.id
         WHERE ce.student_id = $1 AND ce.status = 'active'`,
        [studentId]
      );

      const enrolledCourseIds = enrolledResult.rows.map(r => r.course_id);
      const enrolledCourseCodes = enrolledResult.rows.map(r => r.course_code).filter(Boolean);

      // Log enrolled info for debugging
      fastify.log.info({ 
        studentId, 
        enrolledCourseIds, 
        enrolledCourseCodes,
        enrolledCount: enrolledResult.rows.length
      }, 'Student enrollment info');

      // If student is not enrolled in any course, only show open assignments (no course)
      if (enrolledCourseIds.length === 0 && enrolledCourseCodes.length === 0) {
        query = `
          SELECT a.*, u.name as instructor_name,
                 (SELECT COUNT(*) FROM submissions s 
                  WHERE s.assignment_id = a.id AND s.student_id = $1) as my_submissions
          FROM assignments a
          JOIN users u ON a.instructor_id = u.id
          WHERE a.status = 'active'
            AND a.course_id IS NULL 
            AND a.course_code IS NULL
          ORDER BY a.created_at DESC
          LIMIT $2 OFFSET $3
        `;
        params = [studentId, limit, offset];
      } else {
        // Build the enrollment condition parts dynamically
        let paramIndex = 2;
        let enrollmentConditions = [];
        params = [studentId];
        
        if (enrolledCourseIds.length > 0) {
          enrollmentConditions.push(`a.course_id = ANY($${paramIndex}::uuid[])`);
          params.push(enrolledCourseIds);
          paramIndex++;
        }
        
        if (enrolledCourseCodes.length > 0) {
          enrollmentConditions.push(`(a.course_id IS NULL AND a.course_code = ANY($${paramIndex}::text[]))`);
          params.push(enrolledCourseCodes);
          paramIndex++;
        }
        
        // Always allow assignments with no course (open to all)
        enrollmentConditions.push(`(a.course_id IS NULL AND a.course_code IS NULL)`);
        
        const enrollmentCondition = enrollmentConditions.join(' OR ');
        
        let courseCodeFilter = '';
        if (course_code) {
          courseCodeFilter = `AND a.course_code = $${paramIndex}`;
          params.push(course_code);
          paramIndex++;
        }
        
        params.push(limit, offset);

        query = `
          SELECT a.*, u.name as instructor_name,
                 (SELECT COUNT(*) FROM submissions s 
                  WHERE s.assignment_id = a.id AND s.student_id = $1) as my_submissions
          FROM assignments a
          JOIN users u ON a.instructor_id = u.id
          WHERE a.status = 'active'
            AND (${enrollmentCondition})
          ${courseCodeFilter}
          ORDER BY a.created_at DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
      }
      
    } else {
      // Instructors see their assignments
      let whereConditions = ['a.instructor_id = $1'];
      params = [userId];
      let paramIndex = 2;

      if (status) {
        whereConditions.push(`a.status = $${paramIndex}`);
        params.push(status);
        paramIndex++;
      }

      if (course_code) {
        whereConditions.push(`a.course_code = $${paramIndex}`);
        params.push(course_code);
        paramIndex++;
      }

      params.push(limit, offset);

      query = `
        SELECT a.*, r.name as rubric_name,
               (SELECT COUNT(DISTINCT sub.student_id) FROM submissions sub WHERE sub.assignment_id = a.id AND sub.status != 'draft') as submission_count,
               (SELECT COUNT(*) FROM submissions sub WHERE sub.assignment_id = a.id AND sub.status IN ('submitted', 'pending')) as pending_count,
               (SELECT COUNT(*) FROM submissions sub WHERE sub.assignment_id = a.id AND sub.status = 'graded') as graded_count,
               (SELECT COUNT(*) FROM course_enrollments e 
                WHERE e.course_id = a.course_id) as total_students
        FROM assignments a
        LEFT JOIN rubrics r ON a.rubric_id = r.id
        WHERE ${whereConditions.join(' AND ')}
        ORDER BY a.created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
    }

    const result = await fastify.db.query(query, params);

    return {
      success: true,
      data: result.rows
    };
  });

  /**
   * GET /api/v1/assignments/:id
   * Get assignment by ID
   */
  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request) => {
    const { id } = request.params;
    const { role, id: userId } = request.user;

    const result = await fastify.db.query(
      `SELECT a.*, r.name as rubric_name, r.criteria as rubric_criteria,
              u.name as instructor_name,
              (SELECT COUNT(DISTINCT sub.student_id) FROM submissions sub WHERE sub.assignment_id = a.id AND sub.status != 'draft') as submission_count,
              (SELECT COUNT(*) FROM submissions sub WHERE sub.assignment_id = a.id AND sub.status IN ('submitted', 'pending')) as pending_count,
              (SELECT COUNT(*) FROM submissions sub WHERE sub.assignment_id = a.id AND sub.status = 'graded') as graded_count,
              (SELECT COUNT(*) FROM course_enrollments e 
               WHERE e.course_id = a.course_id) as total_students
       FROM assignments a
       LEFT JOIN rubrics r ON a.rubric_id = r.id
       JOIN users u ON a.instructor_id = u.id
       WHERE a.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      throw fastify.createError(404, 'Assignment not found', 'ASSIGNMENT_NOT_FOUND');
    }

    const assignment = result.rows[0];

    // Authorization: students can only see active assignments
    if (role === 'student' && assignment.status !== 'active') {
      throw fastify.createError(403, 'Assignment not available', 'ASSIGNMENT_INACTIVE');
    }

    // For students, check enrollment if assignment belongs to a course
    if (role === 'student' && (assignment.course_id || assignment.course_code)) {
      const studentResult = await fastify.db.query(
        'SELECT id FROM students WHERE user_id = $1',
        [userId]
      );

      if (studentResult.rows.length === 0) {
        throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
      }

      const studentId = studentResult.rows[0].id;
      let isEnrolled = false;

      // Check enrollment by course_id if available
      if (assignment.course_id) {
        const enrollmentCheck = await fastify.db.query(
          `SELECT id FROM course_enrollments 
           WHERE course_id = $1 AND student_id = $2 AND status = 'active'`,
          [assignment.course_id, studentId]
        );
        isEnrolled = enrollmentCheck.rows.length > 0;
      }
      
      // Also check by course_code if course_id didn't match
      if (!isEnrolled && assignment.course_code) {
        const enrollmentCheck = await fastify.db.query(
          `SELECT ce.id FROM course_enrollments ce
           JOIN courses c ON ce.course_id = c.id
           WHERE c.code = $1 AND ce.student_id = $2 AND ce.status = 'active'`,
          [assignment.course_code, studentId]
        );
        isEnrolled = enrollmentCheck.rows.length > 0;
      }

      if (!isEnrolled) {
        throw fastify.createError(403, 'You are not enrolled in this course', 'NOT_ENROLLED');
      }
    }

    // Instructors can only see their own assignments (unless admin)
    if (role === 'instructor' && assignment.instructor_id !== userId) {
      throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
    }

    // Filter out sensitive data for students
    if (role === 'student') {
      // Remove reference answer and filter description if it contains reference answer marker
      delete assignment.reference_answer;
      if (assignment.description && assignment.description.includes('--- Reference Answer ---')) {
        assignment.description = assignment.description.split('--- Reference Answer ---')[0].trim();
      }
    }

    return {
      success: true,
      data: assignment
    };
  });

  /**
   * PUT /api/v1/assignments/:id
   * Update assignment
   */
  fastify.put('/:id', {
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])]
  }, async (request) => {
    const { id } = request.params;
    const { 
      title, description, course_code, rubric_id, 
      due_date, max_resubmissions, total_points, status 
    } = request.body;
    const userId = request.user.id;

    // Check ownership
    const checkResult = await fastify.db.query(
      'SELECT id, instructor_id FROM assignments WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      throw fastify.createError(404, 'Assignment not found', 'ASSIGNMENT_NOT_FOUND');
    }

    if (checkResult.rows[0].instructor_id !== userId && request.user.role !== 'admin') {
      throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
    }

    const result = await fastify.db.query(
      `UPDATE assignments SET
         title = COALESCE($1, title),
         description = COALESCE($2, description),
         course_code = COALESCE($3, course_code),
         rubric_id = COALESCE($4, rubric_id),
         due_date = COALESCE($5, due_date),
         max_resubmissions = COALESCE($6, max_resubmissions),
         total_points = COALESCE($7, total_points),
         status = COALESCE($8, status),
         updated_at = NOW()
       WHERE id = $9
       RETURNING *`,
      [title, description, course_code, rubric_id, due_date, max_resubmissions, total_points, status, id]
    );

    return {
      success: true,
      data: result.rows[0]
    };
  });

  /**
   * DELETE /api/v1/assignments/:id
   * Delete assignment
   */
  fastify.delete('/:id', {
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])]
  }, async (request, reply) => {
    const { id } = request.params;
    const userId = request.user.id;

    // Check ownership and submissions
    const checkResult = await fastify.db.query(
      `SELECT a.id, a.instructor_id, COUNT(s.id) as submission_count
       FROM assignments a
       LEFT JOIN submissions s ON s.assignment_id = a.id
       WHERE a.id = $1
       GROUP BY a.id`,
      [id]
    );

    if (checkResult.rows.length === 0) {
      throw fastify.createError(404, 'Assignment not found', 'ASSIGNMENT_NOT_FOUND');
    }

    if (checkResult.rows[0].instructor_id !== userId && request.user.role !== 'admin') {
      throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
    }

    if (parseInt(checkResult.rows[0].submission_count) > 0) {
      throw fastify.createError(400, 'Cannot delete assignment with submissions', 'HAS_SUBMISSIONS');
    }

    await fastify.db.query('DELETE FROM assignments WHERE id = $1', [id]);

    return reply.code(204).send();
  });

  /**
   * GET /api/v1/assignments/:id/submissions
   * Get all submissions for an assignment
   */
  fastify.get('/:id/submissions', {
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])]
  }, async (request) => {
    const { id } = request.params;
    const userId = request.user.id;
    const { status, limit = 100, offset = 0 } = request.query;

    // Check ownership
    const checkResult = await fastify.db.query(
      'SELECT instructor_id FROM assignments WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      throw fastify.createError(404, 'Assignment not found', 'ASSIGNMENT_NOT_FOUND');
    }

    if (checkResult.rows[0].instructor_id !== userId && request.user.role !== 'admin') {
      throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
    }

    let query = `
      SELECT s.*, st.name as student_name, g.score, g.feedback
      FROM submissions s
      JOIN students st ON s.student_id = st.id
      LEFT JOIN grades g ON g.submission_id = s.id
      WHERE s.assignment_id = $1
      ${status ? 'AND s.status = $2' : ''}
      ORDER BY s.submitted_at DESC
      LIMIT $${status ? 3 : 2} OFFSET $${status ? 4 : 3}
    `;

    const params = status ? [id, status, limit, offset] : [id, limit, offset];
    const result = await fastify.db.query(query, params);

    return {
      success: true,
      data: result.rows
    };
  });

  /**
   * POST /api/v1/assignments/:id/upload-question
   * Upload a PDF as assignment question
   */
  fastify.post('/:id/upload-question', {
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])]
  }, async (request, reply) => {
    const { id } = request.params;
    const userId = request.user.id;

    // Check ownership
    const checkResult = await fastify.db.query(
      'SELECT id, instructor_id FROM assignments WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      throw fastify.createError(404, 'Assignment not found', 'ASSIGNMENT_NOT_FOUND');
    }

    if (checkResult.rows[0].instructor_id !== userId && request.user.role !== 'admin') {
      throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
    }

    // Get the uploaded file
    const data = await request.file();
    if (!data) {
      throw fastify.createError(400, 'No file uploaded', 'NO_FILE');
    }

    const buffer = await data.toBuffer();
    const ext = require('path').extname(data.filename).toLowerCase();

    if (ext !== '.pdf') {
      throw fastify.createError(400, 'Only PDF files are allowed', 'INVALID_FILE_TYPE');
    }

    const fileService = require('../services/file-service');

    // Save the file
    const saved = await fileService.saveFile(buffer, data.filename, userId);

    // Extract text from PDF
    let extractedText = null;
    try {
      extractedText = await fileService.extractTextFromPdf(buffer);
    } catch (err) {
      fastify.log.warn({ err, assignmentId: id }, 'Failed to extract text from question PDF');
      // Continue even if extraction fails - can be retried later
    }

    // Update assignment with PDF info
    await fastify.db.query(
      `UPDATE assignments 
       SET question_pdf_url = $1, question_text_extracted = $2, updated_at = NOW()
       WHERE id = $3`,
      [saved.path, extractedText, id]
    );

    return reply.code(200).send({
      success: true,
      data: {
        filename: saved.filename,
        path: saved.path,
        size: saved.size,
        textExtracted: !!extractedText,
        textLength: extractedText?.length || 0
      }
    });
  });

  /**
   * POST /api/v1/assignments/:id/upload-reference
   * Upload a PDF as reference/model answer
   */
  fastify.post('/:id/upload-reference', {
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])]
  }, async (request, reply) => {
    const { id } = request.params;
    const userId = request.user.id;

    // Check ownership
    const checkResult = await fastify.db.query(
      'SELECT id, instructor_id FROM assignments WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      throw fastify.createError(404, 'Assignment not found', 'ASSIGNMENT_NOT_FOUND');
    }

    if (checkResult.rows[0].instructor_id !== userId && request.user.role !== 'admin') {
      throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
    }

    // Get the uploaded file
    const data = await request.file();
    if (!data) {
      throw fastify.createError(400, 'No file uploaded', 'NO_FILE');
    }

    const buffer = await data.toBuffer();
    const ext = require('path').extname(data.filename).toLowerCase();

    if (ext !== '.pdf') {
      throw fastify.createError(400, 'Only PDF files are allowed', 'INVALID_FILE_TYPE');
    }

    const fileService = require('../services/file-service');

    // Save the file
    const saved = await fileService.saveFile(buffer, data.filename, userId);

    // Extract text from PDF
    let extractedText = null;
    try {
      extractedText = await fileService.extractTextFromPdf(buffer);
    } catch (err) {
      fastify.log.warn({ err, assignmentId: id }, 'Failed to extract text from reference PDF');
      // Continue even if extraction fails - can be retried later
    }

    // Update assignment with PDF info
    await fastify.db.query(
      `UPDATE assignments 
       SET reference_pdf_url = $1, reference_text_extracted = $2, updated_at = NOW()
       WHERE id = $3`,
      [saved.path, extractedText, id]
    );

    return reply.code(200).send({
      success: true,
      data: {
        filename: saved.filename,
        path: saved.path,
        size: saved.size,
        textExtracted: !!extractedText,
        textLength: extractedText?.length || 0
      }
    });
  });

  /**
   * DELETE /api/v1/assignments/:id/question-pdf
   * Remove question PDF from assignment
   */
  fastify.delete('/:id/question-pdf', {
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])]
  }, async (request, reply) => {
    const { id } = request.params;
    const userId = request.user.id;

    const checkResult = await fastify.db.query(
      'SELECT id, instructor_id, question_pdf_url FROM assignments WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      throw fastify.createError(404, 'Assignment not found', 'ASSIGNMENT_NOT_FOUND');
    }

    if (checkResult.rows[0].instructor_id !== userId && request.user.role !== 'admin') {
      throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
    }

    // Delete the file if it exists
    if (checkResult.rows[0].question_pdf_url) {
      const fileService = require('../services/file-service');
      try {
        await fileService.deleteFile(checkResult.rows[0].question_pdf_url);
      } catch (err) {
        fastify.log.warn({ err }, 'Failed to delete question PDF file');
      }
    }

    await fastify.db.query(
      `UPDATE assignments 
       SET question_pdf_url = NULL, question_text_extracted = NULL, updated_at = NOW()
       WHERE id = $1`,
      [id]
    );

    return reply.code(204).send();
  });

  /**
   * DELETE /api/v1/assignments/:id/reference-pdf
   * Remove reference PDF from assignment
   */
  fastify.delete('/:id/reference-pdf', {
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])]
  }, async (request, reply) => {
    const { id } = request.params;
    const userId = request.user.id;

    const checkResult = await fastify.db.query(
      'SELECT id, instructor_id, reference_pdf_url FROM assignments WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      throw fastify.createError(404, 'Assignment not found', 'ASSIGNMENT_NOT_FOUND');
    }

    if (checkResult.rows[0].instructor_id !== userId && request.user.role !== 'admin') {
      throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
    }

    // Delete the file if it exists
    if (checkResult.rows[0].reference_pdf_url) {
      const fileService = require('../services/file-service');
      try {
        await fileService.deleteFile(checkResult.rows[0].reference_pdf_url);
      } catch (err) {
        fastify.log.warn({ err }, 'Failed to delete reference PDF file');
      }
    }

    await fastify.db.query(
      `UPDATE assignments 
       SET reference_pdf_url = NULL, reference_text_extracted = NULL, updated_at = NOW()
       WHERE id = $1`,
      [id]
    );

    return reply.code(204).send();
  });
}

module.exports = assignmentsRoutes;
