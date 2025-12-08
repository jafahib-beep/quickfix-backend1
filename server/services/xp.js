const { pool } = require('../db');

// XP amounts for different actions
const XP_REWARDS = {
  ai_chat_message: 5,
  liveassist_scan: 10,
  video_watch: 3,
  community_post: 20,
  community_comment: 10,
  post_solved: 50,
  video_upload: 30,
  daily_login: 10
};

// Level thresholds (cumulative XP required)
const LEVEL_THRESHOLDS = [
  { level: 1, minXp: 0, maxXp: 99 },
  { level: 2, minXp: 100, maxXp: 249 },
  { level: 3, minXp: 250, maxXp: 499 },
  { level: 4, minXp: 500, maxXp: 999 },
  { level: 5, minXp: 1000, maxXp: Infinity }
];

/**
 * Calculate level from XP
 * @param {number} xp - Current XP amount
 * @returns {number} - Level (1-5)
 */
function calculateLevelFromXp(xp) {
  if (typeof xp !== 'number' || xp < 0) {
    return 1;
  }
  
  for (const threshold of LEVEL_THRESHOLDS) {
    if (xp >= threshold.minXp && xp <= threshold.maxXp) {
      return threshold.level;
    }
  }
  
  return 5; // Max level
}

/**
 * Get XP required for next level
 * @param {number} currentLevel - Current level
 * @returns {number} - XP required for next level (or current max if at max level)
 */
function getNextLevelXp(currentLevel) {
  if (currentLevel >= 5) {
    return LEVEL_THRESHOLDS[4].minXp; // At max level, return max level threshold
  }
  
  const nextLevelIndex = LEVEL_THRESHOLDS.findIndex(t => t.level === currentLevel + 1);
  if (nextLevelIndex >= 0) {
    return LEVEL_THRESHOLDS[nextLevelIndex].minXp;
  }
  
  return 1000; // Fallback
}

/**
 * Get XP required for current level (for progress calculation)
 * @param {number} currentLevel - Current level
 * @returns {number} - XP required for current level
 */
function getCurrentLevelXp(currentLevel) {
  const levelIndex = LEVEL_THRESHOLDS.findIndex(t => t.level === currentLevel);
  if (levelIndex >= 0) {
    return LEVEL_THRESHOLDS[levelIndex].minXp;
  }
  return 0;
}

/**
 * Award XP to a user for completing an action
 * @param {string} userId - User ID
 * @param {string} actionType - Type of action (ai_chat_message, liveassist_scan, video_watch)
 * @returns {Promise<{success: boolean, xp?: number, level?: number, xpAwarded?: number, error?: string}>}
 */
