/**
 * Unit Tests for File Service
 */

const fileService = require('../../src/services/file-service');

describe('File Service', () => {
  describe('parseCsv', () => {
    it('should parse CSV with headers', async () => {
      const csv = Buffer.from(
        'Name, Email, Score\n' +
        'John Doe, john@example.com, 85\n' +
        'Jane Smith, jane@example.com, 92'
      );

      const rows = await fileService.parseCsv(csv);

      expect(rows.length).toBe(2);
      expect(rows[0].name).toBe('John Doe');
      expect(rows[0].email).toBe('john@example.com');
      expect(rows[0].score).toBe('85');
    });

    it('should handle empty CSV', async () => {
      const csv = Buffer.from('');
      const rows = await fileService.parseCsv(csv);

      expect(rows).toEqual([]);
    });

    it('should handle CSV with only headers', async () => {
      const csv = Buffer.from('Name, Email, Score');
      const rows = await fileService.parseCsv(csv);

      expect(rows).toEqual([]);
    });

    it('should normalize header names', async () => {
      const csv = Buffer.from(
        'Student Name, Email Address, Final Score\n' +
        'Test User, test@test.com, 100'
      );

      const rows = await fileService.parseCsv(csv);

      expect(rows[0]).toHaveProperty('student_name');
      expect(rows[0]).toHaveProperty('email_address');
      expect(rows[0]).toHaveProperty('final_score');
    });
  });

  describe('generateCsv', () => {
    it('should generate CSV from data', () => {
      const data = [
        { name: 'John', score: 85 },
        { name: 'Jane', score: 92 }
      ];
      const headers = ['name', 'score'];

      const csv = fileService.generateCsv(data, headers);

      expect(csv).toBe('name,score\nJohn,85\nJane,92');
    });

    it('should handle empty data', () => {
      const csv = fileService.generateCsv([], ['name', 'score']);

      expect(csv).toBe('name,score\n');
    });

    it('should escape commas in values', () => {
      const data = [
        { name: 'Doe, John', score: 85 }
      ];
      const headers = ['name', 'score'];

      const csv = fileService.generateCsv(data, headers);

      expect(csv).toBe('name,score\n"Doe, John",85');
    });

    it('should escape quotes in values', () => {
      const data = [
        { name: 'John "Johnny" Doe', score: 85 }
      ];
      const headers = ['name', 'score'];

      const csv = fileService.generateCsv(data, headers);

      expect(csv).toBe('name,score\n"John ""Johnny"" Doe",85');
    });

    it('should handle null/undefined values', () => {
      const data = [
        { name: 'John', score: null },
        { name: 'Jane', score: undefined }
      ];
      const headers = ['name', 'score'];

      const csv = fileService.generateCsv(data, headers);

      expect(csv).toBe('name,score\nJohn,\nJane,');
    });
  });

  describe('getMimeType', () => {
    it('should return correct MIME types', () => {
      expect(fileService.getMimeType('document.pdf')).toBe('application/pdf');
      expect(fileService.getMimeType('data.csv')).toBe('text/csv');
      expect(fileService.getMimeType('readme.txt')).toBe('text/plain');
      expect(fileService.getMimeType('config.json')).toBe('application/json');
    });

    it('should return octet-stream for unknown types', () => {
      expect(fileService.getMimeType('file.xyz')).toBe('application/octet-stream');
      expect(fileService.getMimeType('document')).toBe('application/octet-stream');
    });
  });
});
