/**
 * File Upload Routes
 * Handle file uploads for submissions
 */

const { saveFile, readFile } = require('../services/file-service');
const path = require('path');
const fs = require('fs').promises;

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

async function filesRoutes(fastify, options) {
  /**
   * POST /api/v1/files/upload
   * Upload a file (PDF, TXT, CSV)
   */
  fastify.post('/upload', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const userId = request.user.id;

    try {
      const data = await request.file();
      
      if (!data) {
        throw fastify.createError(400, 'No file uploaded', 'NO_FILE');
      }

      const chunks = [];
      for await (const chunk of data.file) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      const result = await saveFile(buffer, data.filename, userId);

      // Return URL that can be used to access the file
      const fileUrl = `/api/v1/files/${userId}/${result.filename}`;

      return reply.code(201).send({
        success: true,
        data: {
          filename: result.filename,
          originalName: data.filename,
          url: fileUrl,
          size: result.size
        }
      });
    } catch (err) {
      fastify.log.error('File upload failed:', err);
      throw fastify.createError(400, err.message || 'File upload failed', 'UPLOAD_FAILED');
    }
  });

  /**
   * GET /api/v1/files/public/assignment/:assignmentId/question
   * Serve the question PDF for an assignment (for enrolled students)
   * IMPORTANT: This specific route MUST be defined BEFORE the generic /:userId/:filename route
   * because Fastify matches routes in registration order
   */
  fastify.get('/public/assignment/:assignmentId/question', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { assignmentId } = request.params;
    const { id: userId, role } = request.user;

    try {
      // Get the assignment and verify access
      const assignmentResult = await fastify.db.query(
        'SELECT question_pdf_url, instructor_id, course_id, course_code, status FROM assignments WHERE id = $1',
        [assignmentId]
      );

      if (assignmentResult.rows.length === 0) {
        throw fastify.createError(404, 'Assignment not found', 'ASSIGNMENT_NOT_FOUND');
      }

      const assignment = assignmentResult.rows[0];

      if (!assignment.question_pdf_url) {
        throw fastify.createError(404, 'No question PDF for this assignment', 'NO_QUESTION_PDF');
      }

      // Check access: instructors can see their own, students must be enrolled
      if (role === 'instructor' || role === 'admin') {
        if (role === 'instructor' && assignment.instructor_id !== userId) {
          throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
        }
      } else if (role === 'student') {
        // Verify student is enrolled
        const studentResult = await fastify.db.query(
          'SELECT id FROM students WHERE user_id = $1',
          [userId]
        );

        if (studentResult.rows.length === 0) {
          throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
        }

        const studentId = studentResult.rows[0].id;
        let isEnrolled = false;

        if (assignment.course_id) {
          const enrollmentCheck = await fastify.db.query(
            `SELECT id FROM course_enrollments 
             WHERE course_id = $1 AND student_id = $2 AND status = 'active'`,
            [assignment.course_id, studentId]
          );
          isEnrolled = enrollmentCheck.rows.length > 0;
        }

        if (!isEnrolled && assignment.course_code) {
          const enrollmentCheck = await fastify.db.query(
            `SELECT ce.id FROM course_enrollments ce
             JOIN courses c ON ce.course_id = c.id
             WHERE c.code = $1 AND ce.student_id = $2 AND ce.status = 'active'`,
            [assignment.course_code, studentId]
          );
          isEnrolled = enrollmentCheck.rows.length > 0;
        }

        // Allow if no course (open assignment) or if enrolled
        if (assignment.course_id && assignment.course_code && !isEnrolled) {
          throw fastify.createError(403, 'Not enrolled in this course', 'NOT_ENROLLED');
        }
      }

      // Read and serve the file
      // Handle both old format (full path) and new format (relative path)
      let pdfPath = assignment.question_pdf_url;
      
      // Remove leading slash if present
      pdfPath = pdfPath.replace(/^\//, '');
      
      // Remove 'uploads/' or './uploads/' prefix if present (for old-format paths)
      pdfPath = pdfPath.replace(/^\.?\/?(uploads[\/\\])?/, '');
      
      const filePath = path.join(UPLOAD_DIR, pdfPath);
      fastify.log.debug({ pdfPath, filePath, originalUrl: assignment.question_pdf_url }, 'Serving question PDF');
      
      const buffer = await readFile(filePath);

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="question.pdf"`)
        .header('Cache-Control', 'private, max-age=3600')
        .send(buffer);
    } catch (err) {
      if (err.statusCode) throw err;
      if (err.message === 'File not found') {
        throw fastify.createError(404, 'Question PDF not found', 'FILE_NOT_FOUND');
      }
      fastify.log.error('Error serving question PDF:', err);
      throw fastify.createError(500, 'Failed to serve file', 'SERVER_ERROR');
    }
  });

  /**
   * GET /api/v1/files/:userId/:filename
   * Serve an uploaded file
   * NOTE: This generic route must come AFTER more specific routes like /public/assignment/:id/question
   */
  fastify.get('/:userId/:filename', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { userId, filename } = request.params;
    const currentUserId = request.user.id;
    const userRole = request.user.role;

    // Security: Only allow access to own files or instructor/admin access
    if (userId !== currentUserId && userRole !== 'instructor' && userRole !== 'admin') {
      throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
    }

    try {
      const filePath = path.join(UPLOAD_DIR, userId, filename);
      const buffer = await readFile(filePath);
      
      // Determine content type based on extension
      const ext = path.extname(filename).toLowerCase();
      const contentTypes = {
        '.pdf': 'application/pdf',
        '.txt': 'text/plain',
        '.csv': 'text/csv'
      };
      
      const contentType = contentTypes[ext] || 'application/octet-stream';
      
      return reply
        .header('Content-Type', contentType)
        .header('Content-Disposition', `inline; filename="${filename}"`)
        .send(buffer);
    } catch (err) {
      if (err.message === 'File not found') {
        throw fastify.createError(404, 'File not found', 'FILE_NOT_FOUND');
      }
      throw err;
    }
  });
}

module.exports = filesRoutes;
