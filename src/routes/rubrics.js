/**
 * Rubrics Routes
 * Rubric management (CRUD)
 */

const { v4: uuidv4 } = require('uuid');

const createRubricSchema = {
  body: {
    type: 'object',
    required: ['name', 'criteria', 'total_points'],
    properties: {
      name: { type: 'string', minLength: 1 },
      description: { type: 'string' },
      type: { type: 'string', enum: ['essay', 'coding', 'quiz', 'lab', 'other'] },
      criteria: { type: 'object' },
      total_points: { type: 'integer', minimum: 1 },
      is_template: { type: 'boolean' }
    }
  }
};

async function rubricsRoutes(fastify, options) {
  /**
   * POST /api/v1/rubrics
   * Create a new rubric
   */
  fastify.post('/', {
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])],
    schema: createRubricSchema
  }, async (request, reply) => {
    const { name, description, type, criteria, total_points, is_template } = request.body;
    const userId = request.user.id;

    const result = await fastify.db.query(
      `INSERT INTO rubrics (id, name, description, type, criteria, total_points, is_template, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       RETURNING *`,
      [uuidv4(), name, description || null, type || 'other', JSON.stringify(criteria), total_points, is_template || false, userId]
    );

    return reply.code(201).send({
      success: true,
      data: result.rows[0]
    });
  });

  /**
   * GET /api/v1/rubrics
   * List rubrics (user's own + templates)
   */
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const userId = request.user.id;
    const { type, is_template, limit = 50, offset = 0 } = request.query;

    let whereConditions = ['(created_by = $1 OR is_template = true)'];
    let params = [userId];
    let paramIndex = 2;

    if (type) {
      whereConditions.push(`type = $${paramIndex}`);
      params.push(type);
      paramIndex++;
    }

    if (is_template !== undefined) {
      whereConditions.push(`is_template = $${paramIndex}`);
      params.push(is_template === 'true');
      paramIndex++;
    }

    params.push(limit, offset);

    const result = await fastify.db.query(
      `SELECT r.*, u.name as created_by_name
       FROM rubrics r
       LEFT JOIN users u ON r.created_by = u.id
       WHERE ${whereConditions.join(' AND ')}
       ORDER BY r.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );

    return {
      success: true,
      data: result.rows
    };
  });

  /**
   * GET /api/v1/rubrics/templates
   * List template rubrics
   */
  fastify.get('/templates', async (request) => {
    const { type, limit = 50, offset = 0 } = request.query;

    let query = `
      SELECT * FROM rubrics 
      WHERE is_template = true
      ${type ? 'AND type = $1' : ''}
      ORDER BY name ASC
      LIMIT $${type ? 2 : 1} OFFSET $${type ? 3 : 2}
    `;

    const params = type ? [type, limit, offset] : [limit, offset];
    const result = await fastify.db.query(query, params);

    return {
      success: true,
      data: result.rows
    };
  });

  /**
   * GET /api/v1/rubrics/:id
   * Get rubric by ID
   */
  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request) => {
    const { id } = request.params;
    const userId = request.user.id;

    const result = await fastify.db.query(
      `SELECT r.*, u.name as created_by_name
       FROM rubrics r
       LEFT JOIN users u ON r.created_by = u.id
       WHERE r.id = $1 AND (r.created_by = $2 OR r.is_template = true)`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      throw fastify.createError(404, 'Rubric not found', 'RUBRIC_NOT_FOUND');
    }

    return {
      success: true,
      data: result.rows[0]
    };
  });

  /**
   * PUT /api/v1/rubrics/:id
   * Update rubric
   */
  fastify.put('/:id', {
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])]
  }, async (request) => {
    const { id } = request.params;
    const { name, description, type, criteria, total_points, is_template } = request.body;
    const userId = request.user.id;

    // Check ownership
    const checkResult = await fastify.db.query(
      'SELECT id, created_by FROM rubrics WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      throw fastify.createError(404, 'Rubric not found', 'RUBRIC_NOT_FOUND');
    }

    if (checkResult.rows[0].created_by !== userId && request.user.role !== 'admin') {
      throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
    }

    const result = await fastify.db.query(
      `UPDATE rubrics SET
         name = COALESCE($1, name),
         description = COALESCE($2, description),
         type = COALESCE($3, type),
         criteria = COALESCE($4, criteria),
         total_points = COALESCE($5, total_points),
         is_template = COALESCE($6, is_template),
         updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [name, description, type, criteria ? JSON.stringify(criteria) : null, total_points, is_template, id]
    );

    return {
      success: true,
      data: result.rows[0]
    };
  });

  /**
   * DELETE /api/v1/rubrics/:id
   * Delete rubric
   */
  fastify.delete('/:id', {
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])]
  }, async (request, reply) => {
    const { id } = request.params;
    const userId = request.user.id;

    // Check ownership and usage
    const checkResult = await fastify.db.query(
      `SELECT r.id, r.created_by, COUNT(a.id) as assignment_count
       FROM rubrics r
       LEFT JOIN assignments a ON a.rubric_id = r.id
       WHERE r.id = $1
       GROUP BY r.id`,
      [id]
    );

    if (checkResult.rows.length === 0) {
      throw fastify.createError(404, 'Rubric not found', 'RUBRIC_NOT_FOUND');
    }

    if (checkResult.rows[0].created_by !== userId && request.user.role !== 'admin') {
      throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
    }

    if (parseInt(checkResult.rows[0].assignment_count) > 0) {
      throw fastify.createError(400, 'Rubric is in use by assignments', 'RUBRIC_IN_USE');
    }

    await fastify.db.query('DELETE FROM rubrics WHERE id = $1', [id]);

    return reply.code(204).send();
  });

  /**
   * POST /api/v1/rubrics/:id/duplicate
   * Duplicate a rubric
   */
  fastify.post('/:id/duplicate', {
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])]
  }, async (request, reply) => {
    const { id } = request.params;
    const userId = request.user.id;

    // Get original rubric
    const original = await fastify.db.query(
      'SELECT * FROM rubrics WHERE id = $1 AND (created_by = $2 OR is_template = true)',
      [id, userId]
    );

    if (original.rows.length === 0) {
      throw fastify.createError(404, 'Rubric not found', 'RUBRIC_NOT_FOUND');
    }

    const rubric = original.rows[0];

    // Create duplicate
    const result = await fastify.db.query(
      `INSERT INTO rubrics (id, name, description, type, criteria, total_points, is_template, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, false, $7, NOW(), NOW())
       RETURNING *`,
      [uuidv4(), `${rubric.name} (Copy)`, rubric.description, rubric.type, rubric.criteria, rubric.total_points, userId]
    );

    return reply.code(201).send({
      success: true,
      data: result.rows[0]
    });
  });
}

module.exports = rubricsRoutes;
