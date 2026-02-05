/**
 * OpenAI Grading Service
 * GPT-4 integration for AI-powered grading
 */

const OpenAI = require('openai');
const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Grade a student's submission using AI
 * @param {Object} params - Grading parameters
 * @param {string} params.studentAnswer - The student's submitted answer
 * @param {string} params.rubric - The grading rubric criteria (JSON)
 * @param {string} params.assignmentDescription - Assignment description/instructions
 * @param {string} params.referenceAnswer - Reference/model answer for comparison (optional)
 * @param {number} params.totalPoints - Maximum points for the assignment
 * @returns {Promise<Object>} Grading result with score and feedback
 */
async function gradeSubmission({ studentAnswer, rubric, assignmentDescription, referenceAnswer = '', totalPoints = 100 }) {
  if (!studentAnswer || studentAnswer.trim().length === 0) {
    throw new Error('Student answer cannot be empty');
  }

  // Sanitize rubric - ensure it's not binary PDF content
  let rubricText = '';
  if (typeof rubric === 'object' && rubric !== null) {
    rubricText = JSON.stringify(rubric, null, 2);
  } else if (typeof rubric === 'string') {
    // Skip binary content (PDFs start with %PDF or raw binary)
    if (rubric.startsWith('%PDF') || !rubric.trim()) {
      rubricText = 'No rubric criteria provided';
    } else {
      rubricText = rubric.trim();
    }
  } else {
    rubricText = 'No rubric criteria provided';
  }

  // Sanitize assignment description - skip if it's binary PDF
  let descriptionText = '';
  if (typeof assignmentDescription === 'string') {
    if (assignmentDescription.startsWith('%PDF') || !assignmentDescription.trim()) {
      descriptionText = 'No description provided';
    } else {
      descriptionText = assignmentDescription.trim();
    }
  } else {
    descriptionText = 'No description provided';
  }

  // Sanitize reference answer - skip if it's binary PDF
  let referenceText = '';
  if (typeof referenceAnswer === 'string') {
    if (referenceAnswer.startsWith('%PDF') || !referenceAnswer.trim()) {
      referenceText = '';
    } else {
      referenceText = referenceAnswer.trim();
    }
  }

  const systemPrompt = `You are an expert educational grading assistant. Your task is to grade student submissions fairly, consistently, and constructively.

Guidelines:
1. Evaluate the submission against the provided rubric criteria
2. Provide specific, actionable feedback for improvement
3. Be encouraging while maintaining high standards
4. Score each rubric criterion individually
5. Provide an overall score and summary feedback
${referenceText ? '\n6. Use the reference answer as a guide for expected content and quality level' : ''}

Response Format (JSON):
{
  "overall_score": <number 0-${totalPoints}>,
  "percentage": <number 0-100>,
  "rubric_scores": {
    "<criterion_name>": {
      "score": <number>,
      "max_points": <number>,
      "feedback": "<specific feedback for this criterion>"
    }
  },
  "strengths": ["<strength 1>", "<strength 2>"],
  "areas_for_improvement": ["<area 1>", "<area 2>"],
  "overall_feedback": "<comprehensive summary feedback>",
  "suggestions": ["<actionable suggestion 1>", "<actionable suggestion 2>"]
}`;

  const userPrompt = `Please grade the following student submission.

## Assignment Description
${descriptionText}

## Grading Rubric
${rubricText}
${referenceText ? `\n## Reference/Model Answer\n${referenceText}` : ''}

## Total Points Available
${totalPoints}

## Student Submission
${studentAnswer}

Please evaluate this submission and provide detailed feedback in the specified JSON format.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3, // Lower temperature for more consistent grading
      max_tokens: 2000
    });

    const result = JSON.parse(response.choices[0].message.content);

    // Validate response structure
    if (typeof result.overall_score !== 'number' || result.overall_score < 0 || result.overall_score > totalPoints) {
      throw new Error('Invalid score in AI response');
    }

    return {
      score: result.overall_score,
      percentage: result.percentage || Math.round((result.overall_score / totalPoints) * 100),
      rubric_scores: result.rubric_scores || {},
      feedback: result.overall_feedback || '',
      strengths: result.strengths || [],
      areas_for_improvement: result.areas_for_improvement || [],
      suggestions: result.suggestions || [],
      ai_response: result // Store full response for debugging
    };
  } catch (error) {
    logger.error({ error: error.message }, 'OpenAI grading error');
    throw new Error(`Grading failed: ${error.message}`);
  }
}

