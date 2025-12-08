const express = require('express');
const { pool } = require('../db');
const { authMiddleware, optionalAuth } = require('../middleware/auth');
const { awardXpDirect, awardCommentXp, XP_REWARDS, getNextLevelXp, getCurrentLevelXp } = require('../services/xp');

const router = express.Router();

router.get('/', optionalAuth, async (req, res) => {
  try {
    const { category, status, limit = 20, offset = 0 } = req.query;
    
    let query = `
      SELECT cp.*, u.display_name as author_name, u.avatar_url as author_avatar
      FROM community_posts cp
      JOIN users u ON cp.author_id = u.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (category && category !== 'all') {
      query += ` AND cp.category = $${paramIndex}`;
      params.push(category);
      paramIndex++;
    }
    
    if (status && status !== 'all') {
      query += ` AND cp.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    query += ` ORDER BY cp.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), parseInt(offset));
    
    const result = await pool.query(query, params);
    
    const posts = result.rows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      imageUrl: row.image_url,
      status: row.status,
      commentsCount: row.comments_count,
      authorId: row.author_id,
      authorName: row.author_name,
      authorAvatar: row.author_avatar,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
    
    res.json(posts);
  } catch (error) {
    console.error('Get community posts error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT cp.*, u.display_name as author_name, u.avatar_url as author_avatar
      FROM community_posts cp
      JOIN users u ON cp.author_id = u.id
      WHERE cp.id = $1
    `, [req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    const row = result.rows[0];
    res.json({
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      imageUrl: row.image_url,
      status: row.status,
      commentsCount: row.comments_count,
      authorId: row.author_id,
      authorName: row.author_name,
      authorAvatar: row.author_avatar,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  } catch (error) {
    console.error('Get post error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    console.log('[COMMUNITY] Incoming POST body:', JSON.stringify(req.body));
    console.log('[COMMUNITY] User ID from auth:', req.userId);
    
    const { title, description, category, imageUrl } = req.body;
    
    if (!title || !description || !category) {
      console.log('[COMMUNITY] Missing required fields:', { title: !!title, description: !!description, category: !!category });
      return res.status(400).json({ error: 'Title, description, and category are required' });
    }
    
    const result = await pool.query(`
      INSERT INTO community_posts (author_id, title, description, category, image_url)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [req.userId, title, description, category, imageUrl || null]);
    
    const userResult = await pool.query(
      'SELECT display_name, avatar_url FROM users WHERE id = $1',
      [req.userId]
    );
    
    const row = result.rows[0];
    const user = userResult.rows[0];
    
    console.log('[COMMUNITY] Successfully created post with id:', row.id);
    
    const xpResult = await awardXpDirect(req.userId, XP_REWARDS.community_post, 'community_post');
    
    res.status(201).json({
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      imageUrl: row.image_url,
      status: row.status,
      commentsCount: row.comments_count,
      authorId: row.author_id,
      authorName: user.display_name,
      authorAvatar: user.avatar_url,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      xpAwarded: xpResult.success ? xpResult.xpAwarded : 0,
      totalXp: xpResult.success ? xpResult.xp : undefined,
      level: xpResult.success ? xpResult.level : undefined,
      leveledUp: xpResult.success ? xpResult.leveledUp : false,
      nextLevelXp: xpResult.success ? xpResult.nextLevelXp : undefined,
      currentLevelXp: xpResult.success ? xpResult.currentLevelXp : undefined
    });
  } catch (error) {
    console.error('[COMMUNITY] Create post error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!['open', 'answered', 'solved'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    
    const checkResult = await pool.query(
      'SELECT author_id FROM community_posts WHERE id = $1',
      [req.params.id]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    if (checkResult.rows[0].author_id !== req.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    await pool.query(
      'UPDATE community_posts SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, req.params.id]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Update post status error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id/comments', optionalAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT cc.*, u.display_name as author_name, u.avatar_url as author_avatar,
             v.title as video_title, v.thumbnail_url as video_thumbnail
      FROM community_comments cc
      JOIN users u ON cc.user_id = u.id
      LEFT JOIN videos v ON cc.linked_video_id = v.id
      WHERE cc.post_id = $1
      ORDER BY cc.is_solution DESC, cc.created_at ASC
    `, [req.params.id]);
    
    const comments = result.rows.map(row => ({
      id: row.id,
      content: row.content,
      isSolution: row.is_solution,
      authorId: row.user_id,
      authorName: row.author_name,
      authorAvatar: row.author_avatar,
      linkedVideoId: row.linked_video_id,
      linkedVideoTitle: row.video_title,
      linkedVideoThumbnail: row.video_thumbnail,
      createdAt: row.created_at
    }));
    
    res.json(comments);
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/comments', authMiddleware, async (req, res) => {
  try {
    console.log('[COMMUNITY] Incoming comment POST body:', JSON.stringify(req.body));
    console.log('[COMMUNITY] Comment for post:', req.params.id, 'by user:', req.userId);
    
    const { content, linkedVideoId } = req.body;
    
    if (!content) {
      console.log('[COMMUNITY] Missing content in comment');
      return res.status(400).json({ error: 'Content is required' });
    }
    
    const postCheck = await pool.query(
      'SELECT id FROM community_posts WHERE id = $1',
      [req.params.id]
    );
    
    if (postCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    const result = await pool.query(`
      INSERT INTO community_comments (post_id, user_id, content, linked_video_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [req.params.id, req.userId, content, linkedVideoId || null]);
    
    await pool.query(
      'UPDATE community_posts SET comments_count = comments_count + 1 WHERE id = $1',
      [req.params.id]
    );
    
    const userResult = await pool.query(
      'SELECT display_name, avatar_url FROM users WHERE id = $1',
      [req.userId]
    );
    
    let videoData = null;
    if (linkedVideoId) {
      const videoResult = await pool.query(
        'SELECT title, thumbnail_url FROM videos WHERE id = $1',
        [linkedVideoId]
      );
      if (videoResult.rows.length > 0) {
        videoData = videoResult.rows[0];
      }
    }
    
    const row = result.rows[0];
    const user = userResult.rows[0];
    
    console.log('[COMMUNITY] Successfully created comment with id:', row.id);
    
    const xpResult = await awardCommentXp(req.userId, req.params.id);
    
    res.status(201).json({
      id: row.id,
      content: row.content,
      isSolution: row.is_solution,
      authorId: row.user_id,
      authorName: user.display_name,
      authorAvatar: user.avatar_url,
      linkedVideoId: row.linked_video_id,
      linkedVideoTitle: videoData?.title,
      linkedVideoThumbnail: videoData?.thumbnail_url,
      createdAt: row.created_at,
      xpAwarded: xpResult.success && xpResult.awarded ? xpResult.xpAwarded : 0,
      totalXp: xpResult.success && xpResult.awarded ? xpResult.xp : undefined,
      level: xpResult.success && xpResult.awarded ? xpResult.level : undefined,
      leveledUp: xpResult.success && xpResult.awarded ? xpResult.leveledUp : false
    });
  } catch (error) {
    console.error('[COMMUNITY] Add comment error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:postId/comments/:commentId/solution', authMiddleware, async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    
    const postCheck = await pool.query(
      'SELECT author_id FROM community_posts WHERE id = $1',
      [postId]
    );
    
    if (postCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    if (postCheck.rows[0].author_id !== req.userId) {
      return res.status(403).json({ error: 'Only the post author can mark solutions' });
    }
    
    const commentCheck = await pool.query(
      'SELECT user_id FROM community_comments WHERE id = $1 AND post_id = $2',
      [commentId, postId]
    );
    
    if (commentCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    
    const helperUserId = commentCheck.rows[0].user_id;
    
    await pool.query(
      'UPDATE community_comments SET is_solution = false WHERE post_id = $1',
      [postId]
    );
    
    await pool.query(
      'UPDATE community_comments SET is_solution = true WHERE id = $1 AND post_id = $2',
      [commentId, postId]
    );
    
    await pool.query(
      'UPDATE community_posts SET status = $1, updated_at = NOW() WHERE id = $2',
      ['solved', postId]
    );
    
    let xpResult = { success: false };
    if (helperUserId && helperUserId !== req.userId) {
      xpResult = await awardXpDirect(helperUserId, XP_REWARDS.post_solved, 'post_solved');
      console.log(`[COMMUNITY] Awarded ${XP_REWARDS.post_solved} XP to helper ${helperUserId} for solving post ${postId}`);
    }
    
    res.json({ 
      success: true,
      helperXpAwarded: xpResult.success ? xpResult.xpAwarded : 0
    });
  } catch (error) {
    console.error('Mark solution error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
