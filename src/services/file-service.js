/**
 * File Service
 * Handles PDF and CSV file processing
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024; // 10MB

/**
 * Save an uploaded file to disk
 * @param {Buffer} buffer - File buffer
 * @param {string} originalFilename - Original filename
 * @param {string} userId - User ID for organizing files
 * @returns {Promise<{filename: string, path: string, size: number}>}
 */
async function saveFile(buffer, originalFilename, userId) {
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`File size exceeds maximum allowed (${MAX_FILE_SIZE / 1024 / 1024}MB)`);
  }

  const ext = path.extname(originalFilename).toLowerCase();
  const allowedExts = ['.pdf', '.csv', '.txt'];
  
  if (!allowedExts.includes(ext)) {
    throw new Error(`File type not allowed. Allowed types: ${allowedExts.join(', ')}`);
  }

  // Create user-specific directory
  const userDir = path.join(UPLOAD_DIR, userId);
  await fs.mkdir(userDir, { recursive: true });

  // Generate unique filename
  const timestamp = Date.now();
  const hash = crypto.createHash('md5').update(buffer).digest('hex').slice(0, 8);
  const filename = `${timestamp}-${hash}${ext}`;
  const filePath = path.join(userDir, filename);

  await fs.writeFile(filePath, buffer);

  // Return relative path (without UPLOAD_DIR prefix) for database storage
  // This allows the file serving routes to properly construct the full path
  const relativePath = path.join(userId, filename);

  return {
    filename,
    path: relativePath,
    fullPath: filePath,
    size: buffer.length
  };
}

/**
 * Read a file from disk
 * @param {string} filePath - Path to the file
 * @returns {Promise<Buffer>}
 */
async function readFile(filePath) {
  try {
    return await fs.readFile(filePath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error('File not found');
    }
    throw err;
  }
}

/**
 * Delete a file from disk
 * @param {string} filePath - Path to the file
 * @returns {Promise<void>}
 */
async function deleteFile(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
    // File doesn't exist, that's fine
  }
}

/**
 * Extract text from a PDF file using pdf-parse
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @returns {Promise<string>} Extracted text content
 * @throws {Error} If PDF parsing fails
 */
async function extractTextFromPdf(pdfBuffer) {
  if (!pdfBuffer || pdfBuffer.length === 0) {
    throw new Error('Empty PDF buffer provided');
  }

  try {
    // Dynamic import to handle optional dependency
    const pdfParse = require('pdf-parse');
    
    const data = await pdfParse(pdfBuffer, {
      // Limit pages for performance (can be adjusted)
      max: 50
    });
    
    if (!data.text || data.text.trim().length === 0) {
      throw new Error('No text content found in PDF. The PDF may be image-based or empty.');
    }
    
    // Clean up extracted text
    let text = data.text
      .replace(/\r\n/g, '\n')      // Normalize line endings
      .replace(/\n{3,}/g, '\n\n')  // Remove excessive blank lines
      .trim();
    
    return text;
  } catch (err) {
    if (err.message.includes('Cannot find module')) {
      throw new Error('PDF parsing not available. Please install pdf-parse: npm install pdf-parse');
    }
    throw new Error(`Failed to extract text from PDF: ${err.message}`);
  }
}

/**
 * Parse a CSV file into rows
 * @param {Buffer} csvBuffer - CSV file buffer
 * @returns {Promise<Array<Object>>}
 */
async function parseCsv(csvBuffer) {
  const content = csvBuffer.toString('utf8');
  const lines = content.split(/\r?\n/).filter(line => line.trim());
  
  if (lines.length === 0) {
    return [];
  }

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const row = {};
    
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    
    rows.push(row);
  }

  return rows;
}

/**
 * Generate a CSV from data
 * @param {Array<Object>} data - Array of objects
 * @param {Array<string>} headers - Column headers
 * @returns {string}
 */
function generateCsv(data, headers) {
  if (!data || data.length === 0) {
    return headers.join(',') + '\n';
  }

  const headerRow = headers.join(',');
  const dataRows = data.map(row => {
    return headers.map(h => {
      const value = row[h];
      // Escape commas and quotes in values
      if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value ?? '';
    }).join(',');
  });

  return [headerRow, ...dataRows].join('\n');
}

/**
 * Get MIME type for a file extension
 * @param {string} filename - Filename with extension
 * @returns {string}
 */
function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.pdf': 'application/pdf',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.json': 'application/json'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

module.exports = {
  saveFile,
  readFile,
  deleteFile,
  extractTextFromPdf,
  parseCsv,
  generateCsv,
  getMimeType,
  UPLOAD_DIR,
  MAX_FILE_SIZE
};
