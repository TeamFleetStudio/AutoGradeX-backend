/**
 * Unit Tests for Anonymization Service
 */

const anonymization = require('../../src/services/anonymization');

describe('Anonymization Service', () => {
  describe('hashValue', () => {
    it('should produce consistent hashes for same input', () => {
      const value = 'test@example.com';
      const hash1 = anonymization.hashValue(value);
      const hash2 = anonymization.hashValue(value);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different inputs', () => {
      const hash1 = anonymization.hashValue('user1@example.com');
      const hash2 = anonymization.hashValue('user2@example.com');

      expect(hash1).not.toBe(hash2);
    });

    it('should produce 12-character hashes', () => {
      const hash = anonymization.hashValue('test');
      expect(hash.length).toBe(12);
    });
  });

  describe('redactEmails', () => {
    it('should redact email addresses', () => {
      const text = 'Contact me at john.doe@example.com for questions.';
      const redacted = anonymization.redactEmails(text);

      expect(redacted).toBe('Contact me at [EMAIL_REDACTED] for questions.');
    });

    it('should handle multiple emails', () => {
      const text = 'From: alice@test.org To: bob@company.com';
      const redacted = anonymization.redactEmails(text);

      expect(redacted).toBe('From: [EMAIL_REDACTED] To: [EMAIL_REDACTED]');
    });

    it('should not modify text without emails', () => {
      const text = 'This text has no email addresses.';
      const redacted = anonymization.redactEmails(text);

      expect(redacted).toBe(text);
    });

    it('should handle null/undefined input', () => {
      expect(anonymization.redactEmails(null)).toBe(null);
      expect(anonymization.redactEmails(undefined)).toBe(undefined);
    });
  });

  describe('redactPhoneNumbers', () => {
    it('should redact US phone numbers', () => {
      const text = 'Call me at 555-123-4567';
      const redacted = anonymization.redactPhoneNumbers(text);

      expect(redacted).toBe('Call me at [PHONE_REDACTED]');
    });

    it('should redact various phone formats', () => {
      const formats = [
        '(555) 123-4567',
        '555.123.4567',
        '+1 555 123 4567',
        '5551234567'
      ];

      formats.forEach(phone => {
        const redacted = anonymization.redactPhoneNumbers(`Call: ${phone}`);
        expect(redacted).toContain('[PHONE_REDACTED]');
      });
    });
  });

  describe('anonymizeUser', () => {
    it('should remove PII from user object', () => {
      const user = {
        id: 'user-123',
        email: 'john@example.com',
        name: 'John Doe',
        role: 'student',
        student_number: '12345'
      };

      const anonymized = anonymization.anonymizeUser(user);

      expect(anonymized.id).toBe('user-123');
      expect(anonymized.role).toBe('student');
      expect(anonymized.anonymized_id).toBeDefined();
      expect(anonymized.email).toBeUndefined();
      expect(anonymized.name).toBeUndefined();
      expect(anonymized.student_number).toBeUndefined();
    });
  });

  describe('anonymizeSubmission', () => {
    it('should anonymize student ID and exclude content', () => {
      const submission = global.testUtils.mockSubmission({
        content: 'This is my essay about privacy.'
      });

      const anonymized = anonymization.anonymizeSubmission(submission);

      expect(anonymized.student_hash).toBeDefined();
      expect(anonymized.content).toBeUndefined();
      expect(anonymized.content_length).toBeGreaterThan(0);
    });
  });

  describe('createAnonymizedDataset', () => {
    it('should create anonymized dataset from submissions', () => {
      const submissions = [
        {
          id: 'sub-1',
          student_id: 'student-1',
          assignment_id: 'assign-1',
          content: 'First submission content here.',
          version: 1,
          submitted_at: new Date().toISOString(),
          grade: {
            score: 85,
            rubric_scores: { thesis: { points: 20 } },
            graded_at: new Date().toISOString(),
            graded_by: null
          }
        },
        {
          id: 'sub-2',
          student_id: 'student-2',
          assignment_id: 'assign-1',
          content: 'Second submission.',
          version: 1,
          submitted_at: new Date().toISOString(),
          grade: null
        }
      ];

      const dataset = anonymization.createAnonymizedDataset(submissions);

      expect(dataset.length).toBe(2);
      expect(dataset[0].submission_hash).toBeDefined();
      expect(dataset[0].student_hash).toBeDefined();
      expect(dataset[0].word_count).toBeGreaterThan(0);
      expect(dataset[0].grade.score).toBe(85);
      expect(dataset[1].grade).toBeNull();
    });
  });

  describe('generateGdprExport', () => {
    it('should include all user data in export', () => {
      const userData = {
        user: {
          id: 'user-1',
          email: 'test@example.com',
          name: 'Test User',
          role: 'student',
          created_at: new Date().toISOString()
        },
        submissions: [global.testUtils.mockSubmission()],
        grades: [global.testUtils.mockGrade()],
        auditLogs: [
          { action: 'login', resource_type: 'session', timestamp: new Date().toISOString() }
        ]
      };

      const exported = anonymization.generateGdprExport(userData);

      expect(exported.export_date).toBeDefined();
      expect(exported.user.email).toBe('test@example.com');
      expect(exported.submissions.length).toBe(1);
      expect(exported.grades.length).toBe(1);
      expect(exported.audit_logs.length).toBe(1);
    });
  });
});
