/**
 * Grading Service
 * Core grading logic orchestration
 */

const { v4: uuidv4 } = require('uuid');
const openaiService = require('./openai-service');
const logger = require('./logger');

/**
 * Grade a submission and store the result
 * Handles text submissions
 * @param {Object} fastify - Fastify instance
 * @param {string} submissionId - Submission UUID
 * @returns {Promise<Object>} Grading result
 */
async function gradeSubmissionById(fastify, submissionId) {
  // Get submission with assignment and rubric details
  // Include reference_text_extracted for PDF-based reference answers
  const submissionResult = await fastify.db.query(
    `SELECT s.*, a.description as assignment_description, a.reference_answer, 
            a.reference_text_extracted, a.total_points,
            r.criteria as rubric_criteria
     FROM submissions s
     JOIN assignments a ON s.assignment_id = a.id
     LEFT JOIN rubrics r ON a.rubric_id = r.id
     WHERE s.id = $1`,
    [submissionId]
  );

  if (submissionResult.rows.length === 0) {
    throw new Error('Submission not found');
  }

  const submission = submissionResult.rows[0];
  
  // Get submission content - extract from PDF if content is empty but pdf_url exists
  let submissionContent = submission.content;
  
  if ((!submissionContent || submissionContent.trim().length === 0) && submission.pdf_url) {
    // Try to extract text from the PDF file
    try {
      const fileService = require('./file-service');
      const path = require('path');
      const fs = require('fs').promises;
      
      const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
      const pdfPath = path.join(UPLOAD_DIR, submission.pdf_url.replace(/^\/api\/v1\/files\//, ''));
      const pdfBuffer = await fs.readFile(pdfPath);
      submissionContent = await fileService.extractTextFromPdf(pdfBuffer);
      
      // Update the submission content in DB for future use
      await fastify.db.query(
        'UPDATE submissions SET content = $1 WHERE id = $2',
        [submissionContent, submissionId]
      );
      
      logger.info({ submissionId }, 'Extracted text from submission PDF');
    } catch (pdfErr) {
      logger.error({ submissionId, error: pdfErr.message }, 'Failed to extract text from submission PDF');
      throw new Error('Unable to extract text from the submitted PDF. The PDF may be image-based or corrupted.');
    }
  }

  // Check if already graded
  const existingGrade = await fastify.db.query(
    'SELECT id FROM grades WHERE submission_id = $1',
    [submissionId]
  );

  if (existingGrade.rows.length > 0) {
    throw new Error('Submission already graded');
  }

  // Update submission status to grading
  await fastify.db.query(
    "UPDATE submissions SET status = 'grading' WHERE id = $1",
    [submissionId]
  );

  try {
    let gradingResult;

    // Use reference_text_extracted (from PDF) if available, otherwise use text reference_answer
    const referenceAnswer = submission.reference_text_extracted || submission.reference_answer || '';

    // Grade text submission using standard GPT-4 API
    gradingResult = await openaiService.gradeSubmission({
      studentAnswer: submissionContent,
      rubric: submission.rubric_criteria || {},
      assignmentDescription: submission.assignment_description || '',
      referenceAnswer: referenceAnswer,
      totalPoints: submission.total_points || 100
    });

    // Store grade in transaction
    const grade = await fastify.db.transaction(async (client) => {
      // Insert grade
      const gradeResult = await client.query(
        `INSERT INTO grades (id, submission_id, score, feedback, rubric_scores, ai_response, confidence, graded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         RETURNING *`,
        [
          uuidv4(),
          submissionId,
          gradingResult.score,
          gradingResult.feedback,
          JSON.stringify(gradingResult.rubric_scores),
          JSON.stringify(gradingResult.ai_response),
          gradingResult.confidence || 1.0
        ]
      );

      // Update submission status
      await client.query(
        "UPDATE submissions SET status = 'graded' WHERE id = $1",
        [submissionId]
      );

      return gradeResult.rows[0];
    });

    return {
      success: true,
      grade,
      details: {
        strengths: gradingResult.strengths,
        areas_for_improvement: gradingResult.areas_for_improvement,
        suggestions: gradingResult.suggestions,
        confidence: gradingResult.confidence,
        warning: gradingResult.warning || null
      }
    };
  } catch (error) {
    // Mark as failed
    await fastify.db.query(
      "UPDATE submissions SET status = 'failed' WHERE id = $1",
      [submissionId]
    );

    throw error;
  }
}

/**
 * Batch grade all pending submissions for an assignment
 * @param {Object} fastify - Fastify instance
 * @param {string} assignmentId - Assignment UUID
 * @returns {Promise<Object>} Batch grading results
 */
async function batchGradeAssignment(fastify, assignmentId) {
  // Get assignment with rubric
  const assignmentResult = await fastify.db.query(
    `SELECT a.*, r.criteria as rubric_criteria
     FROM assignments a
     LEFT JOIN rubrics r ON a.rubric_id = r.id
     WHERE a.id = $1`,
    [assignmentId]
  );

  if (assignmentResult.rows.length === 0) {
    throw new Error('Assignment not found');
  }

  const assignment = assignmentResult.rows[0];

  // Get pending submissions
  const submissionsResult = await fastify.db.query(
    `SELECT s.* FROM submissions s
     LEFT JOIN grades g ON g.submission_id = s.id
     WHERE s.assignment_id = $1 AND s.status = 'pending' AND g.id IS NULL
     ORDER BY s.submitted_at ASC`,
    [assignmentId]
  );

  if (submissionsResult.rows.length === 0) {
    return {
      success: true,
      message: 'No pending submissions to grade',
      graded: 0,
      failed: 0
    };
  }

  const submissions = submissionsResult.rows;

  // Batch grade
  const results = await openaiService.batchGrade(
    submissions,
    assignment.rubric_criteria || {},
    assignment.description || '',
    assignment.reference_answer || '',
    assignment.total_points || 100
  );

  // Store results
  let graded = 0;
  let failed = 0;

  for (const result of results) {
    if (result.error) {
      failed++;
      await fastify.db.query(
        "UPDATE submissions SET status = 'failed' WHERE id = $1",
        [result.submission_id]
      );
    } else {
      try {
        await fastify.db.transaction(async (client) => {
          await client.query(
            `INSERT INTO grades (id, submission_id, score, feedback, rubric_scores, ai_response, graded_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [
              uuidv4(),
              result.submission_id,
              result.score,
              result.feedback,
              JSON.stringify(result.rubric_scores),
              JSON.stringify(result.ai_response)
            ]
          );

          await client.query(
            "UPDATE submissions SET status = 'graded' WHERE id = $1",
            [result.submission_id]
          );
        });
        graded++;
      } catch (error) {
        failed++;
        fastify.log.error({ error: error.message, submission_id: result.submission_id }, 'Failed to store grade');
      }
    }
  }

  return {
    success: true,
    total: submissions.length,
    graded,
    failed
  };
}

/**
 * Get grading statistics for an assignment
 * @param {Object} fastify - Fastify instance
 * @param {string} assignmentId - Assignment UUID
 * @returns {Promise<Object>} Statistics
 */
async function getAssignmentStats(fastify, assignmentId) {
  const result = await fastify.db.query(
    `SELECT 
       COUNT(DISTINCT s.id) as total_submissions,
       COUNT(DISTINCT g.id) as graded_count,
       COUNT(DISTINCT CASE WHEN s.status = 'pending' THEN s.id END) as pending_count,
       COUNT(DISTINCT CASE WHEN s.status = 'failed' THEN s.id END) as failed_count,
       AVG(g.score) as average_score,
       MIN(g.score) as min_score,
       MAX(g.score) as max_score,
       STDDEV(g.score) as score_stddev
     FROM submissions s
     LEFT JOIN grades g ON g.submission_id = s.id
     WHERE s.assignment_id = $1`,
    [assignmentId]
  );

  return result.rows[0];
}

/**
 * Grade a single submission using AI
 * @param {Object} options - Grading options
 * @param {string} options.submissionContent - The student's submission content
 * @param {string} [options.assignmentDescription] - Assignment description for context
 * @param {string} [options.referenceAnswer] - Reference answer for comparison
 * @param {number} [options.totalPoints] - Total points for the assignment
 * @param {string} [options.rubricId] - Rubric ID if available
 * @param {Object} [options.db] - Database connection for fetching rubric
 * @returns {Promise<{score: number, feedback: string, confidence?: number}>}
 */
async function gradeSubmission({ submissionContent, assignmentDescription, referenceAnswer = '', totalPoints = 100, rubricId, db }) {
  // Check if content is a placeholder (file not properly extracted)
  if (!submissionContent || submissionContent.trim().length === 0) {
    throw new Error('Submission content is empty. Unable to grade.');
  }
  
  if (submissionContent.startsWith('[PDF File:') || submissionContent.startsWith('[Document:')) {
    throw new Error('Unable to grade: PDF/document text was not extracted. Please ask the student to resubmit with a text-readable PDF or type their answer directly.');
  }

  let rubricCriteria = {};
  
  // Try to fetch rubric if rubricId and db are provided
  if (rubricId && db) {
    try {
      const rubricResult = await db.query(
        'SELECT criteria FROM rubrics WHERE id = $1',
        [rubricId]
      );
      if (rubricResult.rows.length > 0 && rubricResult.rows[0].criteria) {
        rubricCriteria = rubricResult.rows[0].criteria;
      }
    } catch (err) {
      logger.warn({ rubricId, error: err.message }, 'Failed to fetch rubric, continuing without it');
      // Continue without rubric
    }
  }

  try {
    const result = await openaiService.gradeSubmission({
      studentAnswer: submissionContent,
      referenceAnswer: referenceAnswer,
      rubric: rubricCriteria,
      assignmentDescription: assignmentDescription || '',
      totalPoints
    });

    return {
      score: result.score,
      feedback: result.feedback,
      confidence: 1.0
    };
  } catch (error) {
    // Fallback: if OpenAI fails, throw error to let caller handle it
    throw new Error(`AI grading failed: ${error.message}`);
  }
}

module.exports = {
  gradeSubmissionById,
  batchGradeAssignment,
  getAssignmentStats,
  gradeSubmission
};
