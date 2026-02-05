/**
 * Quiz Routes
 * Manage quiz questions and answers
 */

const { v4: uuidv4 } = require('uuid');

const questionSchema = {
  type: 'object',
  required: ['question_type', 'question_text', 'points'],
  properties: {
    question_type: { type: 'string', enum: ['multiple_choice', 'true_false', 'short_answer', 'essay'] },
    question_text: { type: 'string', minLength: 1 },
    question_image_url: { type: ['string', 'null'] },
    options: { 
      type: ['array', 'null'],
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          is_correct: { type: 'boolean' }
        }
      }
    },
    correct_answers: { type: ['array', 'null'], items: { type: 'string' } },
    reference_answer: { type: ['string', 'null'] },
    points: { type: 'integer', minimum: 1 },
    explanation: { type: ['string', 'null'] },
    allow_partial_credit: { type: 'boolean' }
  }
};

async function quizRoutes(fastify, options) {
  
  /**
   * POST /api/v1/quizzes/:assignmentId/questions
   * Add a question to a quiz assignment
   */
  fastify.post('/:assignmentId/questions', {
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])],
    schema: { body: questionSchema }
  }, async (request, reply) => {
    const { assignmentId } = request.params;
    const userId = request.user.id;
    const { 
      question_type, question_text, question_image_url, options, 
      correct_answers, reference_answer, points, explanation, allow_partial_credit 
    } = request.body;

    // Verify assignment exists and is owned by user
    const assignmentCheck = await fastify.db.query(
      'SELECT id, instructor_id, assignment_type FROM assignments WHERE id = $1',
      [assignmentId]
    );

    if (assignmentCheck.rows.length === 0) {
      throw fastify.createError(404, 'Assignment not found', 'ASSIGNMENT_NOT_FOUND');
    }

    if (assignmentCheck.rows[0].instructor_id !== userId && request.user.role !== 'admin') {
      throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
    }

    // Auto-set assignment to quiz type if not already
    if (assignmentCheck.rows[0].assignment_type !== 'quiz') {
      await fastify.db.query(
        "UPDATE assignments SET assignment_type = 'quiz', updated_at = NOW() WHERE id = $1",
        [assignmentId]
      );
    }

    // Get next question order
    const orderResult = await fastify.db.query(
      'SELECT COALESCE(MAX(question_order), 0) + 1 as next_order FROM assignment_questions WHERE assignment_id = $1',
      [assignmentId]
    );
    const nextOrder = orderResult.rows[0].next_order;

    // Validate question based on type
    if (question_type === 'multiple_choice' && (!options || options.length < 2)) {
      throw fastify.createError(400, 'Multiple choice questions require at least 2 options', 'INVALID_OPTIONS');
    }

    if (question_type === 'multiple_choice' && !options.some(o => o.is_correct)) {
      throw fastify.createError(400, 'At least one option must be marked as correct', 'NO_CORRECT_ANSWER');
    }

    if (question_type === 'true_false') {
      // Auto-generate true/false options if not provided
      const tfOptions = options || [
        { id: 'true', text: 'True', is_correct: false },
        { id: 'false', text: 'False', is_correct: false }
      ];
      if (!tfOptions.some(o => o.is_correct)) {
        throw fastify.createError(400, 'Must specify the correct answer (true or false)', 'NO_CORRECT_ANSWER');
      }
    }

    const result = await fastify.db.query(
      `INSERT INTO assignment_questions 
       (id, assignment_id, question_order, question_type, question_text, question_image_url,
        options, correct_answers, reference_answer, points, explanation, allow_partial_credit)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        uuidv4(), assignmentId, nextOrder, question_type, question_text, question_image_url || null,
        options ? JSON.stringify(options) : null,
        correct_answers ? JSON.stringify(correct_answers) : null,
        reference_answer || null, points || 10, explanation || null, 
        allow_partial_credit !== false
      ]
    );

    // Update assignment total points
    await updateAssignmentTotalPoints(fastify, assignmentId);

    return reply.code(201).send({
      success: true,
      data: result.rows[0]
    });
  });

  /**
   * GET /api/v1/quizzes/:assignmentId/questions
   * Get all questions for a quiz
   */
  fastify.get('/:assignmentId/questions', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { assignmentId } = request.params;
    const { role, id: userId } = request.user;

    // Get assignment
    const assignment = await fastify.db.query(
      'SELECT * FROM assignments WHERE id = $1',
      [assignmentId]
    );

    if (assignment.rows.length === 0) {
      throw fastify.createError(404, 'Assignment not found', 'ASSIGNMENT_NOT_FOUND');
    }

    const isInstructor = role === 'instructor' || role === 'admin';
    const isOwner = assignment.rows[0].instructor_id === userId;

    // Get questions
    let query = `
      SELECT id, assignment_id, question_order, question_type, question_text, 
             question_image_url, options, points, explanation
      ${isInstructor && isOwner ? ', correct_answers, reference_answer, allow_partial_credit' : ''}
      FROM assignment_questions 
      WHERE assignment_id = $1 
      ORDER BY question_order ASC
    `;

    const result = await fastify.db.query(query, [assignmentId]);

    // For students, hide correct answers from options
    let questions = result.rows.map(q => {
      // Parse options if needed
      let parsedOptions = q.options;
      if (typeof parsedOptions === 'string') {
        try { parsedOptions = JSON.parse(parsedOptions); } catch (e) { parsedOptions = []; }
      }
      return { ...q, options: parsedOptions };
    });
    
    if (!isInstructor || !isOwner) {
      questions = questions.map(q => {
        if (q.options && Array.isArray(q.options)) {
          q.options = q.options.map(opt => ({
            id: opt.id,
            text: opt.text
            // is_correct is hidden
          }));
        }
        return q;
      });
    }

    return {
      success: true,
      data: questions,
      meta: {
        total_questions: questions.length,
        total_points: questions.reduce((sum, q) => sum + (q.points || 0), 0)
      }
    };
  });

  /**
   * PUT /api/v1/quizzes/:assignmentId/questions/:questionId
   * Update a question
   */
  fastify.put('/:assignmentId/questions/:questionId', {
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])],
    schema: { body: { type: 'object', properties: questionSchema.properties } }
  }, async (request, reply) => {
    const { assignmentId, questionId } = request.params;
    const userId = request.user.id;
    const updates = request.body;

    // Verify ownership
    const check = await fastify.db.query(
      `SELECT q.id, a.instructor_id 
       FROM assignment_questions q
       JOIN assignments a ON q.assignment_id = a.id
       WHERE q.id = $1 AND a.id = $2`,
      [questionId, assignmentId]
    );

    if (check.rows.length === 0) {
      throw fastify.createError(404, 'Question not found', 'QUESTION_NOT_FOUND');
    }

    if (check.rows[0].instructor_id !== userId && request.user.role !== 'admin') {
      throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
    }

    // Build update query
    const allowedFields = ['question_type', 'question_text', 'question_image_url', 'options', 
                           'correct_answers', 'reference_answer', 'points', 'explanation', 'allow_partial_credit'];
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        if (field === 'options' || field === 'correct_answers') {
          setClauses.push(`${field} = $${paramIndex}`);
          values.push(JSON.stringify(updates[field]));
        } else {
          setClauses.push(`${field} = $${paramIndex}`);
          values.push(updates[field]);
        }
        paramIndex++;
      }
    }

    if (setClauses.length === 0) {
      throw fastify.createError(400, 'No valid fields to update', 'NO_UPDATES');
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(questionId);

    const result = await fastify.db.query(
      `UPDATE assignment_questions SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    // Update assignment total points
    await updateAssignmentTotalPoints(fastify, assignmentId);

    return {
      success: true,
      data: result.rows[0]
    };
  });

  /**
   * DELETE /api/v1/quizzes/:assignmentId/questions/:questionId
   * Delete a question
   */
  fastify.delete('/:assignmentId/questions/:questionId', {
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])]
  }, async (request, reply) => {
    const { assignmentId, questionId } = request.params;
    const userId = request.user.id;

    // Verify ownership
    const check = await fastify.db.query(
      `SELECT q.id, q.question_order, a.instructor_id 
       FROM assignment_questions q
       JOIN assignments a ON q.assignment_id = a.id
       WHERE q.id = $1 AND a.id = $2`,
      [questionId, assignmentId]
    );

    if (check.rows.length === 0) {
      throw fastify.createError(404, 'Question not found', 'QUESTION_NOT_FOUND');
    }

    if (check.rows[0].instructor_id !== userId && request.user.role !== 'admin') {
      throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
    }

    const deletedOrder = check.rows[0].question_order;

    // Delete the question
    await fastify.db.query('DELETE FROM assignment_questions WHERE id = $1', [questionId]);

    // Reorder remaining questions
    await fastify.db.query(
      `UPDATE assignment_questions 
       SET question_order = question_order - 1, updated_at = NOW()
       WHERE assignment_id = $1 AND question_order > $2`,
      [assignmentId, deletedOrder]
    );

    // Update assignment total points
    await updateAssignmentTotalPoints(fastify, assignmentId);

    return reply.code(204).send();
  });

  /**
   * PUT /api/v1/quizzes/:assignmentId/questions/reorder
   * Reorder questions
   */
  fastify.put('/:assignmentId/questions/reorder', {
    preHandler: [fastify.authenticate, fastify.authorize(['instructor', 'admin'])],
    schema: {
      body: {
        type: 'object',
        required: ['question_ids'],
        properties: {
          question_ids: { type: 'array', items: { type: 'string', format: 'uuid' } }
        }
      }
    }
  }, async (request, reply) => {
    const { assignmentId } = request.params;
    const { question_ids } = request.body;
    const userId = request.user.id;

    // Verify ownership
    const check = await fastify.db.query(
      'SELECT instructor_id FROM assignments WHERE id = $1',
      [assignmentId]
    );

    if (check.rows.length === 0) {
      throw fastify.createError(404, 'Assignment not found', 'ASSIGNMENT_NOT_FOUND');
    }

    if (check.rows[0].instructor_id !== userId && request.user.role !== 'admin') {
      throw fastify.createError(403, 'Access denied', 'FORBIDDEN');
    }

    // Update order for each question
    for (let i = 0; i < question_ids.length; i++) {
      await fastify.db.query(
        'UPDATE assignment_questions SET question_order = $1, updated_at = NOW() WHERE id = $2 AND assignment_id = $3',
        [i + 1, question_ids[i], assignmentId]
      );
    }

    return { success: true, message: 'Questions reordered successfully' };
  });

  /**
   * POST /api/v1/quizzes/:assignmentId/submit
   * Submit quiz answers
   */
  fastify.post('/:assignmentId/submit', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { assignmentId } = request.params;
    const userId = request.user.id;
    const { answers } = request.body; // Array of { question_id, answer_text, selected_options, time_spent_seconds }

    if (!answers || !Array.isArray(answers)) {
      throw fastify.createError(400, 'Answers must be provided as an array', 'INVALID_ANSWERS');
    }

    // Get student record
    const studentResult = await fastify.db.query(
      'SELECT id FROM students WHERE user_id = $1',
      [userId]
    );

    if (studentResult.rows.length === 0) {
      throw fastify.createError(403, 'Student record not found', 'STUDENT_NOT_FOUND');
    }

    const studentId = studentResult.rows[0].id;

    // Check assignment exists and is a quiz
    const assignment = await fastify.db.query(
      'SELECT * FROM assignments WHERE id = $1',
      [assignmentId]
    );

    if (assignment.rows.length === 0) {
      throw fastify.createError(404, 'Assignment not found', 'ASSIGNMENT_NOT_FOUND');
    }

    if (assignment.rows[0].status !== 'active') {
      throw fastify.createError(400, 'This quiz is not currently active', 'QUIZ_NOT_ACTIVE');
    }

    // Check for existing submission
    let submission = await fastify.db.query(
      'SELECT * FROM submissions WHERE assignment_id = $1 AND student_id = $2 ORDER BY version DESC LIMIT 1',
      [assignmentId, studentId]
    );

    let submissionId;
    let version = 1;

    if (submission.rows.length > 0 && submission.rows[0].status === 'graded') {
      // Check if resubmission is allowed
      const maxResubs = assignment.rows[0].max_resubmissions || 0;
      if (submission.rows[0].version >= maxResubs + 1) {
        throw fastify.createError(400, 'Maximum resubmissions reached', 'MAX_RESUBMISSIONS');
      }
      version = submission.rows[0].version + 1;
    }

    // Create or update submission
    if (submission.rows.length === 0 || submission.rows[0].status === 'graded') {
      const newSub = await fastify.db.query(
        `INSERT INTO submissions (id, student_id, assignment_id, content, version, status, submitted_at)
         VALUES ($1, $2, $3, $4, $5, 'submitted', NOW())
         RETURNING *`,
        [uuidv4(), studentId, assignmentId, 'Quiz submission', version]
      );
      submissionId = newSub.rows[0].id;
    } else {
      submissionId = submission.rows[0].id;
      await fastify.db.query(
        "UPDATE submissions SET status = 'submitted', submitted_at = NOW() WHERE id = $1",
        [submissionId]
      );
    }

    // Get all questions for grading
    const questionsRaw = await fastify.db.query(
      'SELECT * FROM assignment_questions WHERE assignment_id = $1',
      [assignmentId]
    );

    // Parse options JSON if stored as string
    const questions = questionsRaw.rows.map(q => ({
      ...q,
      options: typeof q.options === 'string' ? JSON.parse(q.options) : q.options,
      correct_answers: typeof q.correct_answers === 'string' ? JSON.parse(q.correct_answers) : q.correct_answers
    }));

    const questionsMap = new Map(questions.map(q => [q.id, q]));

    // Process each answer
    let totalScore = 0;
    let totalPoints = 0;
    const answerResults = [];

    for (const answer of answers) {
      const question = questionsMap.get(answer.question_id);
      if (!question) continue;

      totalPoints += question.points;

      // Grade the answer based on question type
      const gradeResult = await gradeAnswer(fastify, question, answer);
      totalScore += gradeResult.points_earned;

      // Insert or update answer
      await fastify.db.query(
        `INSERT INTO submission_answers 
         (id, submission_id, question_id, answer_text, selected_options, is_correct, points_earned, ai_feedback, time_spent_seconds, graded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (submission_id, question_id) 
         DO UPDATE SET answer_text = $4, selected_options = $5, is_correct = $6, points_earned = $7, ai_feedback = $8, time_spent_seconds = $9, graded_at = NOW()`,
        [
          uuidv4(), submissionId, answer.question_id, 
          answer.answer_text || null,
          answer.selected_options ? JSON.stringify(answer.selected_options) : null,
          gradeResult.is_correct,
          gradeResult.points_earned,
          gradeResult.feedback || null,
          answer.time_spent_seconds || null
        ]
      );

      answerResults.push({
        question_id: answer.question_id,
        question_text: question.question_text,
        question_type: question.question_type,
        correct_answer: question.options?.find(o => o.is_correct)?.text || question.correct_answers?.[0] || null,
        student_answer: answer.answer_text,
        explanation: question.explanation || null,
        ...gradeResult
      });
    }

    // Calculate final score as percentage
    const scorePercent = totalPoints > 0 ? Math.round((totalScore / totalPoints) * 100) : 0;

    // Create grade record
    const gradeId = uuidv4();
    await fastify.db.query(
      `INSERT INTO grades (id, submission_id, score, feedback, graded_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (submission_id) DO UPDATE SET score = $3, feedback = $4, graded_at = NOW()`,
      [gradeId, submissionId, scorePercent, `Quiz completed. Score: ${totalScore}/${totalPoints} points`]
    );

    // Update submission status
    await fastify.db.query(
      "UPDATE submissions SET status = 'graded' WHERE id = $1",
      [submissionId]
    );

    return reply.code(201).send({
      success: true,
      data: {
        submission_id: submissionId,
        score: scorePercent,
        points_earned: totalScore,
        total_points: totalPoints,
        answers: assignment.rows[0].show_correct_answers ? answerResults : undefined
      }
    });
  });

  /**
   * GET /api/v1/quizzes/:assignmentId/results
   * Get quiz results for a student
   */
  fastify.get('/:assignmentId/results', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { assignmentId } = request.params;
    const userId = request.user.id;

    // Get student record
    const studentResult = await fastify.db.query(
      'SELECT id FROM students WHERE user_id = $1',
      [userId]
    );

    if (studentResult.rows.length === 0) {
      throw fastify.createError(403, 'Student record not found', 'STUDENT_NOT_FOUND');
    }

    const studentId = studentResult.rows[0].id;

    // Get submission and answers
    const submission = await fastify.db.query(
      `SELECT s.*, g.score, g.feedback as grade_feedback
       FROM submissions s
       LEFT JOIN grades g ON g.submission_id = s.id
       WHERE s.assignment_id = $1 AND s.student_id = $2
       ORDER BY s.version DESC LIMIT 1`,
      [assignmentId, studentId]
    );

    if (submission.rows.length === 0) {
      throw fastify.createError(404, 'No submission found', 'SUBMISSION_NOT_FOUND');
    }

    const submissionData = submission.rows[0];

    // Get answers with question details
    const answers = await fastify.db.query(
      `SELECT sa.*, q.question_text, q.question_type, q.options, q.points, q.explanation,
              q.correct_answers, q.reference_answer
       FROM submission_answers sa
       JOIN assignment_questions q ON sa.question_id = q.id
       WHERE sa.submission_id = $1
       ORDER BY q.question_order`,
      [submissionData.id]
    );

    // Get assignment to check if we should show correct answers
    const assignment = await fastify.db.query(
      'SELECT show_correct_answers FROM assignments WHERE id = $1',
      [assignmentId]
    );

    const showAnswers = assignment.rows[0]?.show_correct_answers !== false;

    return {
      success: true,
      data: {
        submission: {
          id: submissionData.id,
          status: submissionData.status,
          score: submissionData.score,
          submitted_at: submissionData.submitted_at,
          feedback: submissionData.grade_feedback
        },
        answers: answers.rows.map(a => ({
          question_id: a.question_id,
          question_text: a.question_text,
          question_type: a.question_type,
          your_answer: a.answer_text,
          selected_options: a.selected_options,
          is_correct: a.is_correct,
          points_earned: parseFloat(a.points_earned),
          points_possible: a.points,
          feedback: a.ai_feedback,
          explanation: showAnswers ? a.explanation : undefined,
          correct_answer: showAnswers ? (a.correct_answers || a.reference_answer) : undefined,
          options: showAnswers ? a.options : a.options?.map(o => ({ id: o.id, text: o.text }))
        }))
      }
    };
  });
}

