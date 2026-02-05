/**
 * OAuth Service
 * Handles Google and GitHub OAuth authentication flows
 */

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

/**
 * Exchange Google authorization code for access token
 * @param {string} code - Authorization code from Google
 * @returns {Promise<{access_token: string, id_token: string, expires_in: number}>}
 */
async function exchangeGoogleCode(code) {
  try {
    const response = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    });

    return response.data;
  } catch (error) {
    const errorMsg = error.response?.data?.error_description || error.message;
    throw new Error(`Failed to exchange Google code: ${errorMsg}`);
  }
}

/**
 * Get Google user profile from access token
 * @param {string} accessToken - Google access token
 * @returns {Promise<{id: string, email: string, name: string, picture: string}>}
 */
async function getGoogleUserProfile(accessToken) {
  try {
    const response = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    return {
      id: response.data.id,
      email: response.data.email,
      name: response.data.name,
      picture: response.data.picture,
      provider: 'google',
    };
  } catch (error) {
    throw new Error(`Failed to get Google user profile: ${error.message}`);
  }
}

/**
 * Exchange GitHub authorization code for access token
 * @param {string} code - Authorization code from GitHub
 * @returns {Promise<{access_token: string, scope: string, token_type: string}>}
 */
async function exchangeGitHubCode(code) {
  try {
    const response = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: process.env.GITHUB_REDIRECT_URI,
      },
      {
        headers: {
          Accept: 'application/json',
        },
      }
    );

    if (response.data.error) {
      throw new Error(response.data.error_description || response.data.error);
    }

    return response.data;
  } catch (error) {
    const errorMsg = error.response?.data?.error_description || error.message;
    throw new Error(`Failed to exchange GitHub code: ${errorMsg}`);
  }
}

/**
 * Get GitHub user profile from access token
 * @param {string} accessToken - GitHub access token
 * @returns {Promise<{id: number, email: string, name: string, avatar_url: string}>}
 */
async function getGitHubUserProfile(accessToken) {
  try {
    const response = await axios.get('https://api.github.com/user', {
      headers: {
        Authorization: `token ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    // GitHub API doesn't always return email in user endpoint
    // Fetch from emails endpoint if needed
    let email = response.data.email;
    if (!email) {
      const emailResponse = await axios.get('https://api.github.com/user/emails', {
        headers: {
          Authorization: `token ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      // Get the primary email
      const primaryEmail = emailResponse.data.find(e => e.primary);
      email = primaryEmail?.email || emailResponse.data[0]?.email;
    }

    return {
      id: response.data.id,
      email: email || `${response.data.login}@github.com`,
      name: response.data.name || response.data.login,
      picture: response.data.avatar_url,
      provider: 'github',
    };
  } catch (error) {
    throw new Error(`Failed to get GitHub user profile: ${error.message}`);
  }
}

/**
 * Create or get user from OAuth profile
 * @param {Object} profile - User profile from OAuth provider
 * @param {Object} db - Database connection
 * @param {string} [requestedRole] - Requested role for new users ('instructor' or 'student')
 * @returns {Promise<{id: string, email: string, name: string, role: string}>}
 */
async function createOrGetOAuthUser(profile, db, requestedRole) {
  try {
    // Check if user exists by email
    const existingUserResult = await db.query(
      'SELECT id, email, name, role FROM users WHERE email = $1',
      [profile.email]
    );

    if (existingUserResult.rows.length > 0) {
      // User exists, return existing user
      const user = existingUserResult.rows[0];
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isNew: false,
      };
    }

    // Create new user in a transaction
    const result = await db.transaction(async (client) => {
      const userId = uuidv4();
      
      // Use requested role if valid, otherwise default to student
      const validRoles = ['instructor', 'student'];
      const userRole = validRoles.includes(requestedRole) ? requestedRole : 'student';

      // Create user
      await client.query(
        `INSERT INTO users (id, email, name, role, password_hash, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [userId, profile.email, profile.name, userRole, ''] // Empty password for OAuth users
      );

      // Create student record if student role
      if (userRole === 'student') {
        const studentId = uuidv4();
        await client.query(
          `INSERT INTO students (id, user_id, name, created_at)
           VALUES ($1, $2, $3, NOW())`,
          [studentId, userId, profile.name]
        );
      }

      return {
        id: userId,
        email: profile.email,
        name: profile.name,
        role: userRole,
        isNew: true,
      };
    });

    return result;
  } catch (error) {
    throw new Error(`Failed to create or get OAuth user: ${error.message}`);
  }
}

module.exports = {
  exchangeGoogleCode,
  getGoogleUserProfile,
  exchangeGitHubCode,
  getGitHubUserProfile,
  createOrGetOAuthUser,
};
