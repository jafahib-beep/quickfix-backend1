const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const initializeDatabase = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        display_name VARCHAR(100) NOT NULL,
        bio VARCHAR(150),
        avatar_url TEXT,
        expertise_categories TEXT[] DEFAULT '{}',
        followers_count INTEGER DEFAULT 0,
        following_count INTEGER DEFAULT 0,
        xp INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS videos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        author_id UUID REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(60) NOT NULL,
        description VARCHAR(300),
        category VARCHAR(50) NOT NULL,
        tags TEXT[] DEFAULT '{}',
        video_url TEXT,
        thumbnail_url TEXT,
        duration INTEGER NOT NULL CHECK (duration <= 60),
        likes_count INTEGER DEFAULT 0,
        comments_enabled BOOLEAN DEFAULT true,
        is_flagged BOOLEAN DEFAULT false,
        search_text TSVECTOR,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS video_likes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(user_id, video_id)
      );

      CREATE TABLE IF NOT EXISTS video_saves (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
        folder_id UUID,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(user_id, video_id)
      );

      CREATE TABLE IF NOT EXISTS toolbox_folders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS comments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS follows (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        follower_id UUID REFERENCES users(id) ON DELETE CASCADE,
        following_id UUID REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(follower_id, following_id)
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT,
        related_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        related_video_id UUID REFERENCES videos(id) ON DELETE SET NULL,
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS video_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
        reporter_id UUID REFERENCES users(id) ON DELETE CASCADE,
        reason VARCHAR(100) NOT NULL,
        description TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reporter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        content_id UUID,
        content_type VARCHAR(20) NOT NULL CHECK (content_type IN ('video', 'profile', 'comment')),
        reason VARCHAR(100) NOT NULL,
        message TEXT,
        status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_user_id);
      CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_user_id);
      CREATE INDEX IF NOT EXISTS idx_reports_content ON reports(content_id);
      CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
      CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(content_type);

      CREATE TABLE IF NOT EXISTS community_posts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        author_id UUID REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(150) NOT NULL,
        description TEXT NOT NULL,
        category VARCHAR(50) NOT NULL,
        image_url TEXT,
        status VARCHAR(20) DEFAULT 'open',
        comments_count INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS community_comments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id UUID REFERENCES community_posts(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        linked_video_id UUID REFERENCES videos(id) ON DELETE SET NULL,
        is_solution BOOLEAN DEFAULT false,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS xp_daily_logins (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        login_date DATE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(user_id, login_date)
      );

      CREATE TABLE IF NOT EXISTS xp_post_comments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        post_id UUID REFERENCES community_posts(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(user_id, post_id)
      );

      CREATE INDEX IF NOT EXISTS idx_xp_daily_logins_user ON xp_daily_logins(user_id);
      CREATE INDEX IF NOT EXISTS idx_xp_daily_logins_date ON xp_daily_logins(login_date);
      CREATE INDEX IF NOT EXISTS idx_xp_post_comments_user ON xp_post_comments(user_id);
      CREATE INDEX IF NOT EXISTS idx_xp_post_comments_post ON xp_post_comments(post_id);

      CREATE INDEX IF NOT EXISTS idx_community_posts_author ON community_posts(author_id);
      CREATE INDEX IF NOT EXISTS idx_community_posts_category ON community_posts(category);
      CREATE INDEX IF NOT EXISTS idx_community_posts_status ON community_posts(status);
      CREATE INDEX IF NOT EXISTS idx_community_posts_created ON community_posts(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_community_comments_post ON community_comments(post_id);

      CREATE INDEX IF NOT EXISTS idx_videos_author ON videos(author_id);
      CREATE INDEX IF NOT EXISTS idx_videos_category ON videos(category);
      CREATE INDEX IF NOT EXISTS idx_videos_created ON videos(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_video_likes_video ON video_likes(video_id);
      CREATE INDEX IF NOT EXISTS idx_video_saves_user ON video_saves(user_id);
      CREATE INDEX IF NOT EXISTS idx_comments_video ON comments(video_id);
      CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
      CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_videos_search ON videos USING gin(search_text);
    `);
    
    // Migration: Add xp and level columns if they don't exist (for existing databases)
    await client.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'xp') THEN
          ALTER TABLE users ADD COLUMN xp INTEGER DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'level') THEN
          ALTER TABLE users ADD COLUMN level INTEGER DEFAULT 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'blocked_user_ids') THEN
          ALTER TABLE users ADD COLUMN blocked_user_ids UUID[] DEFAULT '{}';
        END IF;
      END $$;
    `);
    
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { pool, initializeDatabase };
