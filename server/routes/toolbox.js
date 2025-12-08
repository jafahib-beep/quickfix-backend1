const express = require('express');
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/saved', authMiddleware, async (req, res) => {
  try {
    const { folderId } = req.query;
    
    let query = `
      SELECT v.*, u.display_name as author_name, u.avatar_url as author_avatar,
             vs.folder_id, tf.name as folder_name,
             true as is_saved,
             EXISTS(SELECT 1 FROM video_likes WHERE video_id = v.id AND user_id = $1) as is_liked
      FROM video_saves vs
      JOIN videos v ON vs.video_id = v.id
      JOIN users u ON v.author_id = u.id
      LEFT JOIN toolbox_folders tf ON vs.folder_id = tf.id
      WHERE vs.user_id = $1
    `;
    
    const params = [req.userId];
    
    if (folderId) {
      if (folderId === 'uncategorized') {
        query += ' AND vs.folder_id IS NULL';
      } else {
        query += ' AND vs.folder_id = $2';
        params.push(folderId);
      }
    }
    
    query += ' ORDER BY vs.created_at DESC';
    
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
      isSaved: true,
      folderId: row.folder_id,
      folderName: row.folder_name,
      createdAt: row.created_at
    }));
    
    res.json(videos);
  } catch (error) {
    console.error('Get saved videos error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/folders', authMiddleware, async (req, res) => {
  try {
    const foldersResult = await pool.query(`
      SELECT tf.*, COUNT(vs.id) as video_count
      FROM toolbox_folders tf
      LEFT JOIN video_saves vs ON tf.id = vs.folder_id
      WHERE tf.user_id = $1
      GROUP BY tf.id
      ORDER BY tf.created_at DESC
    `, [req.userId]);
    
    const uncategorizedResult = await pool.query(
      'SELECT COUNT(*) FROM video_saves WHERE user_id = $1 AND folder_id IS NULL',
      [req.userId]
    );
    
    const folders = foldersResult.rows.map(f => ({
      id: f.id,
      name: f.name,
      videoCount: parseInt(f.video_count),
      createdAt: f.created_at
    }));
    
    res.json({
      folders,
      uncategorizedCount: parseInt(uncategorizedResult.rows[0].count)
    });
  } catch (error) {
    console.error('Get folders error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/folders', authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Folder name is required' });
    }
    
    if (name.length > 100) {
      return res.status(400).json({ error: 'Folder name cannot exceed 100 characters' });
    }
    
    const existing = await pool.query(
      'SELECT id FROM toolbox_folders WHERE user_id = $1 AND LOWER(name) = LOWER($2)',
      [req.userId, name.trim()]
    );
    
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'A folder with this name already exists' });
    }
    
    const result = await pool.query(`
      INSERT INTO toolbox_folders (user_id, name)
      VALUES ($1, $2)
      RETURNING *
    `, [req.userId, name.trim()]);
    
    const folder = result.rows[0];
    res.status(201).json({
      id: folder.id,
      name: folder.name,
      videoCount: 0,
      createdAt: folder.created_at
    });
  } catch (error) {
    console.error('Create folder error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/folders/:id', authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Folder name is required' });
    }
    
    const result = await pool.query(`
      UPDATE toolbox_folders 
      SET name = $1, updated_at = NOW()
      WHERE id = $2 AND user_id = $3
      RETURNING *
    `, [name.trim(), req.params.id, req.userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    
    res.json({
      id: result.rows[0].id,
      name: result.rows[0].name,
      createdAt: result.rows[0].created_at
    });
  } catch (error) {
    console.error('Update folder error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/folders/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query(
      'UPDATE video_saves SET folder_id = NULL WHERE folder_id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    
    const result = await pool.query(
      'DELETE FROM toolbox_folders WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    
    res.json({ message: 'Folder deleted' });
  } catch (error) {
    console.error('Delete folder error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/saved/:videoId/folder', authMiddleware, async (req, res) => {
  try {
    const { folderId } = req.body;
    
    if (folderId) {
      const folder = await pool.query(
        'SELECT id FROM toolbox_folders WHERE id = $1 AND user_id = $2',
        [folderId, req.userId]
      );
      if (folder.rows.length === 0) {
        return res.status(404).json({ error: 'Folder not found' });
      }
    }
    
    const result = await pool.query(`
      UPDATE video_saves 
      SET folder_id = $1
      WHERE video_id = $2 AND user_id = $3
      RETURNING *
    `, [folderId || null, req.params.videoId, req.userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Saved video not found' });
    }
    
    res.json({ message: 'Video moved to folder' });
  } catch (error) {
    console.error('Move video error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