/**
 * Grade multiple submissions in batch
 * @param {Array<Object>} submissions - Array of submission objects
 * @param {Object} rubric - Shared rubric for all submissions
 * @param {string} assignmentDescription - Assignment description
 * @param {string} referenceAnswer - Reference/model answer for comparison
 * @param {number} totalPoints - Maximum points
 * @returns {Promise<Array<Object>>} Array of grading results
 */
async function batchGrade(submissions, rubric, assignmentDescription, referenceAnswer = '', totalPoints = 100) {
  const results = [];

  // Process in parallel with concurrency limit
  const BATCH_SIZE = 5;

  for (let i = 0; i < submissions.length; i += BATCH_SIZE) {
    const batch = submissions.slice(i, i + BATCH_SIZE);
    
    const batchResults = await Promise.allSettled(
      batch.map(submission => 
        gradeSubmission({
          studentAnswer: submission.content,
          rubric,
          assignmentDescription,
          referenceAnswer,
          totalPoints
        }).then(result => ({
          submission_id: submission.id,
          ...result
        })).catch(error => ({
          submission_id: submission.id,
          error: error.message
        }))
      )
    );

    results.push(...batchResults.map(r => 
      r.status === 'fulfilled' ? r.value : { error: r.reason?.message || 'Unknown error' }
    ));

    // Rate limiting delay between batches
    if (i + BATCH_SIZE < submissions.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return results;
}

/**
 * Generate feedback for a specific rubric criterion
 * @param {string} criterion - The rubric criterion being evaluated
 * @param {string} studentWork - Relevant portion of student's work
 * @param {number} score - Score given for this criterion
 * @param {number} maxPoints - Maximum points for this criterion
 * @returns {Promise<string>} Detailed feedback
 */
async function generateCriterionFeedback(criterion, studentWork, score, maxPoints) {
  const prompt = `As an educational grading assistant, provide specific, constructive feedback for a student who received ${score}/${maxPoints} points on the following criterion:

Criterion: ${criterion}

Student's work excerpt: ${studentWork.substring(0, 500)}

Provide 2-3 sentences of actionable feedback that:
1. Acknowledges what they did well (if applicable)
2. Explains specifically what could be improved
3. Gives a concrete suggestion for improvement`;

  const response = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.5,
    max_tokens: 200
  });

  return response.choices[0].message.content;
}

/**
 * Retry wrapper with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum retry attempts
 * @returns {Promise<any>} Function result
 */
