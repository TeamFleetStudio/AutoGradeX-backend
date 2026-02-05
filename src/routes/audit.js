/**
 * Audit Log Routes
 * GET /api/v1/audit - Query audit logs
 */

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
async function auditRoutes(fastify, options) {

  /**
   * GET /api/v1/audit
   * Query audit logs with filters
   */
  fastify.get('/', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          user_id: { type: 'string', format: 'uuid' },
          action: { type: 'string' },
          resource_type: { type: 'string' },
          resource_id: { type: 'string', format: 'uuid' },
          start_date: { type: 'string', format: 'date-time' },
          end_date: { type: 'string', format: 'date-time' },
          limit: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
          offset: { type: 'integer', minimum: 0, default: 0 }
        }
      }
    },
    preHandler: [fastify.authenticate, fastify.authorize(['admin', 'instructor'])]
  }, async (request, reply) => {
    const { 
      user_id, 
      action, 
      resource_type, 
      resource_id, 
      start_date, 
      end_date,
      limit,
      offset 
    } = request.query;

    // Instructors can only see their own audit logs
    const effectiveUserId = request.user.role === 'admin' ? user_id : request.user.id;

    let query = `
      SELECT 
        al.*,
        u.email AS user_email,
        u.name AS user_name
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (effectiveUserId) {
      query += ` AND al.user_id = $${paramIndex}`;
      params.push(effectiveUserId);
      paramIndex++;
    }

    if (action) {
      query += ` AND al.action = $${paramIndex}`;
      params.push(action);
      paramIndex++;
    }

    if (resource_type) {
      query += ` AND al.resource_type = $${paramIndex}`;
      params.push(resource_type);
      paramIndex++;
    }

    if (resource_id) {
      query += ` AND al.resource_id = $${paramIndex}`;
      params.push(resource_id);
      paramIndex++;
    }

    if (start_date) {
      query += ` AND al.timestamp >= $${paramIndex}`;
      params.push(start_date);
      paramIndex++;
    }

    if (end_date) {
      query += ` AND al.timestamp <= $${paramIndex}`;
      params.push(end_date);
      paramIndex++;
    }

    // Count total
    const countResult = await fastify.db.query(
      query.replace('SELECT \n        al.*,\n        u.email AS user_email,\n        u.name AS user_name', 'SELECT COUNT(*)'),
      params
    );

    // Add ordering and pagination
    query += ` ORDER BY al.timestamp DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await fastify.db.query(query, params);

    return reply.send({
      total: parseInt(countResult.rows[0].count),
      limit,
      offset,
      logs: result.rows.map(row => ({
        id: row.id,
        user_id: row.user_id,
        user_email: row.user_email,
        user_name: row.user_name,
        action: row.action,
        resource_type: row.resource_type,
        resource_id: row.resource_id,
        old_value: row.old_value,
        new_value: row.new_value,
        ip_address: row.ip_address,
        timestamp: row.timestamp
      }))
    });
  });

  /**
   * GET /api/v1/audit/actions
   * Get list of distinct actions for filtering
   */
  fastify.get('/actions', {
    preHandler: [fastify.authenticate, fastify.authorize(['admin'])]
  }, async (request, reply) => {
    const result = await fastify.db.query(
      'SELECT DISTINCT action FROM audit_logs ORDER BY action'
    );

    return reply.send({
      actions: result.rows.map(r => r.action)
    });
  });

  /**
   * GET /api/v1/audit/resource/:type/:id
   * Get audit history for a specific resource
   */
  fastify.get('/resource/:type/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['type', 'id'],
        properties: {
          type: { type: 'string' },
          id: { type: 'string', format: 'uuid' }
        }
      }
    },
    preHandler: [fastify.authenticate, fastify.authorize(['admin', 'instructor'])]
  }, async (request, reply) => {
    const { type, id } = request.params;

    // Verify access based on resource type
    if (request.user.role === 'instructor') {
      // Instructors can only see audit for their own resources
      if (type === 'assignment') {
        const check = await fastify.db.query(
          'SELECT id FROM assignments WHERE id = $1 AND instructor_id = $2',
          [id, request.user.id]
        );
        if (check.rows.length === 0) {
          return reply.status(403).send({ error: 'Not authorized to view this resource audit' });
        }
      }
    }

    const result = await fastify.db.query(`
      SELECT 
        al.*,
        u.email AS user_email,
        u.name AS user_name
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.resource_type = $1 AND al.resource_id = $2
      ORDER BY al.timestamp DESC
      LIMIT 100
    `, [type, id]);

    return reply.send({
      resource_type: type,
      resource_id: id,
      history: result.rows
    });
  });
}

module.exports = auditRoutes;
