/**
 * Submissions Routes
 * Student submission management (text assignments)
 */

const { v4: uuidv4 } = require('uuid');

const createSubmissionSchema = {
  body: {
    type: 'object',
    required: ['assignment_id'],
    properties: {
      assignment_id: { type: 'string', format: 'uuid' },
      content: { type: 'string' },
      pdf_url: { type: 'string' },
      file_name: { type: 'string' },
      status: { type: 'string', enum: ['draft', 'submitted'] }
    }
  }
};

async function submissionsRoutes(fastify, options) {
  /**
   * POST /api/v1/submissions
   * Create a new submission or update draft (text submissions)
   */
  fastify.post('/', {
    preHandler: [fastify.authenticate, fastify.authorize(['student'])],
    schema: createSubmissionSchema
  }, async (request, reply) => {
    const { assignment_id, content, pdf_url, status: requestedStatus, file_name } = request.body;
    const userId = request.user.id;
    const isDraft = requestedStatus === 'draft';

    // Validate submission has content (either text or pdf)
    if (!content && !pdf_url) {
      throw fastify.createError(400, 'Submission must have text content or PDF', 'CONTENT_REQUIRED');
    }

    // Get student record
    const studentResult = await fastify.db.query(
      'SELECT id FROM students WHERE user_id = $1',
      [userId]
    );

    if (studentResult.rows.length === 0) {
      throw fastify.createError(404, 'Student record not found', 'STUDENT_NOT_FOUND');
    }

    const studentId = studentResult.rows[0].id;

    // Check assignment exists and is active
    const assignmentResult = await fastify.db.query(
      `SELECT id, title, max_resubmissions, status, due_date, course_id, course_code 
       FROM assignments WHERE id = $1`,
      [assignment_id]
    );

    if (assignmentResult.rows.length === 0) {
      throw fastify.createError(404, 'Assignment not found', 'ASSIGNMENT_NOT_FOUND');
    }

    const assignment = assignmentResult.rows[0];

    if (assignment.status !== 'active') {
      throw fastify.createError(400, 'Assignment is not active', 'ASSIGNMENT_INACTIVE');
    }

    // Check if student is enrolled in the course (if assignment has a course)
    if (assignment.course_id || assignment.course_code) {
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

    // Check for existing draft - if saving a draft, update the existing one instead of creating new
    const existingDraftResult = await fastify.db.query(
      `SELECT id, version FROM submissions 
       WHERE student_id = $1 AND assignment_id = $2 AND status = 'draft'
       ORDER BY version DESC LIMIT 1`,
      [studentId, assignment_id]
    );

    // If saving a draft and one already exists, update it
    if (isDraft && existingDraftResult.rows.length > 0) {
      const existingDraft = existingDraftResult.rows[0];
      const result = await fastify.db.query(
        `UPDATE submissions 
         SET content = $1, pdf_url = $2, file_name = $3, submitted_at = NOW()
         WHERE id = $4
         RETURNING id, student_id, assignment_id, content, pdf_url, file_name, version, status, submitted_at`,
        [content || null, pdf_url || null, file_name || null, existingDraft.id]
      );
      
      return reply.code(200).send({
        success: true,
        data: result.rows[0],
        message: 'Draft saved'
      });
    }

    // Check submission count (excluding drafts for attempt counting)
    const countResult = await fastify.db.query(
      `SELECT COUNT(*) as count FROM submissions 
       WHERE student_id = $1 AND assignment_id = $2 AND status != 'draft'`,
      [studentId, assignment_id]
    );

    const submissionCount = parseInt(countResult.rows[0].count);
    
    // Get total versions for versioning (including drafts)
    const versionResult = await fastify.db.query(
      `SELECT COALESCE(MAX(version), 0) as max_version FROM submissions 
       WHERE student_id = $1 AND assignment_id = $2`,
      [studentId, assignment_id]
    );
    const version = parseInt(versionResult.rows[0].max_version) + 1;

    // Only check max resubmissions for actual submissions (not drafts)
    if (!isDraft && submissionCount >= assignment.max_resubmissions) {
      throw fastify.createError(400, 'Maximum resubmissions reached', 'MAX_RESUBMISSIONS');
    }

    // Check if any previous submission has been graded - no resubmission allowed after grading (for actual submissions only)
    if (!isDraft) {
      const gradedCheck = await fastify.db.query(
        `SELECT s.id FROM submissions s
         WHERE s.student_id = $1 AND s.assignment_id = $2 AND s.status = 'graded'
         LIMIT 1`,
        [studentId, assignment_id]
      );

      if (gradedCheck.rows.length > 0) {
        throw fastify.createError(400, 'Cannot resubmit after your submission has been graded', 'ALREADY_GRADED');
      }
    }

    // Check if submission is late
    const isLate = assignment.due_date ? new Date() > new Date(assignment.due_date) : false;

    // Create submission (draft or submitted based on request)
    const submissionStatus = isDraft ? 'draft' : 'submitted';
    const result = await fastify.db.query(
      `INSERT INTO submissions (id, student_id, assignment_id, content, pdf_url, file_name, version, status, is_late, submitted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       RETURNING id, student_id, assignment_id, content, pdf_url, file_name, version, status, is_late, submitted_at`,
      [uuidv4(), studentId, assignment_id, content || null, pdf_url || null, file_name || null, version, submissionStatus, isLate]
    );

    const submission = result.rows[0];

    // TODO: Trigger AI grading service asynchronously (only for actual submissions)

    return reply.code(201).send({
      success: true,
      data: submission
    });
  });

  /**
   * GET /api/v1/submissions
   * List submissions (filtered by role)
   */
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { role, id: userId } = request.user;
    const { assignment_id, status, limit = 50, offset = 0 } = request.query;

    let query;
    let params;

    if (role === 'student') {
      // Students see only their submissions
      const studentResult = await fastify.db.query(
        'SELECT id FROM students WHERE user_id = $1',
        [userId]
      );

      if (studentResult.rows.length === 0) {
        return { success: true, data: [] };
      }

      // Build query with proper parameter handling
      const studentId = studentResult.rows[0].id;
      let paramIndex = 1;
      params = [studentId];
      
      let whereClause = `WHERE s.student_id = $${paramIndex++}`;
      if (assignment_id) {
        whereClause += ` AND s.assignment_id = $${paramIndex++}`;
        params.push(assignment_id);
      }
      if (status) {
        whereClause += ` AND s.status = $${paramIndex++}`;
        params.push(status);
      }
      
      params.push(limit, offset);

      query = `
        SELECT s.*, a.title as assignment_title, a.total_points,
               g.score, g.feedback, g.graded_at
        FROM submissions s
        JOIN assignments a ON s.assignment_id = a.id
        LEFT JOIN grades g ON s.id = g.submission_id
        ${whereClause}
        ORDER BY s.submitted_at DESC
        LIMIT $${paramIndex++}
        OFFSET $${paramIndex}
      `;
    } else {
      // Instructors see submissions for their assignments
      // Only show the LATEST submission per student per assignment (highest version)
      // Build query with proper parameter handling
      let paramIndex = 1;
      params = [userId];
      
      let whereClause = `WHERE a.instructor_id = $${paramIndex++} AND s.status != 'draft'`;
      if (assignment_id) {
        whereClause += ` AND s.assignment_id = $${paramIndex++}`;
        params.push(assignment_id);
      }
      if (status) {
        // Handle 'submitted' status to also include legacy 'pending' records
        if (status === 'submitted') {
          whereClause += ` AND (s.status = 'submitted' OR s.status = 'pending')`;
        } else {
          whereClause += ` AND s.status = $${paramIndex++}`;
          params.push(status);
        }
      }
      
      params.push(limit, offset);

      // Use a subquery to get only the latest submission (max version) per student per assignment
      query = `
        SELECT s.*, st.name as student_name, a.title as assignment_title, a.total_points,
               g.score, g.feedback, g.graded_at
        FROM submissions s
        JOIN students st ON s.student_id = st.id
        JOIN assignments a ON s.assignment_id = a.id
        LEFT JOIN grades g ON s.id = g.submission_id
        INNER JOIN (
          SELECT student_id, assignment_id, MAX(version) as max_version
          FROM submissions
          WHERE status != 'draft'
          GROUP BY student_id, assignment_id
        ) latest ON s.student_id = latest.student_id 
                 AND s.assignment_id = latest.assignment_id 
                 AND s.version = latest.max_version
        ${whereClause}
        ORDER BY s.submitted_at DESC
        LIMIT $${paramIndex++}
        OFFSET $${paramIndex}
      `;
    }

    const result = await fastify.db.query(query, params);

    return {
      success: true,
      data: result.rows
    };
  });

  /**
   * GET /api/v1/submissions/:id
   * Get submission by ID (includes grade data if graded)
   */
  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request) => {
    const { id } = request.params;
    const { role, id: userId } = request.user;

    const result = await fastify.db.query(
      `SELECT s.id, s.student_id, s.assignment_id, s.content, s.pdf_url, s.file_name,
              s.image_url, s.submission_type, s.is_late,
              s.version, s.status, s.submitted_at,
              st.name as student_name, st.user_id as student_user_id,
              a.title as assignment_title, a.instructor_id, a.due_date, a.total_points,
              a.course_code, a.description as assignment_description, a.rubric_id,
              g.score, g.feedback, g.graded_at, g.graded_by, g.confidence
       FROM submissions s
       JOIN students st ON s.student_id = st.id
       JOIN assignments a ON s.assignment_id = a.id
       LEFT JOIN grades g ON s.id = g.submission_id
       WHERE s.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      throw fastify.createError(404, 'Submission not found', 'SUBMISSION_NOT_FOUND');
    }

    const submission = result.rows[0];
    
    // Map pdf_url to file_url for frontend compatibility
    submission.file_url = submission.pdf_url;
    // Map rubric_id to rubricId for frontend compatibility (camelCase)
    submission.rubricId = submission.rubric_id;

    // Authorization check
    if (role === 'student' && submission.student_user_id !== userId) {
      throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
    }

    if (role === 'instructor' && submission.instructor_id !== userId) {
      throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
    }

    return {
      success: true,
      data: submission
    };
  });

  /**
   * POST /api/v1/submissions/:id/grade
   * Grade a submission (manual or auto-grade)
   */
  fastify.post('/:id/grade', {
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])]
  }, async (request) => {
    const { id } = request.params;
    const { score, feedback, autoGrade } = request.body;
    const userId = request.user.id;

    // Get submission with assignment info
    const submissionResult = await fastify.db.query(
      `SELECT s.*, a.instructor_id, a.total_points, a.rubric_id, a.description as assignment_description,
              st.name as student_name
       FROM submissions s
       JOIN assignments a ON s.assignment_id = a.id
       JOIN students st ON s.student_id = st.id
       WHERE s.id = $1`,
      [id]
    );

    if (submissionResult.rows.length === 0) {
      throw fastify.createError(404, 'Submission not found', 'SUBMISSION_NOT_FOUND');
    }

    const submission = submissionResult.rows[0];

    // Authorization check
    if (submission.instructor_id !== userId) {
      throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
    }

    let gradeScore = score;
    let gradeFeedback = feedback;

    // Auto-grade using AI if requested
    if (autoGrade) {
      try {
        const gradingService = require('../services/grading-service');
        const result = await gradingService.gradeSubmission({
          submissionContent: submission.content,
          assignmentDescription: submission.assignment_description,
          totalPoints: submission.total_points,
          rubricId: submission.rubric_id
        });
        gradeScore = result.score;
        gradeFeedback = result.feedback;
      } catch (error) {
        fastify.log.error('Auto-grade failed:', error);
        throw fastify.createError(500, 'Auto-grading failed. Please try manual grading.', 'AUTOGRADE_FAILED');
      }
    }

    // Validate score
    if (gradeScore === undefined || gradeScore === null) {
      throw fastify.createError(400, 'Score is required', 'SCORE_REQUIRED');
    }

    if (gradeScore < 0 || gradeScore > submission.total_points) {
      throw fastify.createError(400, `Score must be between 0 and ${submission.total_points}`, 'INVALID_SCORE');
    }

    // Check if grade already exists
    const existingGrade = await fastify.db.query(
      'SELECT id FROM grades WHERE submission_id = $1',
      [id]
    );

    let gradeResult;

    if (existingGrade.rows.length > 0) {
      // Update existing grade
      gradeResult = await fastify.db.query(
        `UPDATE grades 
         SET score = $1, feedback = $2, graded_by = $3, graded_at = NOW()
         WHERE submission_id = $4
         RETURNING *`,
        [gradeScore, gradeFeedback || '', userId, id]
      );
    } else {
      // Create new grade
      gradeResult = await fastify.db.query(
        `INSERT INTO grades (id, submission_id, score, feedback, graded_by, graded_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING *`,
        [uuidv4(), id, gradeScore, gradeFeedback || '', userId]
      );
    }

    // Update submission status
    await fastify.db.query(
      `UPDATE submissions SET status = 'graded' WHERE id = $1`,
      [id]
    );

    return {
      success: true,
      data: gradeResult.rows[0]
    };
  });

  /**
   * POST /api/v1/submissions/:id/ai-preview
   * Get AI grade preview without saving (for instructor review)
   */
  fastify.post('/:id/ai-preview', {
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])]
  }, async (request) => {
    const { id } = request.params;
    const userId = request.user.id;

    // Get submission with assignment info including reference answer
    const submissionResult = await fastify.db.query(
      `SELECT s.*, a.instructor_id, a.total_points, a.rubric_id, a.description as assignment_description,
              a.reference_answer, a.reference_text_extracted,
              st.name as student_name
       FROM submissions s
       JOIN assignments a ON s.assignment_id = a.id
       JOIN students st ON s.student_id = st.id
       WHERE s.id = $1`,
      [id]
    );

    if (submissionResult.rows.length === 0) {
      throw fastify.createError(404, 'Submission not found', 'SUBMISSION_NOT_FOUND');
    }

    const submission = submissionResult.rows[0];

    // Authorization check
    if (submission.instructor_id !== userId) {
      throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
    }

    // Get AI grade preview (does NOT save to database)
    try {
      const gradingService = require('../services/grading-service');
      const fileService = require('../services/file-service');
      const path = require('path');
      const fs = require('fs').promises;
      
      // Use reference_text_extracted (from PDF) if available, otherwise use text reference_answer
      const referenceAnswer = submission.reference_text_extracted || submission.reference_answer || '';
      
      // Get submission content - extract from PDF if content is empty but pdf_url exists
      let submissionContent = submission.content;
      
      if ((!submissionContent || submissionContent.trim().length === 0) && submission.pdf_url) {
        // Try to extract text from the PDF file
        try {
          const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
          const pdfPath = path.join(UPLOAD_DIR, submission.pdf_url.replace(/^\/api\/v1\/files\//, ''));
          const pdfBuffer = await fs.readFile(pdfPath);
          submissionContent = await fileService.extractTextFromPdf(pdfBuffer);
          
          // Optionally update the submission content in DB for future use
          await fastify.db.query(
            'UPDATE submissions SET content = $1 WHERE id = $2',
            [submissionContent, id]
          );
          
          fastify.log.info({ submissionId: id }, 'Extracted text from submission PDF');
        } catch (pdfErr) {
          fastify.log.error({ submissionId: id, error: pdfErr.message }, 'Failed to extract text from submission PDF');
          throw new Error('Unable to extract text from the submitted PDF. The PDF may be image-based or corrupted.');
        }
      }
      
      // Log grading attempt (development only for detailed info)
      if (process.env.NODE_ENV === 'development') {
        fastify.log.debug({
          submissionId: id,
          hasContent: !!submissionContent,
          contentLength: submissionContent?.length || 0,
          hasReference: !!(submission.reference_text_extracted || submission.reference_answer),
        }, 'Processing AI preview');
      }
      
      const result = await gradingService.gradeSubmission({
        submissionContent: submissionContent,
        assignmentDescription: submission.assignment_description,
        referenceAnswer: referenceAnswer,
        totalPoints: submission.total_points,
        rubricId: submission.rubric_id,
        db: fastify.db,
        submissionType: submission.submission_type,
        imageUrl: submission.image_url
      });

      return {
        success: true,
        data: {
          score: result.score,
          feedback: result.feedback,
          confidence: result.confidence,
          preview: true // Indicates this is a preview, not saved
        }
      };
    } catch (error) {
      fastify.log.error('AI preview failed:', error);
      // Return more specific error message
      const errorMessage = error.message || 'AI grading preview failed. Please try again.';
      throw fastify.createError(500, errorMessage, 'AI_PREVIEW_FAILED');
    }
  });

  /**
   * GET /api/v1/submissions/history/:assignmentId
   * Get submission version history for a student on an assignment
   * Returns all versions with scores and timestamps for version timeline display
   */
  fastify.get('/history/:assignmentId', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { assignmentId } = request.params;
    const { role, id: userId } = request.user;

    // Get student ID for the current user
    const studentResult = await fastify.db.query(
      'SELECT id FROM students WHERE user_id = $1',
      [userId]
    );

    if (studentResult.rows.length === 0 && role === 'student') {
      return { success: true, data: { versions: [], maxAttempts: 0, usedAttempts: 0 } };
    }

    const studentId = studentResult.rows[0]?.id;

    // Get assignment details for max resubmissions
    const assignmentResult = await fastify.db.query(
      `SELECT id, title, max_resubmissions, total_points, status FROM assignments WHERE id = $1`,
      [assignmentId]
    );

    if (assignmentResult.rows.length === 0) {
      throw fastify.createError(404, 'Assignment not found', 'ASSIGNMENT_NOT_FOUND');
    }

    const assignment = assignmentResult.rows[0];

    // Get all submissions for this student/assignment (including drafts for student, excluding for instructor)
    let query;
    let params;

    if (role === 'student') {
      query = `
        SELECT s.id, s.version, s.status, s.submitted_at, s.is_late,
               g.score, g.feedback, g.graded_at
        FROM submissions s
        LEFT JOIN grades g ON s.id = g.submission_id
        WHERE s.student_id = $1 AND s.assignment_id = $2
        ORDER BY s.version ASC
      `;
      params = [studentId, assignmentId];
    } else {
      // Instructors can query for a specific student
      const { studentId: queryStudentId } = request.query;
      if (!queryStudentId) {
        throw fastify.createError(400, 'Student ID required for instructor view', 'STUDENT_ID_REQUIRED');
      }
      query = `
        SELECT s.id, s.version, s.status, s.submitted_at, s.is_late,
               g.score, g.feedback, g.graded_at, st.name as student_name
        FROM submissions s
        LEFT JOIN grades g ON s.id = g.submission_id
        JOIN students st ON s.student_id = st.id
        WHERE s.student_id = $1 AND s.assignment_id = $2 AND s.status != 'draft'
        ORDER BY s.version ASC
      `;
      params = [queryStudentId, assignmentId];
    }

    const versionsResult = await fastify.db.query(query, params);

    // Count actual submissions (not drafts) for attempt tracking
    const submittedCount = versionsResult.rows.filter(v => v.status !== 'draft').length;
    const isGraded = versionsResult.rows.some(v => v.status === 'graded');
    const latestSubmission = versionsResult.rows[versionsResult.rows.length - 1];

    // Calculate remaining attempts
    const maxAttempts = assignment.max_resubmissions + 1; // +1 for initial submission
    const remainingAttempts = Math.max(0, maxAttempts - submittedCount);
    const canResubmit = !isGraded && remainingAttempts > 0 && assignment.status === 'active';

    return {
      success: true,
      data: {
        assignmentId,
        assignmentTitle: assignment.title,
        totalPoints: assignment.total_points,
        versions: versionsResult.rows.map(v => ({
          id: v.id,
          version: v.version,
          status: v.status,
          submittedAt: v.submitted_at,
          isLate: v.is_late,
          score: v.score,
          feedback: v.feedback,
          gradedAt: v.graded_at,
          isLatest: v.id === latestSubmission?.id
        })),
        summary: {
          maxAttempts,
          usedAttempts: submittedCount,
          remainingAttempts,
          isGraded,
          canResubmit,
          latestVersion: latestSubmission?.version || 0,
          latestScore: latestSubmission?.score
        }
      }
    };
  });
}

module.exports = submissionsRoutes;