async function awardXp(userId, actionType) {
  if (!userId) {
    console.log('[XP] No userId provided, skipping XP award');
    return { success: false, error: 'No userId provided' };
  }
  
  const xpAmount = XP_REWARDS[actionType];
  if (!xpAmount) {
    console.log(`[XP] Unknown action type: ${actionType}`);
    return { success: false, error: `Unknown action type: ${actionType}` };
  }
  
  try {
    // Get current user XP
    const userResult = await pool.query(
      'SELECT xp, level FROM users WHERE id = $1',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      console.log(`[XP] User not found: ${userId}`);
      return { success: false, error: 'User not found' };
    }
    
    const currentXp = userResult.rows[0].xp || 0;
    const newXp = currentXp + xpAmount;
    const newLevel = calculateLevelFromXp(newXp);
    
    // Update user XP and level
    await pool.query(
      'UPDATE users SET xp = $1, level = $2, updated_at = NOW() WHERE id = $3',
      [newXp, newLevel, userId]
    );
    
    console.log(`[XP] Awarded ${xpAmount} XP to user ${userId} for ${actionType}. New total: ${newXp}, Level: ${newLevel}`);
    
    return {
      success: true,
      xp: newXp,
      level: newLevel,
      xpAwarded: xpAmount
    };
  } catch (error) {
    console.error('[XP] Error awarding XP:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Award XP to a user with a direct amount (for flexible rewards)
 * @param {string} userId - User ID
 * @param {number} amount - XP amount to award
 * @param {string} actionType - Description of the action (for logging)
 * @returns {Promise<{success: boolean, xp?: number, level?: number, xpAwarded?: number, leveledUp?: boolean, error?: string}>}
 */
async function awardXpDirect(userId, amount, actionType = 'custom') {
  if (!userId) {
    console.log('[XP] No userId provided, skipping XP award');
    return { success: false, error: 'No userId provided' };
  }
  
  if (typeof amount !== 'number' || amount <= 0) {
    console.log(`[XP] Invalid XP amount: ${amount}`);
    return { success: false, error: 'Invalid XP amount' };
  }
  
  try {
    const userResult = await pool.query(
      'SELECT xp, level FROM users WHERE id = $1',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      console.log(`[XP] User not found: ${userId}`);
      return { success: false, error: 'User not found' };
    }
    
    const currentXp = userResult.rows[0].xp || 0;
    const currentLevel = userResult.rows[0].level || 1;
    const newXp = currentXp + amount;
    const newLevel = calculateLevelFromXp(newXp);
    const leveledUp = newLevel > currentLevel;
    
    await pool.query(
      'UPDATE users SET xp = $1, level = $2, updated_at = NOW() WHERE id = $3',
      [newXp, newLevel, userId]
    );
    
    console.log(`[XP] Awarded ${amount} XP to user ${userId} for ${actionType}. New total: ${newXp}, Level: ${newLevel}${leveledUp ? ' (LEVEL UP!)' : ''}`);
    
    return {
      success: true,
      xp: newXp,
      level: newLevel,
      xpAwarded: amount,
      leveledUp,
      nextLevelXp: getNextLevelXp(newLevel),
      currentLevelXp: getCurrentLevelXp(newLevel)
    };
  } catch (error) {
    console.error('[XP] Error awarding XP:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Check and award daily login XP (only once per day)
 * @param {string} userId - User ID
 * @returns {Promise<{success: boolean, awarded: boolean, xp?: number, level?: number, xpAwarded?: number, leveledUp?: boolean}>}
 */
async function awardDailyLoginXp(userId) {
  if (!userId) {
    return { success: false, awarded: false, error: 'No userId provided' };
  }
  
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const existingResult = await pool.query(
      'SELECT id FROM xp_daily_logins WHERE user_id = $1 AND login_date = $2',
      [userId, today]
    );
    
    if (existingResult.rows.length > 0) {
      console.log(`[XP] Daily login XP already awarded to user ${userId} for ${today}`);
      return { success: true, awarded: false };
    }
    
    await pool.query(
      'INSERT INTO xp_daily_logins (user_id, login_date) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, today]
    );
    
    const xpAmount = XP_REWARDS.daily_login;
    const result = await awardXpDirect(userId, xpAmount, 'daily_login');
    
    if (result.success) {
      console.log(`[XP] Daily login XP awarded to user ${userId}`);
      return { ...result, awarded: true };
    }
    
    return { success: true, awarded: false };
  } catch (error) {
    console.error('[XP] Error awarding daily login XP:', error);
    return { success: false, awarded: false, error: error.message };
  }
}

/**
 * Check if user has already earned XP for commenting on a specific post
 * @param {string} userId - User ID
 * @param {string} postId - Post ID
 * @returns {Promise<boolean>}
 */
async function hasCommentXpForPost(userId, postId) {
  try {
    const result = await pool.query(
      'SELECT id FROM xp_post_comments WHERE user_id = $1 AND post_id = $2',
      [userId, postId]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error('[XP] Error checking comment XP:', error);
    return false;
  }
}

/**
 * Award XP for commenting on a post (only once per post per user)
 * @param {string} userId - User ID
 * @param {string} postId - Post ID
 * @returns {Promise<{success: boolean, awarded: boolean, xp?: number, level?: number, xpAwarded?: number, leveledUp?: boolean}>}
 */
async function awardCommentXp(userId, postId) {
  if (!userId || !postId) {
    return { success: false, awarded: false, error: 'Missing userId or postId' };
  }
  
  try {
    const hasXp = await hasCommentXpForPost(userId, postId);
    if (hasXp) {
      console.log(`[XP] User ${userId} already earned comment XP for post ${postId}`);
      return { success: true, awarded: false };
    }
    
    await pool.query(
      'INSERT INTO xp_post_comments (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, postId]
    );
    
    const xpAmount = XP_REWARDS.community_comment;
    const result = await awardXpDirect(userId, xpAmount, 'community_comment');
    
    if (result.success) {
      return { ...result, awarded: true };
    }
    
    return { success: true, awarded: false };
  } catch (error) {
    console.error('[XP] Error awarding comment XP:', error);
    return { success: false, awarded: false, error: error.message };
  }
}

module.exports = {
  XP_REWARDS,
  LEVEL_THRESHOLDS,
  calculateLevelFromXp,
  getNextLevelXp,
  getCurrentLevelXp,
  awardXp,
  awardXpDirect,
  awardDailyLoginXp,
  hasCommentXpForPost,
  awardCommentXp
};
