/**
 * Authentication Routes
 * Sign up, sign in, password reset, OAuth
 */

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const {
  exchangeGoogleCode,
  getGoogleUserProfile,
  exchangeGitHubCode,
  getGitHubUserProfile,
  createOrGetOAuthUser,
} = require('../services/oauth-service');
const auditService = require('../services/audit-service');
const { sendPasswordResetEmail } = require('../services/email-service');

const signUpSchema = {
  body: {
    type: 'object',
    required: ['email', 'password', 'name', 'role'],
    properties: {
      email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 8 },
      name: { type: 'string', minLength: 2 },
      role: { type: 'string', enum: ['instructor', 'student'] }
    }
  }
};

const signInSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email' },
      password: { type: 'string' }
    }
  }
};

async function authRoutes(fastify, options) {
  /**
   * POST /api/v1/auth/signup
   * Register a new user
   */
  fastify.post('/signup', { schema: signUpSchema }, async (request, reply) => {
    const { email, password, name, role } = request.body;

    // Check if user exists
    const existingUser = await fastify.db.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      return reply.code(409).send({
        success: false,
        error: 'Email already registered',
        code: 'EMAIL_EXISTS'
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user in transaction
    const result = await fastify.db.transaction(async (client) => {
      // Insert user
      const userResult = await client.query(
        `INSERT INTO users (id, email, password_hash, name, role, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         RETURNING id, email, name, role, created_at`,
        [uuidv4(), email.toLowerCase(), passwordHash, name, role]
      );

      const user = userResult.rows[0];

      // If student, create student record
      if (role === 'student') {
        await client.query(
          `INSERT INTO students (id, user_id, name, created_at)
           VALUES ($1, $2, $3, NOW())`,
          [uuidv4(), user.id, name]
        );
      }

      return user;
    });

    // Generate token
    const token = fastify.generateToken({
      id: result.id,
      email: result.email,
      name: result.name,
      role: result.role
    });

    return reply.code(201).send({
      success: true,
      data: {
        user: {
          id: result.id,
          email: result.email,
          name: result.name,
          role: result.role
        },
        token
      }
    });
  });

  /**
   * POST /api/v1/auth/signin
   * Authenticate user
   */
  fastify.post('/signin', { schema: signInSchema }, async (request, reply) => {
    const { email, password } = request.body;

    // Get user
    const result = await fastify.db.query(
      'SELECT id, email, password_hash, name, role FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return reply.code(401).send({
        success: false,
        error: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
    }

    const user = result.rows[0];

    // Verify password
    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      return reply.code(401).send({
        success: false,
        error: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // Generate token
    const token = fastify.generateToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    });

    return {
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role
        },
        token
      }
    };
  });

  /**
   * GET /api/v1/auth/me
   * Get current user info
   */
  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request) => {
    const result = await fastify.db.query(
      'SELECT id, email, name, role, created_at FROM users WHERE id = $1',
      [request.user.id]
    );

    if (result.rows.length === 0) {
      throw fastify.createError(404, 'User not found', 'USER_NOT_FOUND');
    }

    return {
      success: true,
      data: result.rows[0]
    };
  });

  /**
   * POST /api/v1/auth/signout
   * Sign out (client-side token removal)
   */
  fastify.post('/signout', { preHandler: [fastify.authenticate] }, async () => {
    // Token invalidation would require a blocklist in Redis for production
    // For now, client removes token
    return {
      success: true,
      message: 'Signed out successfully'
    };
  });

  /**
   * POST /api/v1/auth/google/callback
   * Handle Google OAuth callback
   */
  fastify.post('/google/callback', async (request, reply) => {
    const { code, role } = request.body;

    if (!code) {
      return reply.code(400).send({
        success: false,
        error: 'Authorization code is required',
        code: 'MISSING_CODE',
      });
    }

    try {
      // Exchange code for token
      fastify.log.info('Exchanging Google code for token');
      const tokenData = await exchangeGoogleCode(code);
      fastify.log.info('Successfully got Google token');
      
      // Get user profile
      fastify.log.info('Fetching Google user profile');
      const profile = await getGoogleUserProfile(tokenData.access_token);
      fastify.log.info('Successfully got profile:', { email: profile.email });
      
      // Create or get user (pass the requested role for new users)
      fastify.log.info('Creating or getting user');
      const user = await createOrGetOAuthUser(profile, fastify.db, role);
      fastify.log.info('User ready:', { userId: user.id, email: user.email });
      
      // Generate JWT token
      const token = fastify.jwt.sign({
        id: user.id,
        email: user.email,
        role: user.role,
      });

      // Log audit event
      fastify.log.info('Logging audit event');
      await auditService.logAction(fastify, {
        userId: user.id,
        action: 'OAUTH_SIGNIN',
        resourceType: 'user',
        resourceId: user.id,
        newValue: { provider: 'google', email: user.email },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
      fastify.log.info('Audit event logged successfully');

      return {
        success: true,
        data: {
          token,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
          },
          isNew: user.isNew,
        },
      };
    } catch (error) {
      fastify.log.error('Google OAuth error:', { 
        message: error.message, 
        stack: error.stack,
        errorCode: error.code,
        errorResponse: error.response?.data
      });
      return reply.code(400).send({
        success: false,
        error: error.message || 'Google authentication failed',
        code: 'GOOGLE_AUTH_FAILED',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  /**
   * POST /api/v1/auth/github/callback
   * Handle GitHub OAuth callback
   */
  fastify.post('/github/callback', async (request, reply) => {
    const { code, role } = request.body;

    if (!code) {
      return reply.code(400).send({
        success: false,
        error: 'Authorization code is required',
        code: 'MISSING_CODE',
      });
    }

    try {
      // Exchange code for token
      const tokenData = await exchangeGitHubCode(code);
      
      // Get user profile
      const profile = await getGitHubUserProfile(tokenData.access_token);
      
      // Create or get user (pass the requested role for new users)
      const user = await createOrGetOAuthUser(profile, fastify.db, role);
      
      // Generate JWT token
      const token = fastify.jwt.sign({
        id: user.id,
        email: user.email,
        role: user.role,
      });

      // Log audit event
      await auditService.logAction(fastify, {
        userId: user.id,
        action: 'OAUTH_SIGNIN',
        resourceType: 'user',
        resourceId: user.id,
        newValue: { provider: 'github', email: user.email },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return {
        success: true,
        data: {
          token,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
          },
          isNew: user.isNew,
        },
      };
    } catch (error) {
      fastify.log.error('GitHub OAuth error:', error);
      return reply.code(400).send({
        success: false,
        error: error.message || 'GitHub authentication failed',
        code: 'GITHUB_AUTH_FAILED',
      });
    }
  });

  /**
   * POST /api/v1/auth/password-reset/request
   * Request password reset email
   */
  fastify.post('/password-reset/request', async (request, reply) => {
    const { email } = request.body;

    if (!email) {
      return reply.code(400).send({
        success: false,
        error: 'Email is required',
        code: 'EMAIL_REQUIRED',
      });
    }

    try {
      // Check if user exists
      const userResult = await fastify.db.query(
        'SELECT id, email, name FROM users WHERE email = $1',
        [email.toLowerCase()]
      );

      if (userResult.rows.length === 0) {
        // Don't reveal if email exists (security best practice)
        // But still return success to prevent email enumeration
        return {
          success: true,
          message: 'If an account exists with this email, a password reset link has been sent.',
        };
      }

      const user = userResult.rows[0];

      // Invalidate any existing reset tokens for this user
      await fastify.db.query(
        'DELETE FROM password_reset_tokens WHERE user_id = $1',
        [user.id]
      );

      // Generate a secure reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

      // Store the token in database
      await fastify.db.query(
        `INSERT INTO password_reset_tokens (user_id, token, expires_at)
         VALUES ($1, $2, $3)`,
        [user.id, resetToken, expiresAt]
      );

      // Send the password reset email
      const emailResult = await sendPasswordResetEmail(user.email, resetToken, user.name);

      if (!emailResult.success) {
        fastify.log.error('Failed to send password reset email:', emailResult.error);
        // Still return success to prevent email enumeration, but log the error
      }

      fastify.log.info('Password reset requested for:', { email: user.email });

      return {
        success: true,
        message: 'If an account exists with this email, a password reset link has been sent.',
      };
    } catch (error) {
      fastify.log.error('Password reset request error:', error);
      return reply.code(500).send({
        success: false,
        error: 'Failed to process password reset request',
        code: 'PASSWORD_RESET_ERROR',
      });
    }
  });

  /**
   * POST /api/v1/auth/password-reset/confirm
   * Confirm password reset with token
   */
  fastify.post('/password-reset/confirm', async (request, reply) => {
    const { token, new_password } = request.body;

    if (!token || !new_password) {
      return reply.code(400).send({
        success: false,
        error: 'Token and new password are required',
        code: 'MISSING_FIELDS',
      });
    }

    if (new_password.length < 8) {
      return reply.code(400).send({
        success: false,
        error: 'Password must be at least 8 characters',
        code: 'PASSWORD_TOO_SHORT',
      });
    }

    try {
      // Find the token and verify it's valid
      const tokenResult = await fastify.db.query(
        `SELECT prt.*, u.email 
         FROM password_reset_tokens prt
         JOIN users u ON prt.user_id = u.id
         WHERE prt.token = $1 AND prt.used_at IS NULL`,
        [token]
      );

      if (tokenResult.rows.length === 0) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid or expired reset link. Please request a new password reset.',
          code: 'INVALID_TOKEN',
        });
      }

      const resetToken = tokenResult.rows[0];

      // Check if token has expired
      if (new Date(resetToken.expires_at) < new Date()) {
        // Clean up expired token
        await fastify.db.query(
          'DELETE FROM password_reset_tokens WHERE id = $1',
          [resetToken.id]
        );
        return reply.code(400).send({
          success: false,
          error: 'Reset link has expired. Please request a new password reset.',
          code: 'TOKEN_EXPIRED',
        });
      }

      // Hash the new password
      const passwordHash = await bcrypt.hash(new_password, 12);

      // Update user's password
      await fastify.db.query(
        'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
        [passwordHash, resetToken.user_id]
      );

      // Mark token as used
      await fastify.db.query(
        'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1',
        [resetToken.id]
      );

      // Delete all reset tokens for this user (invalidate any other pending resets)
      await fastify.db.query(
        'DELETE FROM password_reset_tokens WHERE user_id = $1',
        [resetToken.user_id]
      );

      fastify.log.info('Password reset successful for user:', { userId: resetToken.user_id });

      return {
        success: true,
        message: 'Password has been reset successfully. You can now sign in with your new password.',
      };
    } catch (error) {
      fastify.log.error('Password reset confirm error:', error);
      return reply.code(500).send({
        success: false,
        error: 'Failed to reset password',
        code: 'PASSWORD_RESET_ERROR',
      });
    }
  });
}

module.exports = authRoutes;
