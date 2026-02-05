/**
 * Courses Routes
 * Course management and student enrollment
 */

const { v4: uuidv4 } = require('uuid');

/**
 * Generate a random enrollment code
 * @returns {string} 6-character alphanumeric code
 */
function generateEnrollmentCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

const createCourseSchema = {
  body: {
    type: 'object',
    required: ['code', 'name'],
    properties: {
      code: { type: 'string', minLength: 2, maxLength: 20 },
      name: { type: 'string', minLength: 1 },
      description: { type: 'string' },
      term: { type: 'string' },
      year: { type: 'integer', minimum: 2020, maximum: 2100 },
      allow_self_enrollment: { type: 'boolean' },
      max_students: { type: 'integer', minimum: 1 },
      status: { type: 'string', enum: ['draft', 'active', 'archived'] }
    }
  }
};

const enrollmentSchema = {
  body: {
    type: 'object',
    required: ['enrollment_code'],
    properties: {
      enrollment_code: { type: 'string', minLength: 6, maxLength: 6 }
    }
  }
};

async function coursesRoutes(fastify, options) {
  // ============================================
  // INSTRUCTOR ROUTES
  // ============================================

  /**
   * POST /api/v1/courses
   * Create a new course (instructors only)
   */
  fastify.post('/', {
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])],
    schema: createCourseSchema
  }, async (request, reply) => {
    const { 
      code, name, description, term, year, 
      allow_self_enrollment, max_students, status 
    } = request.body;
    const instructorId = request.user.id;

    // Generate unique enrollment code
    let enrollmentCode;
    let attempts = 0;
    while (attempts < 10) {
      enrollmentCode = generateEnrollmentCode();
      const exists = await fastify.db.query(
        'SELECT id FROM courses WHERE enrollment_code = $1',
        [enrollmentCode]
      );
      if (exists.rows.length === 0) break;
      attempts++;
    }

    if (attempts >= 10) {
      throw fastify.createError(500, 'Failed to generate enrollment code', 'CODE_GENERATION_FAILED');
    }

    const result = await fastify.db.query(
      `INSERT INTO courses (id, code, name, description, instructor_id, term, year, 
         enrollment_code, allow_self_enrollment, max_students, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
       RETURNING *`,
      [
        uuidv4(), code, name, description || null, instructorId,
        term || null, year || null, enrollmentCode,
        allow_self_enrollment !== false, max_students || 500, status || 'active'
      ]
    );

    // Log audit event
    await fastify.auditLog({
      userId: instructorId,
      action: 'CREATE',
      resourceType: 'course',
      resourceId: result.rows[0].id,
      newValue: result.rows[0],
      request
    });

    return reply.code(201).send({
      success: true,
      data: result.rows[0]
    });
  });

  /**
   * GET /api/v1/courses
   * List courses (filtered by role)
   */
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { role, id: userId } = request.user;
    const { status, term, year, limit = 50, offset = 0 } = request.query;

    let query;
    let params;

    if (role === 'student') {
      // Students see their enrolled courses
      query = `
        SELECT 
          c.*,
          u.name as instructor_name,
          ce.enrolled_at,
          ce.status as enrollment_status,
          (SELECT COUNT(*) FROM assignments a WHERE a.course_id = c.id AND a.status = 'active') as active_assignments
        FROM courses c
        JOIN course_enrollments ce ON c.id = ce.course_id
        JOIN students s ON ce.student_id = s.id
        JOIN users u ON c.instructor_id = u.id
        WHERE s.user_id = $1 AND ce.status = 'active'
        ORDER BY c.created_at DESC
        LIMIT $2 OFFSET $3
      `;
      params = [userId, limit, offset];
    } else {
      // Instructors see their own courses
      let whereConditions = ['c.instructor_id = $1'];
      params = [userId];
      let paramIndex = 2;

      if (status) {
        whereConditions.push(`c.status = $${paramIndex}`);
        params.push(status);
        paramIndex++;
      }

      if (term) {
        whereConditions.push(`c.term = $${paramIndex}`);
        params.push(term);
        paramIndex++;
      }

      if (year) {
        whereConditions.push(`c.year = $${paramIndex}`);
        params.push(year);
        paramIndex++;
      }

      params.push(limit, offset);

      query = `
        SELECT c.*,
               (SELECT COUNT(*) FROM course_enrollments ce WHERE ce.course_id = c.id AND ce.status = 'active') as enrolled_count,
               (SELECT COUNT(*) FROM assignments a WHERE a.course_id = c.id OR (a.course_id IS NULL AND a.course_code = c.code AND a.instructor_id = c.instructor_id)) as assignment_count
        FROM courses c
        WHERE ${whereConditions.join(' AND ')}
        ORDER BY c.created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
    }

    const result = await fastify.db.query(query, params);

    return {
      success: true,
      data: result.rows
    };
  });

  // ============================================
  // STUDENT ROUTES
  // ============================================

  /**
   * POST /api/v1/courses/enroll
   * Student self-enrollment using enrollment code
   */
  fastify.post('/enroll', {
    preHandler: [fastify.authenticate, fastify.authorize(['student'])],
    schema: enrollmentSchema
  }, async (request, reply) => {
    const { enrollment_code } = request.body;
    const userId = request.user.id;

    // Find course by enrollment code
    const courseResult = await fastify.db.query(
      'SELECT * FROM courses WHERE enrollment_code = $1',
      [enrollment_code.toUpperCase()]
    );

    if (courseResult.rows.length === 0) {
      throw fastify.createError(404, 'Invalid enrollment code', 'INVALID_CODE');
    }

    const course = courseResult.rows[0];

    // Check course status
    if (course.status !== 'active') {
      throw fastify.createError(400, 'Course is not active', 'COURSE_INACTIVE');
    }

    // Get student record
    const studentResult = await fastify.db.query(
      'SELECT id FROM students WHERE user_id = $1',
      [userId]
    );

    if (studentResult.rows.length === 0) {
      throw fastify.createError(404, 'Student profile not found', 'STUDENT_NOT_FOUND');
    }

    const studentId = studentResult.rows[0].id;

    // Check if already enrolled
    const enrollmentCheck = await fastify.db.query(
      'SELECT id, status FROM course_enrollments WHERE course_id = $1 AND student_id = $2',
      [course.id, studentId]
    );

    if (enrollmentCheck.rows.length > 0) {
      if (enrollmentCheck.rows[0].status === 'active') {
        throw fastify.createError(409, 'Already enrolled in this course', 'ALREADY_ENROLLED');
      }
      // Re-activate dropped enrollment
      const result = await fastify.db.query(
        `UPDATE course_enrollments 
         SET status = 'active', enrolled_at = NOW(), dropped_at = NULL 
         WHERE course_id = $1 AND student_id = $2 
         RETURNING *`,
        [course.id, studentId]
      );

      // Get full course info
      return {
        success: true,
        message: 'Successfully re-enrolled in course',
        data: {
          enrollment: result.rows[0],
          course: {
            id: course.id,
            code: course.code,
            name: course.name,
            instructor_id: course.instructor_id
          }
        }
      };
    }

    // Check max students
    const enrolledCount = await fastify.db.query(
      'SELECT COUNT(*) FROM course_enrollments WHERE course_id = $1 AND status = $2',
      [course.id, 'active']
    );

    if (parseInt(enrolledCount.rows[0].count) >= course.max_students) {
      throw fastify.createError(400, 'Course is full', 'COURSE_FULL');
    }

    // Enroll student
    const result = await fastify.db.query(
      `INSERT INTO course_enrollments (id, course_id, student_id, status, enrolled_at)
       VALUES ($1, $2, $3, 'active', NOW())
       RETURNING *`,
      [uuidv4(), course.id, studentId]
    );

    // Log audit event
    await fastify.auditLog({
      userId,
      action: 'ENROLL',
      resourceType: 'course_enrollment',
      resourceId: result.rows[0].id,
      newValue: { course_id: course.id, student_id: studentId },
      request
    });

    return reply.code(201).send({
      success: true,
      message: 'Successfully enrolled in course',
      data: {
        enrollment: result.rows[0],
        course: {
          id: course.id,
          code: course.code,
          name: course.name,
          instructor_id: course.instructor_id
        }
      }
    });
  });

  /**
   * GET /api/v1/courses/my-courses
   * Get student's enrolled courses
   */
  fastify.get('/my-courses', {
    preHandler: [fastify.authenticate, fastify.authorize(['student'])]
  }, async (request) => {
    const userId = request.user.id;
    const { status = 'active' } = request.query;

    const result = await fastify.db.query(
      `SELECT 
        c.id,
        c.code,
        c.name,
        c.description,
        c.term,
        c.year,
        u.name as instructor_name,
        ce.enrolled_at,
        ce.status as enrollment_status,
        (SELECT COUNT(*) FROM assignments a WHERE (a.course_id = c.id OR (a.course_id IS NULL AND a.course_code = c.code AND a.instructor_id = c.instructor_id)) AND a.status = 'active') as active_assignments,
        (SELECT COUNT(*) FROM assignments a WHERE a.course_id = c.id OR (a.course_id IS NULL AND a.course_code = c.code AND a.instructor_id = c.instructor_id)) as total_assignments,
        (
          SELECT COUNT(DISTINCT sub.assignment_id)
          FROM submissions sub
          JOIN students st ON sub.student_id = st.id
          JOIN assignments a ON sub.assignment_id = a.id
          WHERE st.user_id = $1 AND (a.course_id = c.id OR (a.course_id IS NULL AND a.course_code = c.code AND a.instructor_id = c.instructor_id))
        ) as assignments_submitted
       FROM courses c
       JOIN course_enrollments ce ON c.id = ce.course_id
       JOIN students s ON ce.student_id = s.id
       JOIN users u ON c.instructor_id = u.id
       WHERE s.user_id = $1 AND ce.status = $2
       ORDER BY c.name ASC`,
      [userId, status]
    );

    return {
      success: true,
      data: result.rows
    };
  });

  /**
   * GET /api/v1/courses/:id
   * Get course details
   */
  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { role, id: userId } = request.user;

    const result = await fastify.db.query(
      `SELECT c.*, u.name as instructor_name, u.email as instructor_email,
              (SELECT COUNT(*) FROM course_enrollments ce WHERE ce.course_id = c.id AND ce.status = 'active') as enrolled_count,
              (SELECT COUNT(*) FROM assignments a WHERE a.course_id = c.id OR (a.course_id IS NULL AND a.course_code = c.code AND a.instructor_id = c.instructor_id)) as assignment_count,
              (SELECT COUNT(*) FROM assignments a WHERE (a.course_id = c.id OR (a.course_id IS NULL AND a.course_code = c.code AND a.instructor_id = c.instructor_id)) AND a.status = 'active') as active_assignment_count
       FROM courses c
       JOIN users u ON c.instructor_id = u.id
       WHERE c.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      throw fastify.createError(404, 'Course not found', 'COURSE_NOT_FOUND');
    }

    const course = result.rows[0];

    // Authorization check
    if (role === 'student') {
      // Check if student is enrolled
      const enrollmentCheck = await fastify.db.query(
        `SELECT ce.id FROM course_enrollments ce
         JOIN students s ON ce.student_id = s.id
         WHERE ce.course_id = $1 AND s.user_id = $2 AND ce.status = 'active'`,
        [id, userId]
      );
      if (enrollmentCheck.rows.length === 0) {
        throw fastify.createError(403, 'Not enrolled in this course', 'NOT_ENROLLED');
      }
    } else if (role === 'instructor' && course.instructor_id !== userId) {
      throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
    }

    return {
      success: true,
      data: course
    };
  });

  /**
   * GET /api/v1/courses/:id/stats
   * Get course statistics
   */
  fastify.get('/:id/stats', { preHandler: [fastify.authenticate] }, async (request) => {
    const { id } = request.params;
    const { role, id: userId } = request.user;

    // Check course exists and user has access
    const courseResult = await fastify.db.query(
      'SELECT * FROM courses WHERE id = $1',
      [id]
    );

    if (courseResult.rows.length === 0) {
      throw fastify.createError(404, 'Course not found', 'COURSE_NOT_FOUND');
    }

    const course = courseResult.rows[0];

    // Authorization check
    if (role === 'instructor' && course.instructor_id !== userId && role !== 'admin') {
      throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
    }

    // Get course statistics
    const [enrollmentStats, assignmentStats, submissionStats, gradeStats] = await Promise.all([
      // Enrollment count
      fastify.db.query(
        `SELECT COUNT(*) as total_students 
         FROM course_enrollments 
         WHERE course_id = $1 AND status = 'active'`,
        [id]
      ),
      // Assignment stats - check both course_id and course_code with instructor_id for data isolation
      fastify.db.query(
        `SELECT 
           COUNT(*) as total_assignments,
           COUNT(*) FILTER (WHERE status = 'active') as active_assignments,
           COUNT(*) FILTER (WHERE due_date > NOW()) as upcoming_assignments
         FROM assignments 
         WHERE course_id = $1 OR (course_code = $2 AND instructor_id = $3)`,
        [id, course.code, course.instructor_id]
      ),
      // Submission stats - check both course_id and course_code with instructor_id for data isolation
      fastify.db.query(
        `SELECT 
           COUNT(*) as total_submissions,
           COUNT(*) FILTER (WHERE s.status = 'graded') as graded_submissions,
           COUNT(*) FILTER (WHERE s.status = 'submitted') as pending_submissions
         FROM submissions s
         JOIN assignments a ON s.assignment_id = a.id
         WHERE a.course_id = $1 OR (a.course_code = $2 AND a.instructor_id = $3)`,
        [id, course.code, course.instructor_id]
      ),
      // Grade stats - check both course_id and course_code with instructor_id for data isolation
      fastify.db.query(
        `SELECT 
           AVG(g.score) as average_score,
           MIN(g.score) as min_score,
           MAX(g.score) as max_score
         FROM grades g
         JOIN submissions s ON g.submission_id = s.id
         JOIN assignments a ON s.assignment_id = a.id
         WHERE a.course_id = $1 OR (a.course_code = $2 AND a.instructor_id = $3)`,
        [id, course.code, course.instructor_id]
      )
    ]);

    return {
      success: true,
      data: {
        totalStudents: parseInt(enrollmentStats.rows[0]?.total_students || 0),
        totalAssignments: parseInt(assignmentStats.rows[0]?.total_assignments || 0),
        activeAssignments: parseInt(assignmentStats.rows[0]?.active_assignments || 0),
        upcomingAssignments: parseInt(assignmentStats.rows[0]?.upcoming_assignments || 0),
        totalSubmissions: parseInt(submissionStats.rows[0]?.total_submissions || 0),
        gradedSubmissions: parseInt(submissionStats.rows[0]?.graded_submissions || 0),
        pendingSubmissions: parseInt(submissionStats.rows[0]?.pending_submissions || 0),
        averageScore: gradeStats.rows[0]?.average_score ? parseFloat(gradeStats.rows[0].average_score).toFixed(1) : null,
        minScore: gradeStats.rows[0]?.min_score || null,
        maxScore: gradeStats.rows[0]?.max_score || null,
      }
    };
  });

  /**
   * PUT /api/v1/courses/:id
   * Update course
   */
  fastify.put('/:id', {
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])]
  }, async (request) => {
    const { id } = request.params;
    const { 
      code, name, description, term, year,
      allow_self_enrollment, max_students, status 
    } = request.body;
    const userId = request.user.id;

    // Check ownership
    const checkResult = await fastify.db.query(
      'SELECT * FROM courses WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      throw fastify.createError(404, 'Course not found', 'COURSE_NOT_FOUND');
    }

    if (checkResult.rows[0].instructor_id !== userId && request.user.role !== 'admin') {
      throw fastify.createError(403, 'Not authorized to update this course', 'FORBIDDEN');
    }

    const oldValue = checkResult.rows[0];

    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (code !== undefined) { updates.push(`code = $${paramIndex++}`); values.push(code); }
    if (name !== undefined) { updates.push(`name = $${paramIndex++}`); values.push(name); }
    if (description !== undefined) { updates.push(`description = $${paramIndex++}`); values.push(description); }
    if (term !== undefined) { updates.push(`term = $${paramIndex++}`); values.push(term); }
    if (year !== undefined) { updates.push(`year = $${paramIndex++}`); values.push(year); }
    if (allow_self_enrollment !== undefined) { updates.push(`allow_self_enrollment = $${paramIndex++}`); values.push(allow_self_enrollment); }
    if (max_students !== undefined) { updates.push(`max_students = $${paramIndex++}`); values.push(max_students); }
    if (status !== undefined) { updates.push(`status = $${paramIndex++}`); values.push(status); }

    if (updates.length === 0) {
      return { success: true, data: oldValue };
    }

    values.push(id);
    const result = await fastify.db.query(
      `UPDATE courses SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    // Log audit event
    await fastify.auditLog({
      userId,
      action: 'UPDATE',
      resourceType: 'course',
      resourceId: id,
      oldValue,
      newValue: result.rows[0],
      request
    });

    return {
      success: true,
      data: result.rows[0]
    };
  });

  /**
   * DELETE /api/v1/courses/:id
   * Delete course
   */
  fastify.delete('/:id', {
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])]
  }, async (request, reply) => {
    const { id } = request.params;
    const userId = request.user.id;

    const checkResult = await fastify.db.query(
      'SELECT * FROM courses WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      throw fastify.createError(404, 'Course not found', 'COURSE_NOT_FOUND');
    }

    if (checkResult.rows[0].instructor_id !== userId && request.user.role !== 'admin') {
      throw fastify.createError(403, 'Not authorized to delete this course', 'FORBIDDEN');
    }

    await fastify.db.query('DELETE FROM courses WHERE id = $1', [id]);

    // Log audit event
    await fastify.auditLog({
      userId,
      action: 'DELETE',
      resourceType: 'course',
      resourceId: id,
      oldValue: checkResult.rows[0],
      request
    });

    return reply.code(204).send();
  });

  /**
   * POST /api/v1/courses/:id/archive
   * Archive a course
   */
  fastify.post('/:id/archive', {
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])]
  }, async (request) => {
    const { id } = request.params;
    const userId = request.user.id;

    const checkResult = await fastify.db.query(
      'SELECT * FROM courses WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      throw fastify.createError(404, 'Course not found', 'COURSE_NOT_FOUND');
    }

    if (checkResult.rows[0].instructor_id !== userId && request.user.role !== 'admin') {
      throw fastify.createError(403, 'Not authorized to archive this course', 'FORBIDDEN');
    }

    const oldValue = checkResult.rows[0];

    const result = await fastify.db.query(
      'UPDATE courses SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      ['archived', id]
    );

    // Log audit event
    await fastify.auditLog({
      userId,
      action: 'UPDATE',
      resourceType: 'course',
      resourceId: id,
      oldValue,
      newValue: result.rows[0],
      metadata: { action: 'archive' },
      request
    });

    return {
      success: true,
      data: result.rows[0],
      message: 'Course archived successfully'
    };
  });

  /**
   * POST /api/v1/courses/:id/unarchive
   * Unarchive a course (restore to active)
   */
  fastify.post('/:id/unarchive', {
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])]
  }, async (request) => {
    const { id } = request.params;
    const userId = request.user.id;

    const checkResult = await fastify.db.query(
      'SELECT * FROM courses WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      throw fastify.createError(404, 'Course not found', 'COURSE_NOT_FOUND');
    }

    if (checkResult.rows[0].instructor_id !== userId && request.user.role !== 'admin') {
      throw fastify.createError(403, 'Not authorized to unarchive this course', 'FORBIDDEN');
    }

    const oldValue = checkResult.rows[0];

    const result = await fastify.db.query(
      'UPDATE courses SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      ['active', id]
    );

    // Log audit event
    await fastify.auditLog({
      userId,
      action: 'UPDATE',
      resourceType: 'course',
      resourceId: id,
      oldValue,
      newValue: result.rows[0],
      metadata: { action: 'unarchive' },
      request
    });

    return {
      success: true,
      data: result.rows[0],
      message: 'Course restored successfully'
    };
  });

  /**
   * POST /api/v1/courses/:id/regenerate-code
   * Regenerate enrollment code
   */
  fastify.post('/:id/regenerate-code', {
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])]
  }, async (request) => {
    const { id } = request.params;
    const userId = request.user.id;

    const checkResult = await fastify.db.query(
      'SELECT * FROM courses WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      throw fastify.createError(404, 'Course not found', 'COURSE_NOT_FOUND');
    }

    if (checkResult.rows[0].instructor_id !== userId && request.user.role !== 'admin') {
      throw fastify.createError(403, 'Not authorized', 'FORBIDDEN');
    }

    // Generate new unique code
    let enrollmentCode;
    let attempts = 0;
    while (attempts < 10) {
      enrollmentCode = generateEnrollmentCode();
      const exists = await fastify.db.query(
        'SELECT id FROM courses WHERE enrollment_code = $1 AND id != $2',
        [enrollmentCode, id]
      );
      if (exists.rows.length === 0) break;
      attempts++;
    }

    const result = await fastify.db.query(
      'UPDATE courses SET enrollment_code = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [enrollmentCode, id]
    );

    return {
      success: true,
      data: result.rows[0]
    };
  });

  /**
   * GET /api/v1/courses/:id/roster
   * Get course roster (enrolled students)
   */
  fastify.get('/:id/roster', {
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])]
  }, async (request) => {
    const { id } = request.params;
    const { status = 'active', limit = 100, offset = 0 } = request.query;
    const userId = request.user.id;

    // Verify ownership
    const courseCheck = await fastify.db.query(
      'SELECT id FROM courses WHERE id = $1 AND (instructor_id = $2 OR $3 = true)',
      [id, userId, request.user.role === 'admin']
    );

    if (courseCheck.rows.length === 0) {
      throw fastify.createError(404, 'Course not found or access denied', 'COURSE_NOT_FOUND');
    }

    const result = await fastify.db.query(
      `SELECT 
        s.id as student_id,
        s.user_id,
        s.name as student_name,
        s.student_number,
        u.email,
        ce.status as enrollment_status,
        ce.enrolled_at,
        (
          SELECT COUNT(*) 
          FROM submissions sub 
          JOIN assignments a ON sub.assignment_id = a.id 
          WHERE sub.student_id = s.id AND a.course_id = $1
        ) as submissions_count,
        (
          SELECT ROUND(AVG(g.score)::numeric, 1)
          FROM grades g 
          JOIN submissions sub ON g.submission_id = sub.id 
          JOIN assignments a ON sub.assignment_id = a.id 
          WHERE sub.student_id = s.id AND a.course_id = $1
        ) as avg_score
       FROM course_enrollments ce
       JOIN students s ON ce.student_id = s.id
       JOIN users u ON s.user_id = u.id
       WHERE ce.course_id = $1 AND ce.status = $2
       ORDER BY s.name ASC
       LIMIT $3 OFFSET $4`,
      [id, status, limit, offset]
    );

    // Get total count
    const countResult = await fastify.db.query(
      'SELECT COUNT(*) FROM course_enrollments WHERE course_id = $1 AND status = $2',
      [id, status]
    );

    return {
      success: true,
      data: result.rows,
      total: parseInt(countResult.rows[0].count)
    };
  });

  /**
   * POST /api/v1/courses/:id/enroll-student
   * Manually enroll a student (instructor)
   */
  fastify.post('/:id/enroll-student', {
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])],
    schema: {
      body: {
        type: 'object',
        required: ['student_id'],
        properties: {
          student_id: { type: 'string', format: 'uuid' }
        }
      }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    const { student_id } = request.body;
    const userId = request.user.id;

    // Verify course ownership
    const courseCheck = await fastify.db.query(
      'SELECT * FROM courses WHERE id = $1 AND (instructor_id = $2 OR $3 = true)',
      [id, userId, request.user.role === 'admin']
    );

    if (courseCheck.rows.length === 0) {
      throw fastify.createError(404, 'Course not found or access denied', 'COURSE_NOT_FOUND');
    }

    // Verify student exists
    const studentCheck = await fastify.db.query(
      'SELECT id FROM students WHERE id = $1',
      [student_id]
    );

    if (studentCheck.rows.length === 0) {
      throw fastify.createError(404, 'Student not found', 'STUDENT_NOT_FOUND');
    }

    // Check if already enrolled
    const enrollmentCheck = await fastify.db.query(
      'SELECT id, status FROM course_enrollments WHERE course_id = $1 AND student_id = $2',
      [id, student_id]
    );

    if (enrollmentCheck.rows.length > 0) {
      if (enrollmentCheck.rows[0].status === 'active') {
        throw fastify.createError(409, 'Student already enrolled', 'ALREADY_ENROLLED');
      }
      // Re-activate dropped enrollment
      const result = await fastify.db.query(
        `UPDATE course_enrollments 
         SET status = 'active', enrolled_at = NOW(), dropped_at = NULL 
         WHERE course_id = $1 AND student_id = $2 
         RETURNING *`,
        [id, student_id]
      );
      return reply.code(200).send({ success: true, data: result.rows[0] });
    }

    // Check max students
    const course = courseCheck.rows[0];
    const enrolledCount = await fastify.db.query(
      'SELECT COUNT(*) FROM course_enrollments WHERE course_id = $1 AND status = $2',
      [id, 'active']
    );

    if (parseInt(enrolledCount.rows[0].count) >= course.max_students) {
      throw fastify.createError(400, 'Course is full', 'COURSE_FULL');
    }

    const result = await fastify.db.query(
      `INSERT INTO course_enrollments (id, course_id, student_id, status, enrolled_at)
       VALUES ($1, $2, $3, 'active', NOW())
       RETURNING *`,
      [uuidv4(), id, student_id]
    );

    return reply.code(201).send({
      success: true,
      data: result.rows[0]
    });
  });

  /**
   * DELETE /api/v1/courses/:id/students/:studentId
   * Remove student from course (instructor)
   */
  fastify.delete('/:id/students/:studentId', {
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])]
  }, async (request, reply) => {
    const { id, studentId } = request.params;
    const userId = request.user.id;

    // Verify course ownership
    const courseCheck = await fastify.db.query(
      'SELECT id FROM courses WHERE id = $1 AND (instructor_id = $2 OR $3 = true)',
      [id, userId, request.user.role === 'admin']
    );

    if (courseCheck.rows.length === 0) {
      throw fastify.createError(404, 'Course not found or access denied', 'COURSE_NOT_FOUND');
    }

    const result = await fastify.db.query(
      `UPDATE course_enrollments 
       SET status = 'dropped', dropped_at = NOW() 
       WHERE course_id = $1 AND student_id = $2
       RETURNING *`,
      [id, studentId]
    );

    if (result.rows.length === 0) {
      throw fastify.createError(404, 'Enrollment not found', 'ENROLLMENT_NOT_FOUND');
    }

    return reply.code(204).send();
  });

  /**
   * DELETE /api/v1/courses/:id/unenroll
   * Student drops a course
   */
  fastify.delete('/:id/unenroll', {
    preHandler: [fastify.authenticate, fastify.authorize(['student'])]
  }, async (request, reply) => {
    const { id } = request.params;
    const userId = request.user.id;

    // Get student ID
    const studentResult = await fastify.db.query(
      'SELECT id FROM students WHERE user_id = $1',
      [userId]
    );

    if (studentResult.rows.length === 0) {
      throw fastify.createError(404, 'Student profile not found', 'STUDENT_NOT_FOUND');
    }

    const studentId = studentResult.rows[0].id;

    const result = await fastify.db.query(
      `UPDATE course_enrollments 
       SET status = 'dropped', dropped_at = NOW() 
       WHERE course_id = $1 AND student_id = $2 AND status = 'active'
       RETURNING *`,
      [id, studentId]
    );

    if (result.rows.length === 0) {
      throw fastify.createError(404, 'Enrollment not found', 'NOT_ENROLLED');
    }

    // Log audit event
    await fastify.auditLog({
      userId,
      action: 'UNENROLL',
      resourceType: 'course_enrollment',
      resourceId: result.rows[0].id,
      oldValue: { status: 'active' },
      newValue: { status: 'dropped' },
      request
    });

    return reply.code(204).send();
  });

  /**
   * GET /api/v1/courses/:id/assignments
   * Get assignments for a course (student must be enrolled)
   */
  fastify.get('/:id/assignments', { preHandler: [fastify.authenticate] }, async (request) => {
    const { id } = request.params;
    const { role, id: userId } = request.user;
    const { status = 'active' } = request.query;

    // Get course info first (needed for course_code matching)
    const courseResult = await fastify.db.query(
      'SELECT id, code, instructor_id FROM courses WHERE id = $1',
      [id]
    );

    if (courseResult.rows.length === 0) {
      throw fastify.createError(404, 'Course not found', 'COURSE_NOT_FOUND');
    }

    const course = courseResult.rows[0];

    // Authorization
    if (role === 'student') {
      const enrollmentCheck = await fastify.db.query(
        `SELECT ce.id FROM course_enrollments ce
         JOIN students s ON ce.student_id = s.id
         WHERE ce.course_id = $1 AND s.user_id = $2 AND ce.status = 'active'`,
        [id, userId]
      );
      if (enrollmentCheck.rows.length === 0) {
        throw fastify.createError(403, 'Not enrolled in this course', 'NOT_ENROLLED');
      }
    } else {
      if (course.instructor_id !== userId && role !== 'admin') {
        throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
      }
    }

    let query;
    let params;

    if (role === 'student') {
      // Match by course_id OR course_code (for backwards compatibility)
      query = `
        SELECT a.*, r.name as rubric_name,
               (SELECT COUNT(*) FROM submissions sub 
                JOIN students st ON sub.student_id = st.id 
                WHERE sub.assignment_id = a.id AND st.user_id = $2) as my_submissions
        FROM assignments a
        LEFT JOIN rubrics r ON a.rubric_id = r.id
        WHERE (a.course_id = $1 OR (a.course_id IS NULL AND a.course_code = $4))
          AND a.status = $3
        ORDER BY a.due_date ASC NULLS LAST
      `;
      params = [id, userId, status, course.code];
    } else {
      query = `
        SELECT a.*, r.name as rubric_name,
               (SELECT COUNT(*) FROM submissions WHERE assignment_id = a.id) as submission_count,
               (SELECT COUNT(*) FROM submissions WHERE assignment_id = a.id AND status = 'pending') as pending_count
        FROM assignments a
        LEFT JOIN rubrics r ON a.rubric_id = r.id
        WHERE (a.course_id = $1 OR (a.course_id IS NULL AND a.course_code = $3))
        ${status ? 'AND a.status = $2' : ''}
        ORDER BY a.created_at DESC
      `;
      params = status ? [id, status, course.code] : [id, course.code];
    }

    const result = await fastify.db.query(query, params);

    return {
      success: true,
      data: result.rows
    };
  });
}

module.exports = coursesRoutes;
