-- Esegui questo SQL nel Supabase SQL Editor
-- Vai a: https://supabase.com/dashboard/project/akodhogcuowpgndetaca/sql/new

-- 1. Crea le tabelle (se non esistono già)
CREATE TABLE IF NOT EXISTS users (
  username      TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS configs (
  username TEXT PRIMARY KEY REFERENCES users(username),
  config   JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS leaderboard (
  username      TEXT PRIMARY KEY REFERENCES users(username),
  completed_at  TIMESTAMPTZ
);

-- Chat messages (public = conversation_id IS NULL, DM = conversation_id is set)
CREATE TABLE IF NOT EXISTS messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  conversation_id TEXT DEFAULT NULL
);

-- Follows
CREATE TABLE IF NOT EXISTS follows (
  follower TEXT NOT NULL,
  following TEXT NOT NULL,
  PRIMARY KEY (follower, following)
);

-- Message likes
CREATE TABLE IF NOT EXISTS message_likes (
  message_id uuid REFERENCES messages(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (message_id, username)
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT NOT NULL,         -- who receives the notification
  type TEXT NOT NULL,             -- 'follow', 'follow_request', 'like', 'mention', 'stage_completed', 'dm'
  from_user TEXT NOT NULL,        -- who triggered it
  message TEXT DEFAULT '',        -- optional extra text / preview
  reference_id TEXT DEFAULT '',   -- optional: message_id, conversation_id, etc.
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Abilita RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- 3. Permessi per utenti anonimi (app)
CREATE POLICY "anon_insert_users" ON users FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_select_users" ON users FOR SELECT TO anon USING (true);
CREATE POLICY "anon_update_users" ON users FOR UPDATE TO anon USING (true);

CREATE POLICY "anon_insert_configs" ON configs FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_select_configs" ON configs FOR SELECT TO anon USING (true);
CREATE POLICY "anon_update_configs" ON configs FOR UPDATE TO anon USING (true);

CREATE POLICY "anon_insert_leaderboard" ON leaderboard FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_select_leaderboard" ON leaderboard FOR SELECT TO anon USING (true);
CREATE POLICY "anon_update_leaderboard" ON leaderboard FOR UPDATE TO anon USING (true);

CREATE POLICY "anon_insert_messages" ON messages FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_select_messages" ON messages FOR SELECT TO anon USING (true);

CREATE POLICY "anon_insert_follows" ON follows FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_select_follows" ON follows FOR SELECT TO anon USING (true);
CREATE POLICY "anon_delete_follows" ON follows FOR DELETE TO anon USING (true);

CREATE POLICY "anon_insert_message_likes" ON message_likes FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_select_message_likes" ON message_likes FOR SELECT TO anon USING (true);
CREATE POLICY "anon_delete_message_likes" ON message_likes FOR DELETE TO anon USING (true);

CREATE POLICY "anon_insert_notifications" ON notifications FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_select_notifications" ON notifications FOR SELECT TO anon USING (true);
CREATE POLICY "anon_update_notifications" ON notifications FOR UPDATE TO anon USING (true);
