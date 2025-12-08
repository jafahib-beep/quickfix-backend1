const express = require('express');
const { pool } = require('../db');
const { authMiddleware, optionalAuth } = require('../middleware/auth');
const { awardXp, awardXpDirect, XP_REWARDS, getNextLevelXp, getCurrentLevelXp } = require('../services/xp');
const { getBlockedUserIds } = require('./block');

const router = express.Router();

router.get('/', optionalAuth, async (req, res) => {
  try {
    const { category, search, sort = 'recent', limit = 20, offset = 0 } = req.query;
    
    const blockedUserIds = await getBlockedUserIds(req.userId);
    
    let query = `
      SELECT v.*, u.display_name as author_name, u.avatar_url as author_avatar,
             EXISTS(SELECT 1 FROM video_likes WHERE video_id = v.id AND user_id = $1) as is_liked,
             EXISTS(SELECT 1 FROM video_saves WHERE video_id = v.id AND user_id = $1) as is_saved
      FROM videos v
      JOIN users u ON v.author_id = u.id
      WHERE v.is_flagged = false
    `;
    
    const params = [req.userId || null];
    let paramIndex = 2;
    
    if (blockedUserIds.length > 0) {
      query += ` AND v.author_id != ALL($${paramIndex})`;
      params.push(blockedUserIds);
      paramIndex++;
    }
    
    if (category && category !== 'all') {
      query += ` AND v.category = $${paramIndex}`;
      params.push(category);
      paramIndex++;
    }
    
    if (search) {
      query += ` AND (
        v.title ILIKE $${paramIndex} OR 
        v.description ILIKE $${paramIndex} OR 
        $${paramIndex + 1} = ANY(v.tags)
      )`;
      params.push(`%${search}%`);
      params.push(search.toLowerCase());
      paramIndex += 2;
    }
    
    switch (sort) {
      case 'popular':
        query += ' ORDER BY v.likes_count DESC, v.created_at DESC';
        break;
      case 'recent':
      default:
        query += ' ORDER BY v.created_at DESC';
    }
    
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), parseInt(offset));
    
    const result = await pool.query(query, params);
    
    const videos = result.rows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      tags: row.tags,
      videoUrl: row.video_url,
      thumbnailUrl: row.thumbnail_url,
      duration: row.duration,
      likesCount: row.likes_count,
      commentsEnabled: row.comments_enabled,
      authorId: row.author_id,
      authorName: row.author_name,
      authorAvatar: row.author_avatar,
      isLiked: row.is_liked,
      isSaved: row.is_saved,
      createdAt: row.created_at
    }));
    
    res.json(videos);
  } catch (error) {
    console.error('Get videos error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/feed', optionalAuth, async (req, res) => {
  try {
    const userId = req.userId || null;
    const blockedUserIds = await getBlockedUserIds(userId);
    
    const blockedFilter = blockedUserIds.length > 0 
      ? 'AND v.author_id != ALL($2)' 
      : '';
    const queryParams = blockedUserIds.length > 0 
      ? [userId, blockedUserIds] 
      : [userId];
    
    const [recommended, recent, popular] = await Promise.all([
      pool.query(`
        SELECT v.*, u.display_name as author_name, u.avatar_url as author_avatar,
               EXISTS(SELECT 1 FROM video_likes WHERE video_id = v.id AND user_id = $1) as is_liked,
               EXISTS(SELECT 1 FROM video_saves WHERE video_id = v.id AND user_id = $1) as is_saved
        FROM videos v
        JOIN users u ON v.author_id = u.id
        WHERE v.is_flagged = false ${blockedFilter}
        ORDER BY v.likes_count DESC, v.created_at DESC
        LIMIT 10
      `, queryParams),
      pool.query(`
        SELECT v.*, u.display_name as author_name, u.avatar_url as author_avatar,
               EXISTS(SELECT 1 FROM video_likes WHERE video_id = v.id AND user_id = $1) as is_liked,
               EXISTS(SELECT 1 FROM video_saves WHERE video_id = v.id AND user_id = $1) as is_saved
        FROM videos v
        JOIN users u ON v.author_id = u.id
        WHERE v.is_flagged = false ${blockedFilter}
        ORDER BY v.created_at DESC
        LIMIT 10
      `, queryParams),
      pool.query(`
        SELECT v.*, u.display_name as author_name, u.avatar_url as author_avatar,
               EXISTS(SELECT 1 FROM video_likes WHERE video_id = v.id AND user_id = $1) as is_liked,
               EXISTS(SELECT 1 FROM video_saves WHERE video_id = v.id AND user_id = $1) as is_saved
        FROM videos v
        JOIN users u ON v.author_id = u.id
        WHERE v.is_flagged = false AND v.created_at > NOW() - INTERVAL '30 days' ${blockedFilter}
        ORDER BY v.likes_count DESC
        LIMIT 10
      `, queryParams)
    ]);
    
    const formatVideos = (rows) => rows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      tags: row.tags,
      videoUrl: row.video_url,
      thumbnailUrl: row.thumbnail_url,
      duration: row.duration,
      likesCount: row.likes_count,
      commentsEnabled: row.comments_enabled,
      authorId: row.author_id,
      authorName: row.author_name,
      authorAvatar: row.author_avatar,
      isLiked: row.is_liked,
      isSaved: row.is_saved,
      createdAt: row.created_at
    }));
    
    res.json({
      recommended: formatVideos(recommended.rows),
      new: formatVideos(recent.rows),
      popular: formatVideos(popular.rows)
    });
  } catch (error) {
    console.error('Get feed error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT v.*, u.display_name as author_name, u.avatar_url as author_avatar,
             u.blocked_user_ids as author_blocked_ids,
             EXISTS(SELECT 1 FROM video_likes WHERE video_id = v.id AND user_id = $2) as is_liked,
             EXISTS(SELECT 1 FROM video_saves WHERE video_id = v.id AND user_id = $2) as is_saved
      FROM videos v
      JOIN users u ON v.author_id = u.id
      WHERE v.id = $1
    `, [req.params.id, req.userId || null]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    const row = result.rows[0];
    
    if (req.userId) {
      const authorBlockedIds = row.author_blocked_ids || [];
      if (authorBlockedIds.includes(req.userId)) {
        return res.status(403).json({ error: 'Content not available', isBlockedByUser: true });
      }
      
      const blockedUserIds = await getBlockedUserIds(req.userId);
      if (blockedUserIds.includes(row.author_id)) {
        return res.status(403).json({ error: 'Content not available', isBlocked: true });
      }
    }
    
    res.json({
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      tags: row.tags,
      videoUrl: row.video_url,
      thumbnailUrl: row.thumbnail_url,
      duration: row.duration,
      likesCount: row.likes_count,
      commentsEnabled: row.comments_enabled,
      authorId: row.author_id,
      authorName: row.author_name,
      authorAvatar: row.author_avatar,
      isLiked: row.is_liked,
      isSaved: row.is_saved,
      createdAt: row.created_at
    });
  } catch (error) {
    console.error('Get video error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const { title, description, category, tags, videoUrl, thumbnailUrl, duration, commentsEnabled = true } = req.body;
    
    if (!title || !category || !duration) {
      return res.status(400).json({ error: 'Title, category, and duration are required' });
    }
    
    if (duration > 60) {
      return res.status(400).json({ error: 'Video duration cannot exceed 60 seconds' });
    }
    
    if (title.length > 60) {
      return res.status(400).json({ error: 'Title cannot exceed 60 characters' });
    }
    
    if (description && description.length > 300) {
      return res.status(400).json({ error: 'Description cannot exceed 300 characters' });
    }
    
    const result = await pool.query(`
      INSERT INTO videos (author_id, title, description, category, tags, video_url, thumbnail_url, duration, comments_enabled)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [req.userId, title, description, category, tags || [], videoUrl, thumbnailUrl, duration, commentsEnabled]);
    
    const video = result.rows[0];
    
    const userResult = await pool.query(
      'SELECT display_name, avatar_url FROM users WHERE id = $1',
      [req.userId]
    );
    
    const xpResult = await awardXpDirect(req.userId, XP_REWARDS.video_upload, 'video_upload');
    
    res.status(201).json({
      id: video.id,
      title: video.title,
      description: video.description,
      category: video.category,
      tags: video.tags,
      videoUrl: video.video_url,
      thumbnailUrl: video.thumbnail_url,
      duration: video.duration,
      likesCount: 0,
      commentsEnabled: video.comments_enabled,
      authorId: video.author_id,
      authorName: userResult.rows[0].display_name,
      authorAvatar: userResult.rows[0].avatar_url,
      isLiked: false,
      isSaved: false,
      createdAt: video.created_at,
      xpAwarded: xpResult.success ? xpResult.xpAwarded : 0,
      totalXp: xpResult.success ? xpResult.xp : undefined,
      level: xpResult.success ? xpResult.level : undefined,
      leveledUp: xpResult.success ? xpResult.leveledUp : false
    });
  } catch (error) {
    console.error('Create video error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM videos WHERE id = $1 AND author_id = $2 RETURNING id',
      [req.params.id, req.userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found or not authorized' });
    }
    
    res.json({ message: 'Video deleted' });
  } catch (error) {
    console.error('Delete video error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/like', authMiddleware, async (req, res) => {
  try {
    const videoId = req.params.id;
    
    const existing = await pool.query(
      'SELECT id FROM video_likes WHERE user_id = $1 AND video_id = $2',
      [req.userId, videoId]
    );
    
    if (existing.rows.length > 0) {
      await pool.query('DELETE FROM video_likes WHERE user_id = $1 AND video_id = $2', [req.userId, videoId]);
      await pool.query('UPDATE videos SET likes_count = likes_count - 1 WHERE id = $1', [videoId]);
      
      const result = await pool.query('SELECT likes_count FROM videos WHERE id = $1', [videoId]);
      res.json({ liked: false, likesCount: result.rows[0].likes_count });
    } else {
      await pool.query('INSERT INTO video_likes (user_id, video_id) VALUES ($1, $2)', [req.userId, videoId]);
      await pool.query('UPDATE videos SET likes_count = likes_count + 1 WHERE id = $1', [videoId]);
      
      const result = await pool.query('SELECT likes_count FROM videos WHERE id = $1', [videoId]);
      
      const video = await pool.query('SELECT author_id, title FROM videos WHERE id = $1', [videoId]);
      if (video.rows[0].author_id !== req.userId) {
        const user = await pool.query('SELECT display_name FROM users WHERE id = $1', [req.userId]);
        await pool.query(`
          INSERT INTO notifications (user_id, type, title, message, related_user_id, related_video_id)
          VALUES ($1, 'like', $2, $3, $4, $5)
        `, [video.rows[0].author_id, 'New Like', `${user.rows[0].display_name} liked your video "${video.rows[0].title}"`, req.userId, videoId]);
      }
      
      res.json({ liked: true, likesCount: result.rows[0].likes_count });
    }
  } catch (error) {
    console.error('Like video error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/save', authMiddleware, async (req, res) => {
  try {
    const videoId = req.params.id;
    const { folderId } = req.body;
    
    const existing = await pool.query(
      'SELECT id FROM video_saves WHERE user_id = $1 AND video_id = $2',
      [req.userId, videoId]
    );
    
    if (existing.rows.length > 0) {
      await pool.query('DELETE FROM video_saves WHERE user_id = $1 AND video_id = $2', [req.userId, videoId]);
      res.json({ saved: false });
    } else {
      await pool.query(
        'INSERT INTO video_saves (user_id, video_id, folder_id) VALUES ($1, $2, $3)',
        [req.userId, videoId, folderId || null]
      );
      res.json({ saved: true });
    }
  } catch (error) {
    console.error('Save video error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id/comments', optionalAuth, async (req, res) => {
  try {
    const blockedUserIds = await getBlockedUserIds(req.userId);
    
    const blockedFilter = blockedUserIds.length > 0 
      ? 'AND c.user_id != ALL($2)' 
      : '';
    const queryParams = blockedUserIds.length > 0 
      ? [req.params.id, blockedUserIds] 
      : [req.params.id];
    
    const result = await pool.query(`
      SELECT c.*, u.display_name as author_name, u.avatar_url as author_avatar
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.video_id = $1 ${blockedFilter}
      ORDER BY c.created_at DESC
    `, queryParams);
    
    const comments = result.rows.map(row => ({
      id: row.id,
      content: row.content,
      authorId: row.user_id,
      authorName: row.author_name,
      authorAvatar: row.author_avatar,
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
    const { content } = req.body;
    
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Comment content is required' });
    }
    
    const video = await pool.query('SELECT comments_enabled, author_id, title FROM videos WHERE id = $1', [req.params.id]);
    if (video.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    if (!video.rows[0].comments_enabled) {
      return res.status(403).json({ error: 'Comments are disabled for this video' });
    }
    
    const blockedUserIds = await getBlockedUserIds(req.userId);
    if (blockedUserIds.includes(video.rows[0].author_id)) {
      return res.status(403).json({ error: 'Cannot comment on this video' });
    }
    
    const result = await pool.query(`
      INSERT INTO comments (video_id, user_id, content)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [req.params.id, req.userId, content.trim()]);
    
    const user = await pool.query('SELECT display_name, avatar_url FROM users WHERE id = $1', [req.userId]);
    
    if (video.rows[0].author_id !== req.userId) {
      await pool.query(`
        INSERT INTO notifications (user_id, type, title, message, related_user_id, related_video_id)
        VALUES ($1, 'comment', $2, $3, $4, $5)
      `, [video.rows[0].author_id, 'New Comment', `${user.rows[0].display_name} commented on your video "${video.rows[0].title}"`, req.userId, req.params.id]);
    }
    
    const comment = result.rows[0];
    res.status(201).json({
      id: comment.id,
      content: comment.content,
      authorId: req.userId,
      authorName: user.rows[0].display_name,
      authorAvatar: user.rows[0].avatar_url,
      createdAt: comment.created_at
    });
  } catch (error) {
    console.error('Create comment error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/report', authMiddleware, async (req, res) => {
  try {
    const { reason, description } = req.body;
    
    if (!reason) {
      return res.status(400).json({ error: 'Reason is required' });
    }
    
    const existing = await pool.query(
      'SELECT id FROM video_reports WHERE video_id = $1 AND reporter_id = $2',
      [req.params.id, req.userId]
    );
    
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'You have already reported this video' });
    }
    
    await pool.query(`
      INSERT INTO video_reports (video_id, reporter_id, reason, description)
      VALUES ($1, $2, $3, $4)
    `, [req.params.id, req.userId, reason, description]);
    
    res.json({ message: 'Report submitted' });
  } catch (error) {
    console.error('Report video error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Award XP for watching a video
// In-memory cache for video watch XP cooldowns (user_id:video_id -> timestamp)
const videoWatchCooldowns = new Map();
const VIDEO_WATCH_XP_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

router.post('/:id/watch', authMiddleware, async (req, res) => {
  try {
    const videoId = req.params.id;
    const userId = req.userId;
    
    // Verify the video exists
    const videoResult = await pool.query(
      'SELECT id FROM videos WHERE id = $1',
      [videoId]
    );
    
    if (videoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    // Check cooldown for this user+video combination
    const cooldownKey = `${userId}:${videoId}`;
    const lastWatchTime = videoWatchCooldowns.get(cooldownKey);
    const now = Date.now();
    
    if (lastWatchTime && (now - lastWatchTime) < VIDEO_WATCH_XP_COOLDOWN_MS) {
      // Cooldown active - no XP awarded but still count as successful watch
      console.log(`[Video Watch] XP cooldown active for user ${userId} on video ${videoId}`);
      return res.json({ success: true, xpAwarded: 0 });
    }
    
    // Award XP and update cooldown
    const xpResult = await awardXp(userId, 'video_watch');
    
    if (xpResult.success) {
      videoWatchCooldowns.set(cooldownKey, now);
      res.json({ 
        success: true, 
        xpAwarded: xpResult.xpAwarded,
        totalXp: xpResult.xp,
        level: xpResult.level
      });
    } else {
      // XP award failed but video watch was successful
      console.log('[Video Watch] XP award failed:', xpResult.error);
      res.json({ success: true, xpAwarded: 0 });
    }
  } catch (error) {
    console.error('Video watch error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
