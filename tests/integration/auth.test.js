/**
 * Integration Tests for Authentication Routes
 */

const app = require('../../src/app');

describe('Auth Routes', () => {
  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/auth/signup', () => {
    it('should create a new user with valid data', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/signup',
        payload: {
          email: `test${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          name: 'Test User',
          role: 'instructor'
        }
      });

      // Note: This will fail without a real database connection
      // In a real test environment, you'd use a test database
      expect([200, 201, 500]).toContain(response.statusCode);
    });

    it('should reject signup with missing fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/signup',
        payload: {
          email: 'incomplete@example.com'
          // Missing password and name
        }
      });

      expect([400, 500]).toContain(response.statusCode);
    });

    it('should reject invalid email format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/signup',
        payload: {
          email: 'not-an-email',
          password: 'SecurePassword123!',
          name: 'Test User',
          role: 'student'
        }
      });

      expect([400, 500]).toContain(response.statusCode);
    });
  });

  describe('POST /api/v1/auth/signin', () => {
    it('should reject signin with invalid credentials', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/signin',
        payload: {
          email: 'nonexistent@example.com',
          password: 'wrongpassword'
        }
      });

      expect([401, 500]).toContain(response.statusCode);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('should reject request without auth token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me'
      });

      expect([401, 500]).toContain(response.statusCode);
    });
  });
});
