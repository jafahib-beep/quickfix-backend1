const express = require('express');
const { pool } = require('../db');
const { authMiddleware, optionalAuth } = require('../middleware/auth');
const { isBlocked, getBlockedUserIds } = require('./block');

const router = express.Router();

router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, display_name, bio, avatar_url, expertise_categories, 
             followers_count, following_count, created_at, blocked_user_ids
      FROM users WHERE id = $1
    `, [req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = result.rows[0];
    
    const targetBlockedIds = user.blocked_user_ids || [];
    if (req.userId && targetBlockedIds.includes(req.userId)) {
      return res.status(403).json({ error: 'User not available', isBlockedByUser: true });
    }
    
    let isFollowing = false;
    let userIsBlocked = false;
    if (req.userId) {
      const [followResult, blockedCheck] = await Promise.all([
        pool.query(
          'SELECT id FROM follows WHERE follower_id = $1 AND following_id = $2',
          [req.userId, req.params.id]
        ),
        isBlocked(req.userId, req.params.id)
      ]);
      isFollowing = followResult.rows.length > 0;
      userIsBlocked = blockedCheck;
    }
    
    res.json({
      id: user.id,
      displayName: user.display_name,
      bio: user.bio,
      avatarUrl: user.avatar_url,
      expertiseCategories: user.expertise_categories,
      followersCount: user.followers_count,
      followingCount: user.following_count,
      isFollowing,
      isBlocked: userIsBlocked,
      createdAt: user.created_at
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id/videos', optionalAuth, async (req, res) => {
  try {
    if (req.userId) {
      const targetUser = await pool.query('SELECT blocked_user_ids FROM users WHERE id = $1', [req.params.id]);
      if (targetUser.rows.length > 0) {
        const targetBlockedIds = targetUser.rows[0].blocked_user_ids || [];
        if (targetBlockedIds.includes(req.userId)) {
          return res.status(403).json({ error: 'User not available', isBlockedByUser: true });
        }
      }
      
      const userBlockedTarget = await isBlocked(req.userId, req.params.id);
      if (userBlockedTarget) {
        return res.json([]);
      }
    }
    
    const result = await pool.query(`
      SELECT v.*, u.display_name as author_name, u.avatar_url as author_avatar,
             EXISTS(SELECT 1 FROM video_likes WHERE video_id = v.id AND user_id = $2) as is_liked,
             EXISTS(SELECT 1 FROM video_saves WHERE video_id = v.id AND user_id = $2) as is_saved
      FROM videos v
      JOIN users u ON v.author_id = u.id
      WHERE v.author_id = $1 AND v.is_flagged = false
      ORDER BY v.created_at DESC
    `, [req.params.id, req.userId || null]);
    
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
    console.error('Get user videos error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/follow', authMiddleware, async (req, res) => {
  try {
    if (req.params.id === req.userId) {
      return res.status(400).json({ error: 'Cannot follow yourself' });
    }
    
    const [userBlockedTarget, targetBlockedUser] = await Promise.all([
      isBlocked(req.userId, req.params.id),
      isBlocked(req.params.id, req.userId)
    ]);
    
    if (userBlockedTarget || targetBlockedUser) {
      return res.status(403).json({ error: 'Cannot follow this user' });
    }
    
    const existing = await pool.query(
      'SELECT id FROM follows WHERE follower_id = $1 AND following_id = $2',
      [req.userId, req.params.id]
    );
    
    if (existing.rows.length > 0) {
      await pool.query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [req.userId, req.params.id]);
      await pool.query('UPDATE users SET followers_count = followers_count - 1 WHERE id = $1', [req.params.id]);
      await pool.query('UPDATE users SET following_count = following_count - 1 WHERE id = $1', [req.userId]);
      
      res.json({ following: false });
    } else {
      await pool.query('INSERT INTO follows (follower_id, following_id) VALUES ($1, $2)', [req.userId, req.params.id]);
      await pool.query('UPDATE users SET followers_count = followers_count + 1 WHERE id = $1', [req.params.id]);
      await pool.query('UPDATE users SET following_count = following_count + 1 WHERE id = $1', [req.userId]);
      
      const user = await pool.query('SELECT display_name FROM users WHERE id = $1', [req.userId]);
      await pool.query(`
        INSERT INTO notifications (user_id, type, title, message, related_user_id)
        VALUES ($1, 'follow', $2, $3, $4)
      `, [req.params.id, 'New Follower', `${user.rows[0].display_name} started following you`, req.userId]);
      
      res.json({ following: true });
    }
  } catch (error) {
    console.error('Follow user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id/followers', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.display_name, u.avatar_url, u.bio
      FROM follows f
      JOIN users u ON f.follower_id = u.id
      WHERE f.following_id = $1
      ORDER BY f.created_at DESC
    `, [req.params.id]);
    
    res.json(result.rows.map(u => ({
      id: u.id,
      displayName: u.display_name,
      avatarUrl: u.avatar_url,
      bio: u.bio
    })));
  } catch (error) {
    console.error('Get followers error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id/following', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.display_name, u.avatar_url, u.bio
      FROM follows f
      JOIN users u ON f.following_id = u.id
      WHERE f.follower_id = $1
      ORDER BY f.created_at DESC
    `, [req.params.id]);
    
    res.json(result.rows.map(u => ({
      id: u.id,
      displayName: u.display_name,
      avatarUrl: u.avatar_url,
      bio: u.bio
    })));
  } catch (error) {
    console.error('Get following error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
