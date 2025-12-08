const express = require('express');
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.post('/', authMiddleware, async (req, res) => {
  try {
    const reporterUserId = req.userId;
    const { targetUserId, contentId, contentType, reason, message } = req.body;

    if (!contentType || !['video', 'profile', 'comment'].includes(contentType)) {
      return res.status(400).json({ error: 'Invalid content type. Must be video, profile, or comment.' });
    }

    if (!reason || reason.trim() === '') {
      return res.status(400).json({ error: 'Reason is required.' });
    }

    if (contentType === 'video' && !contentId) {
      return res.status(400).json({ error: 'Content ID is required for video reports.' });
    }

    if (contentType === 'profile' && !targetUserId) {
      return res.status(400).json({ error: 'Target user ID is required for profile reports.' });
    }

    if (targetUserId === reporterUserId) {
      return res.status(400).json({ error: 'You cannot report yourself.' });
    }

    const existingReport = await pool.query(
      `SELECT id FROM reports 
       WHERE reporter_user_id = $1 
       AND content_type = $2 
       AND (content_id = $3 OR ($3 IS NULL AND content_id IS NULL))
       AND (target_user_id = $4 OR ($4 IS NULL AND target_user_id IS NULL))
       AND status = 'open'`,
      [reporterUserId, contentType, contentId || null, targetUserId || null]
    );

    if (existingReport.rows.length > 0) {
      return res.status(409).json({ error: 'You have already reported this content.' });
    }

    const result = await pool.query(
      `INSERT INTO reports (reporter_user_id, target_user_id, content_id, content_type, reason, message)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [reporterUserId, targetUserId || null, contentId || null, contentType, reason, message || null]
    );

    res.status(201).json({
      success: true,
      reportId: result.rows[0].id,
      createdAt: result.rows[0].created_at
    });
  } catch (error) {
    console.error('Create report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