async function withRetry(fn, maxRetries = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Don't retry on non-retryable errors
      if (error.status === 400 || error.status === 401) {
        throw error;
      }

      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
        logger.debug({ attempt, maxRetries, delay }, 'Retrying OpenAI request');
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Convert file to base64 for API submission
 * @param {string} filePath - Path to image file
 * @returns {Promise<string>} Base64 encoded image
 */
async function fileToBase64(filePath) {
  const fileBuffer = await fs.readFile(filePath);
  return fileBuffer.toString('base64');
}

/**
 * Fast semantic grading for quiz short answer questions
 * Uses GPT-3.5-turbo for speed and cost efficiency
 * @param {Object} params - Grading parameters
 * @param {string} params.studentAnswer - The student's answer
 * @param {string} params.referenceAnswer - The expected/reference answer
 * @param {string} params.question - The question text
 * @param {number} params.points - Maximum points for this question
 * @returns {Promise<Object>} Grading result with score and feedback
 */
async function gradeShortAnswer({ studentAnswer, referenceAnswer, question, points = 10 }) {
  if (!studentAnswer || studentAnswer.trim().length === 0) {
    return {
      score: 0,
      percentage: 0,
      feedback: 'No answer provided.'
    };
  }

  const prompt = `You are grading a short answer quiz question. Evaluate if the student's answer conveys the same meaning as the reference answer, even if worded differently.

Question: ${question}

Reference Answer: ${referenceAnswer}

Student's Answer: ${studentAnswer}

Evaluate the student's answer and respond in JSON format:
{
  "score": <number 0-100 representing percentage correctness>,
  "is_correct": <true if score >= 80, false otherwise>,
  "feedback": "<brief 1-2 sentence feedback>"
}

Scoring guidelines:
- 100: Perfect or essentially equivalent answer
- 80-99: Correct with minor differences or missing small details
- 50-79: Partially correct, understands the concept but missing key elements
- 20-49: Shows some understanding but largely incorrect
- 0-19: Incorrect or irrelevant answer

Be lenient with wording differences - focus on whether the student understands the concept.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.1, // Very low for consistent grading
      max_tokens: 200
    });

    const result = JSON.parse(response.choices[0].message.content);
    const scorePercent = Math.min(100, Math.max(0, result.score || 0));
    const pointsEarned = Math.round((scorePercent / 100) * points * 100) / 100;

    return {
      score: pointsEarned,
      percentage: scorePercent,
      feedback: result.feedback || (scorePercent >= 80 ? 'Correct!' : 'Incorrect.'),
      is_correct: scorePercent >= 80
    };
  } catch (error) {
    logger.error({ error: error.message }, 'OpenAI short answer grading error');
    throw new Error(`Short answer grading failed: ${error.message}`);
  }
}

/**
 * Grade an essay question in a quiz using AI
 * Optimized for quiz essays with clear evaluation criteria
 * @param {Object} params - Grading parameters
 * @param {string} params.studentAnswer - The student's essay answer
 * @param {string} params.question - The essay question/prompt
 * @param {string} params.referenceAnswer - Reference answer or key points expected (optional)
 * @param {number} params.points - Maximum points for this question (default: 10)
 * @returns {Promise<Object>} Grading result with score, percentage, and detailed feedback
 */
async function gradeEssay({ studentAnswer, question, referenceAnswer = '', points = 10 }) {
  if (!studentAnswer || studentAnswer.trim().length === 0) {
    return {
      score: 0,
      percentage: 0,
      feedback: 'No answer provided.',
      is_correct: false,
      criteria_scores: {}
    };
  }

  const systemPrompt = `You are an expert educational grading assistant specializing in evaluating essay responses.

Your task is to grade the student's essay answer based on these criteria:
1. **Content & Accuracy (40%)**: Does the answer correctly address the question? Are the facts/concepts accurate?
2. **Completeness (25%)**: Does the answer cover all key aspects of the question?
3. **Clarity & Organization (20%)**: Is the answer well-structured, clear, and easy to follow?
4. **Critical Thinking (15%)**: Does the answer show depth of understanding, analysis, or original insight?

${referenceAnswer ? `Use the reference answer as a guide for expected content and key points that should be covered.` : 'Evaluate based on general correctness and quality of the response.'}

Be fair but thorough. Provide constructive feedback that helps the student improve.

Respond in JSON format:
{
  "score_percentage": <number 0-100>,
  "criteria_scores": {
    "content_accuracy": {"score": <0-40>, "feedback": "<specific feedback>"},
    "completeness": {"score": <0-25>, "feedback": "<specific feedback>"},
    "clarity_organization": {"score": <0-20>, "feedback": "<specific feedback>"},
    "critical_thinking": {"score": <0-15>, "feedback": "<specific feedback>"}
  },
  "overall_feedback": "<comprehensive 2-3 sentence summary of performance>",
  "strengths": ["<strength 1>", "<strength 2>"],
  "improvements": ["<suggestion 1>", "<suggestion 2>"]
}`;

  const userPrompt = `## Essay Question
${question}

${referenceAnswer ? `## Reference Answer / Key Points Expected
${referenceAnswer}` : ''}

## Student's Answer
${studentAnswer}

## Maximum Points: ${points}

Please evaluate this essay response and provide detailed scoring and feedback.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2, // Low temperature for consistent grading
      max_tokens: 1000
    });

    const result = JSON.parse(response.choices[0].message.content);
    
    // Calculate final score
    const scorePercent = Math.max(0, Math.min(100, result.score_percentage || 0));
    const pointsEarned = Math.round((scorePercent / 100) * points * 100) / 100;

    // Build comprehensive feedback
    let feedback = result.overall_feedback || '';
    
    if (result.strengths && result.strengths.length > 0) {
      feedback += `\n\n✓ Strengths: ${result.strengths.join('; ')}`;
    }
    
    if (result.improvements && result.improvements.length > 0) {
      feedback += `\n\n→ Areas for improvement: ${result.improvements.join('; ')}`;
    }

    return {
      score: pointsEarned,
      percentage: scorePercent,
      feedback: feedback.trim(),
      is_correct: scorePercent >= 60, // 60% threshold for essays
      criteria_scores: result.criteria_scores || {}
    };
  } catch (error) {
    logger.error({ error: error.message }, 'OpenAI essay grading error');
    throw new Error(`Essay grading failed: ${error.message}`);
  }
}

module.exports = {
  gradeSubmission,
  gradeShortAnswer,
  gradeEssay,
  fileToBase64,
  batchGrade,
  generateCriterionFeedback,
  withRetry
};
