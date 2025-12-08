const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.SESSION_SECRET || 'quickfix-jwt-secret-key';

const generateToken = (userId) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
};

const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
};

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('[AUTH] No auth header or invalid format');
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);
  
  if (!decoded) {
    console.log('[AUTH] Token verification failed. Token prefix:', token?.substring(0, 20) + '...');
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  
  console.log('[AUTH] Token verified for user:', decoded.userId);
  req.userId = decoded.userId;
  next();
};

const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    if (decoded) {
      req.userId = decoded.userId;
    }
  }
  
  next();
};

module.exports = { generateToken, verifyToken, authMiddleware, optionalAuth };
