/**
 * Email Service
 * Handles sending emails using nodemailer
 */

const nodemailer = require('nodemailer');
const logger = require('./logger');

// Create transporter based on environment
const createTransporter = () => {
  // Use environment variables for SMTP configuration
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT || 587;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM || 'AutoGradeX <noreply@autogradex.com>';

  if (!smtpHost || !smtpUser || !smtpPass) {
    logger.warn('SMTP configuration not found. Email sending will be disabled.');
    return null;
  }

  return nodemailer.createTransport({
    host: smtpHost,
    port: parseInt(smtpPort),
    secure: smtpPort === '465', // true for 465, false for other ports
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });
};

let transporter = null;

/**
 * Initialize the email transporter
 */
const initializeTransporter = () => {
  transporter = createTransporter();
  return transporter !== null;
};

/**
 * Send a password reset email
 * @param {string} toEmail - Recipient email address
 * @param {string} resetToken - Password reset token
 * @param {string} userName - User's name for personalization
 * @returns {Promise<{success: boolean, error?: string}>}
 */
const sendPasswordResetEmail = async (toEmail, resetToken, userName = 'User') => {
  if (!transporter) {
    // Try to initialize if not done yet
    initializeTransporter();
  }

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;

  if (!transporter) {
    // In development without SMTP config, log the reset link
    logger.warn('========================================');
    logger.warn('EMAIL SERVICE NOT CONFIGURED');
    logger.warn({ resetLink }, 'Password reset link (for development)');
    logger.warn('========================================');
    
    // Return success in development so the flow continues
    if (process.env.NODE_ENV === 'development') {
      return { success: true, devMode: true, resetLink };
    }
    
    return { 
      success: false, 
      error: 'Email service not configured. Please contact support.' 
    };
  }

  const smtpFrom = process.env.SMTP_FROM || 'AutoGradeX <noreply@autogradex.com>';

  const mailOptions = {
    from: smtpFrom,
    to: toEmail,
    subject: 'Reset Your AutoGradeX Password',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #3B82F6, #2563EB); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">AutoGradeX</h1>
          <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Password Reset Request</p>
        </div>
        
        <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
          <p style="font-size: 16px;">Hi ${userName},</p>
          
          <p style="font-size: 16px;">We received a request to reset your password. Click the button below to create a new password:</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetLink}" style="display: inline-block; background: #3B82F6; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">Reset Password</a>
          </div>
          
          <p style="font-size: 14px; color: #666;">This link will expire in <strong>1 hour</strong>. If you didn't request this reset, you can safely ignore this email.</p>
          
          <p style="font-size: 14px; color: #666;">If the button doesn't work, copy and paste this link into your browser:</p>
          <p style="font-size: 12px; color: #3B82F6; word-break: break-all;">${resetLink}</p>
          
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
          
          <p style="font-size: 12px; color: #999; text-align: center;">
            This email was sent by AutoGradeX. If you have questions, please contact support.
          </p>
        </div>
      </body>
      </html>
    `,
    text: `
      Hi ${userName},

      We received a request to reset your password. Click the link below to create a new password:

      ${resetLink}

      This link will expire in 1 hour. If you didn't request this reset, you can safely ignore this email.

      - The AutoGradeX Team
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info({ toEmail }, 'Password reset email sent');
    return { success: true };
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to send password reset email');
    return { 
      success: false, 
      error: 'Failed to send email. Please try again later.' 
    };
  }
};

module.exports = {
  initializeTransporter,
  sendPasswordResetEmail,
};