/**
 * Users Routes
 * User profile management
 */

const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

async function usersRoutes(fastify, options) {
  /**
   * GET /api/v1/users/students
   * List all students (for instructors)
   */
  fastify.get('/students', { 
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])] 
  }, async (request) => {
    const { course_code, search, limit = 100, offset = 0 } = request.query;
    const instructorId = request.user.id;

    let query = `
      SELECT DISTINCT
        s.id as student_id,
        s.user_id,
        s.name as student_name,
        s.student_number,
        s.section,
        u.email,
        s.created_at,
        COUNT(DISTINCT sub.id) as total_submissions,
        COUNT(DISTINCT sub.assignment_id) as assignments_submitted,
        COUNT(DISTINCT CASE WHEN sub.status = 'graded' THEN sub.id END) as graded_count,
        AVG(g.score) as avg_score,
        MAX(sub.submitted_at) as last_active,
        ARRAY_AGG(DISTINCT c.code) FILTER (WHERE c.code IS NOT NULL) as courses
      FROM students s
      JOIN users u ON s.user_id = u.id
      LEFT JOIN course_enrollments ce ON ce.student_id = s.id AND ce.status = 'active'
      LEFT JOIN courses c ON c.id = ce.course_id AND c.instructor_id = $1
      LEFT JOIN submissions sub ON sub.student_id = s.id
      LEFT JOIN assignments a ON sub.assignment_id = a.id AND a.instructor_id = $1
      LEFT JOIN grades g ON g.submission_id = sub.id
      WHERE (c.instructor_id = $1 OR a.instructor_id = $1)
    `;

    let params = [instructorId];
    let paramIndex = 2;

    // Filter by course if provided
    if (course_code) {
      query += ` AND c.code = $${paramIndex}`;
      params.push(course_code);
      paramIndex++;
    }

    // Search by name or email
    if (search) {
      query += ` AND (s.name ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    query += `
      GROUP BY s.id, s.user_id, s.name, s.student_number, s.section, u.email, s.created_at
      ORDER BY s.name ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limit, offset);

    const result = await fastify.db.query(query, params);

    // Calculate status based on avg score
    const students = result.rows.map(row => ({
      ...row,
      avg_score: row.avg_score ? Math.round(parseFloat(row.avg_score)) : null,
      status: row.avg_score && parseFloat(row.avg_score) < 60 ? 'at-risk' : 'active',
      courses: row.courses || []
    }));

    return {
      success: true,
      data: students
    };
  });

  /**
   * GET /api/v1/users/profile
   * Get current user profile
   */
  fastify.get('/profile', { preHandler: [fastify.authenticate] }, async (request) => {
    const userId = request.user.id;

    const result = await fastify.db.query(
      `SELECT id, email, name, role, avatar_url, title, department, institution, bio, office_hours, created_at, updated_at
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      throw fastify.createError(404, 'User not found', 'USER_NOT_FOUND');
    }

    // Get additional info based on role
    const user = result.rows[0];

    if (user.role === 'student') {
      const studentResult = await fastify.db.query(
        `SELECT s.id as student_id, s.student_number, s.section, s.major,
                (SELECT COUNT(*) FROM submissions WHERE student_id = s.id) as total_submissions,
                (SELECT AVG(g.score) FROM grades g JOIN submissions sub ON g.submission_id = sub.id WHERE sub.student_id = s.id) as average_score
         FROM students s WHERE s.user_id = $1`,
        [userId]
      );

      if (studentResult.rows.length > 0) {
        user.student_info = studentResult.rows[0];
        user.student_id = studentResult.rows[0].student_number;
        user.major = studentResult.rows[0].major;
      }
    } else if (user.role === 'instructor') {
      const instructorResult = await fastify.db.query(
        `SELECT 
           (SELECT COUNT(*) FROM assignments WHERE instructor_id = $1) as total_assignments,
           (SELECT COUNT(*) FROM submissions s JOIN assignments a ON s.assignment_id = a.id WHERE a.instructor_id = $1) as total_submissions_received
         `,
        [userId]
      );

      user.instructor_stats = instructorResult.rows[0];
    }

    return {
      success: true,
      data: user
    };
  });

  /**
   * PUT /api/v1/users/profile
   * Update current user profile
   */
  fastify.put('/profile', { preHandler: [fastify.authenticate] }, async (request) => {
    const userId = request.user.id;
    const { name, title, department, institution, bio, office_hours, avatar_url, major, student_id } = request.body;

    // Update user table
    const result = await fastify.db.query(
      `UPDATE users SET
         name = COALESCE($1, name),
         title = COALESCE($2, title),
         department = COALESCE($3, department),
         institution = COALESCE($4, institution),
         bio = COALESCE($5, bio),
         office_hours = COALESCE($6, office_hours),
         avatar_url = COALESCE($7, avatar_url),
         updated_at = NOW()
       WHERE id = $8
       RETURNING id, email, name, role, avatar_url, title, department, institution, bio, office_hours, updated_at`,
      [name, title, department, institution, bio, office_hours, avatar_url, userId]
    );

    const user = result.rows[0];

    // If student, also update student-specific fields
    if (user.role === 'student') {
      await fastify.db.query(
        `UPDATE students SET
           major = COALESCE($1, major),
           student_number = COALESCE($2, student_number)
         WHERE user_id = $3`,
        [major, student_id, userId]
      );
      user.major = major;
      user.student_id = student_id;
    }

    return {
      success: true,
      data: user
    };
  });

  /**
   * POST /api/v1/users/avatar
   * Upload profile avatar
   */
  fastify.post('/avatar', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;

    try {
      const data = await request.file();
      
      if (!data) {
        throw fastify.createError(400, 'No file uploaded', 'NO_FILE');
      }

      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(data.mimetype)) {
        throw fastify.createError(400, 'Invalid file type. Allowed: JPG, PNG, GIF, WebP', 'INVALID_FILE_TYPE');
      }

      // Read file buffer
      const chunks = [];
      for await (const chunk of data.file) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      // Validate file size (max 5MB)
      if (buffer.length > 5 * 1024 * 1024) {
        throw fastify.createError(400, 'File size exceeds 5MB limit', 'FILE_TOO_LARGE');
      }

      // Create avatars directory
      const avatarsDir = path.join(UPLOAD_DIR, 'avatars');
      await fs.mkdir(avatarsDir, { recursive: true });

      // Generate unique filename
      const ext = path.extname(data.filename).toLowerCase() || '.jpg';
      const hash = crypto.createHash('md5').update(buffer).digest('hex').slice(0, 8);
      const filename = `${userId}-${Date.now()}-${hash}${ext}`;
      const filePath = path.join(avatarsDir, filename);

      // Save file
      await fs.writeFile(filePath, buffer);

      // Update user's avatar_url
      const avatarUrl = `/api/v1/users/avatar/${filename}`;
      await fastify.db.query(
        'UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2',
        [avatarUrl, userId]
      );

      return reply.code(201).send({
        success: true,
        data: {
          avatar_url: avatarUrl
        }
      });
    } catch (err) {
      fastify.log.error('Avatar upload failed:', err);
      if (err.statusCode) throw err;
      throw fastify.createError(400, err.message || 'Avatar upload failed', 'UPLOAD_FAILED');
    }
  });

  /**
   * GET /api/v1/users/avatar/:filename
   * Serve avatar image
   */
  fastify.get('/avatar/:filename', async (request, reply) => {
    const { filename } = request.params;

    // Validate filename to prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw fastify.createError(400, 'Invalid filename', 'INVALID_FILENAME');
    }

    try {
      const filePath = path.join(UPLOAD_DIR, 'avatars', filename);
      const buffer = await fs.readFile(filePath);
      
      // Determine content type
      const ext = path.extname(filename).toLowerCase();
      const contentTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp'
      };
      
      const contentType = contentTypes[ext] || 'image/jpeg';
      
      return reply
        .header('Content-Type', contentType)
        .header('Cache-Control', 'public, max-age=86400')
        .send(buffer);
    } catch (err) {
      if (err.code === 'ENOENT') {
        throw fastify.createError(404, 'Avatar not found', 'AVATAR_NOT_FOUND');
      }
      throw err;
    }
  });

  /**
   * PUT /api/v1/users/password
   * Change password
   */
  fastify.put('/password', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    const { current_password, new_password } = request.body;

    if (!current_password || !new_password) {
      throw fastify.createError(400, 'Current and new password required', 'VALIDATION_ERROR');
    }

    if (new_password.length < 8) {
      throw fastify.createError(400, 'New password must be at least 8 characters', 'VALIDATION_ERROR');
    }

    // Verify current password
    const userResult = await fastify.db.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      throw fastify.createError(404, 'User not found', 'USER_NOT_FOUND');
    }

    const isValid = await bcrypt.compare(current_password, userResult.rows[0].password_hash);

    if (!isValid) {
      throw fastify.createError(401, 'Current password is incorrect', 'INVALID_PASSWORD');
    }

    // Hash and update new password
    const newHash = await bcrypt.hash(new_password, 12);

    await fastify.db.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [newHash, userId]
    );

    return {
      success: true,
      message: 'Password updated successfully'
    };
  });

  /**
   * GET /api/v1/users/stats
   * Get user statistics
   */
  fastify.get('/stats', { preHandler: [fastify.authenticate] }, async (request) => {
    const { role, id: userId } = request.user;

    let stats;

    if (role === 'student') {
      const result = await fastify.db.query(
        `SELECT 
           s.id as student_id,
           COUNT(DISTINCT sub.id) as total_submissions,
           COUNT(DISTINCT sub.assignment_id) as assignments_attempted,
           AVG(g.score) as average_score,
           MAX(g.score) as highest_score,
           MIN(g.score) as lowest_score,
           COUNT(CASE WHEN sub.status IN ('pending', 'submitted') THEN 1 END) as pending_grades
         FROM students s
         LEFT JOIN submissions sub ON sub.student_id = s.id
         LEFT JOIN grades g ON g.submission_id = sub.id
         WHERE s.user_id = $1
         GROUP BY s.id`,
        [userId]
      );

      stats = result.rows[0] || {
        total_submissions: 0,
        assignments_attempted: 0,
        average_score: null,
        pending_grades: 0
      };
    } else {
      const result = await fastify.db.query(
        `SELECT 
           COUNT(DISTINCT a.id) as total_assignments,
           COUNT(DISTINCT CASE WHEN a.status = 'active' THEN a.id END) as active_assignments,
           COUNT(DISTINCT sub.id) as total_submissions,
           COUNT(DISTINCT CASE WHEN sub.status IN ('pending', 'submitted') THEN sub.id END) as pending_submissions,
           COUNT(DISTINCT g.id) as total_graded,
           AVG(g.score) as average_class_score
         FROM assignments a
         LEFT JOIN submissions sub ON sub.assignment_id = a.id
         LEFT JOIN grades g ON g.submission_id = sub.id
         WHERE a.instructor_id = $1`,
        [userId]
      );

      stats = result.rows[0];
    }

    return {
      success: true,
      data: stats
    };
  });
}

module.exports = usersRoutes;