/**
 * Grade an individual answer
 */
async function gradeAnswer(fastify, question, answer) {
  const { question_type, options, correct_answers, reference_answer, points, allow_partial_credit } = question;

  switch (question_type) {
    case 'multiple_choice': {
      const selectedId = answer.answer_text || answer.selected_options?.[0];
      const correctOption = options?.find(o => o.is_correct);
      const isCorrect = correctOption && selectedId === correctOption.id;
      return {
        is_correct: isCorrect,
        points_earned: isCorrect ? points : 0,
        feedback: isCorrect ? 'Correct!' : `Incorrect. The correct answer was: ${correctOption?.text || 'N/A'}`
      };
    }

    case 'true_false': {
      const selectedId = answer.answer_text?.toLowerCase();
      const correctOption = options?.find(o => o.is_correct);
      const isCorrect = correctOption && selectedId === correctOption.id;
      return {
        is_correct: isCorrect,
        points_earned: isCorrect ? points : 0,
        feedback: isCorrect ? 'Correct!' : `Incorrect. The answer was: ${correctOption?.text || correctOption?.id || 'N/A'}`
      };
    }

    case 'short_answer': {
      const studentAnswer = (answer.answer_text || '').trim().toLowerCase();
      
      // Check against correct answers list (exact match first for speed)
      if (correct_answers && correct_answers.length > 0) {
        const isExactMatch = correct_answers.some(ca => 
          ca.toLowerCase().trim() === studentAnswer
        );
        
        if (isExactMatch) {
          return {
            is_correct: true,
            points_earned: points,
            feedback: 'Correct!'
          };
        }
      }

      // If no exact match, use AI for semantic matching
      if (reference_answer) {
        try {
          const openaiService = require('../services/openai-service');
          const aiResult = await openaiService.gradeShortAnswer({
            studentAnswer: answer.answer_text || '',
            referenceAnswer: reference_answer,
            question: question.question_text,
            points: points
          });
          
          return {
            is_correct: aiResult.is_correct,
            points_earned: aiResult.score,
            feedback: aiResult.feedback
          };
        } catch (err) {
          fastify.log.error({ err }, 'AI grading failed for short answer');
          return {
            is_correct: false,
            points_earned: 0,
            feedback: 'Unable to grade automatically. Instructor will review.'
          };
        }
      }

      return {
        is_correct: false,
        points_earned: 0,
        feedback: 'Answer does not match expected response.'
      };
    }

    case 'essay': {
      // Always use AI for essay grading
      if (!answer.answer_text || answer.answer_text.trim().length === 0) {
        return {
          is_correct: false,
          points_earned: 0,
          feedback: 'No answer provided.'
        };
      }

      try {
        const openaiService = require('../services/openai-service');
        const aiResult = await openaiService.gradeEssay({
          studentAnswer: answer.answer_text,
          question: question.question_text,
          referenceAnswer: reference_answer || '',
          points: points
        });
        
        return {
          is_correct: aiResult.is_correct,
          points_earned: aiResult.score,
          feedback: aiResult.feedback
        };
      } catch (err) {
        fastify.log.error({ err }, 'AI grading failed for essay');
        return {
          is_correct: false,
          points_earned: 0,
          feedback: 'Unable to grade automatically. Instructor will review.'
        };
      }
    }

    default:
      return {
        is_correct: false,
        points_earned: 0,
        feedback: 'Unknown question type'
      };
  }
}

/**
 * Update assignment total points based on questions
 */
async function updateAssignmentTotalPoints(fastify, assignmentId) {
  const result = await fastify.db.query(
    'SELECT COALESCE(SUM(points), 0) as total FROM assignment_questions WHERE assignment_id = $1',
    [assignmentId]
  );
  
  await fastify.db.query(
    'UPDATE assignments SET total_points = $1, updated_at = NOW() WHERE id = $2',
    [result.rows[0].total || 100, assignmentId]
  );
}

module.exports = quizRoutes;
