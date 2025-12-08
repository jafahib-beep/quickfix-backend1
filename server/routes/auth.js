const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { generateToken, authMiddleware } = require('../middleware/auth');
const { getNextLevelXp, getCurrentLevelXp, awardDailyLoginXp, XP_REWARDS } = require('../services/xp');

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { email, password, displayName } = req.body;
    
    if (!email || !password || !displayName) {
      return res.status(400).json({ error: 'Email, password, and display name are required' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
    
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING id, email, display_name, bio, avatar_url, expertise_categories, followers_count, following_count, xp, level, created_at`,
      [email.toLowerCase(), passwordHash, displayName]
    );
    
    const user = result.rows[0];
    const token = generateToken(user.id);
    const xp = user.xp || 0;
    const level = user.level || 1;
    
    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        bio: user.bio,
        avatarUrl: user.avatar_url,
        expertiseCategories: user.expertise_categories,
        followersCount: user.followers_count,
        followingCount: user.following_count,
        xp,
        level,
        nextLevelXp: getNextLevelXp(level),
        currentLevelXp: getCurrentLevelXp(level),
        createdAt: user.created_at
      },
      token
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    const token = generateToken(user.id);
    
    const dailyLoginResult = await awardDailyLoginXp(user.id);
    
    let xp = user.xp || 0;
    let level = user.level || 1;
    let dailyLoginXpAwarded = 0;
    let leveledUp = false;
    
    if (dailyLoginResult.success && dailyLoginResult.awarded) {
      xp = dailyLoginResult.xp;
      level = dailyLoginResult.level;
      dailyLoginXpAwarded = dailyLoginResult.xpAwarded;
      leveledUp = dailyLoginResult.leveledUp || false;
    }
    
    res.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        bio: user.bio,
        avatarUrl: user.avatar_url,
        expertiseCategories: user.expertise_categories,
        followersCount: user.followers_count,
        followingCount: user.following_count,
        xp,
        level,
        nextLevelXp: getNextLevelXp(level),
        currentLevelXp: getCurrentLevelXp(level),
        createdAt: user.created_at
      },
      token,
      xpAwarded: dailyLoginXpAwarded,
      leveledUp
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, display_name, bio, avatar_url, expertise_categories, 
              followers_count, following_count, xp, level, created_at
       FROM users WHERE id = $1`,
      [req.userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = result.rows[0];
    const xp = user.xp || 0;
    const level = user.level || 1;
    
    res.json({
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      bio: user.bio,
      avatarUrl: user.avatar_url,
      expertiseCategories: user.expertise_categories,
      followersCount: user.followers_count,
      followingCount: user.following_count,
      xp,
      level,
      nextLevelXp: getNextLevelXp(level),
      currentLevelXp: getCurrentLevelXp(level),
      createdAt: user.created_at
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/me', authMiddleware, async (req, res) => {
  try {
    const { displayName, bio, avatarUrl, expertiseCategories } = req.body;
    
    const result = await pool.query(
      `UPDATE users 
       SET display_name = COALESCE($1, display_name),
           bio = COALESCE($2, bio),
           avatar_url = COALESCE($3, avatar_url),
           expertise_categories = COALESCE($4, expertise_categories),
           updated_at = NOW()
       WHERE id = $5
       RETURNING id, email, display_name, bio, avatar_url, expertise_categories, followers_count, following_count, xp, level`,
      [displayName, bio, avatarUrl, expertiseCategories, req.userId]
    );
    
    const user = result.rows[0];
    const xp = user.xp || 0;
    const level = user.level || 1;
    
    res.json({
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      bio: user.bio,
      avatarUrl: user.avatar_url,
      expertiseCategories: user.expertise_categories,
      followersCount: user.followers_count,
      followingCount: user.following_count,
      xp,
      level,
      nextLevelXp: getNextLevelXp(level),
      currentLevelXp: getCurrentLevelXp(level)
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    
    const userResult = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.userId]
    );
    
    const validPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash);
    if (!validPassword) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    
    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [newPasswordHash, req.userId]
    );
    
    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
