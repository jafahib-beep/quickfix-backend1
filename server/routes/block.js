const express = require('express');
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.post('/block', authMiddleware, async (req, res) => {
  try {
    const { targetUserId } = req.body;
    
    if (!targetUserId) {
      return res.status(400).json({ error: 'targetUserId is required' });
    }
    
    if (targetUserId === req.userId) {
      return res.status(400).json({ error: 'Cannot block yourself' });
    }
    
    const targetExists = await pool.query(
      'SELECT id FROM users WHERE id = $1',
      [targetUserId]
    );
    
    if (targetExists.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const currentUser = await pool.query(
      'SELECT blocked_user_ids FROM users WHERE id = $1',
      [req.userId]
    );
    
    const blockedUserIds = currentUser.rows[0]?.blocked_user_ids || [];
    
    if (blockedUserIds.includes(targetUserId)) {
      return res.json({ status: 'ok', message: 'User already blocked' });
    }
    
    await pool.query(
      'UPDATE users SET blocked_user_ids = array_append(blocked_user_ids, $1), updated_at = NOW() WHERE id = $2',
      [targetUserId, req.userId]
    );
    
    await pool.query(
      'DELETE FROM follows WHERE (follower_id = $1 AND following_id = $2) OR (follower_id = $2 AND following_id = $1)',
      [req.userId, targetUserId]
    );
    
    console.log(`[Block] User ${req.userId} blocked user ${targetUserId}`);
    
    res.json({ status: 'ok' });
  } catch (error) {
    console.error('Block user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/unblock', authMiddleware, async (req, res) => {
  try {
    const { targetUserId } = req.body;
    
    if (!targetUserId) {
      return res.status(400).json({ error: 'targetUserId is required' });
    }
    
    await pool.query(
      'UPDATE users SET blocked_user_ids = array_remove(blocked_user_ids, $1), updated_at = NOW() WHERE id = $2',
      [targetUserId, req.userId]
    );
    
    console.log(`[Block] User ${req.userId} unblocked user ${targetUserId}`);
    
    res.json({ status: 'ok' });
  } catch (error) {
    console.error('Unblock user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/blocked', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT blocked_user_ids FROM users WHERE id = $1',
      [req.userId]
    );
    
    const blockedUserIds = result.rows[0]?.blocked_user_ids || [];
    
    res.json({ blockedUserIds });
  } catch (error) {
    console.error('Get blocked users error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

async function isBlocked(userId, targetUserId) {
  if (!userId || !targetUserId) return false;
  
  try {
    const result = await pool.query(
      'SELECT $2 = ANY(blocked_user_ids) as is_blocked FROM users WHERE id = $1',
      [userId, targetUserId]
    );
    return result.rows[0]?.is_blocked || false;
  } catch (error) {
    console.error('isBlocked check error:', error);
    return false;
  }
}

async function getBlockedUserIds(userId) {
  if (!userId) return [];
  
  try {
    const [blockedByUser, blockedByOthers] = await Promise.all([
      pool.query('SELECT blocked_user_ids FROM users WHERE id = $1', [userId]),
      pool.query('SELECT id FROM users WHERE $1 = ANY(blocked_user_ids)', [userId])
    ]);
    
    const blockedByUserIds = blockedByUser.rows[0]?.blocked_user_ids || [];
    const blockedByOthersIds = blockedByOthers.rows.map(row => row.id);
    
    const allBlocked = [...new Set([...blockedByUserIds, ...blockedByOthersIds])];
    return allBlocked;
  } catch (error) {
    console.error('getBlockedUserIds error:', error);
    return [];
  }
}

module.exports = { router, isBlocked, getBlockedUserIds };
