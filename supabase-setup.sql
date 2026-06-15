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

-- 2. Abilita RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard ENABLE ROW LEVEL SECURITY;

-- 3. Permessi per utenti anonimi (app)
CREATE POLICY "anon_insert_users" ON users FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_select_users" ON users FOR SELECT TO anon USING (true);

CREATE POLICY "anon_insert_configs" ON configs FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_select_configs" ON configs FOR SELECT TO anon USING (true);
CREATE POLICY "anon_update_configs" ON configs FOR UPDATE TO anon USING (true);

CREATE POLICY "anon_insert_leaderboard" ON leaderboard FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_select_leaderboard" ON leaderboard FOR SELECT TO anon USING (true);
CREATE POLICY "anon_update_leaderboard" ON leaderboard FOR UPDATE TO anon USING (true);

-- Chat messages
CREATE TABLE IF NOT EXISTS messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_insert_messages" ON messages FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_select_messages" ON messages FOR SELECT TO anon USING (true);

-- Follows
CREATE TABLE IF NOT EXISTS follows (
  follower TEXT NOT NULL,
  following TEXT NOT NULL,
  PRIMARY KEY (follower, following)
);

ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_insert_follows" ON follows FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_select_follows" ON follows FOR SELECT TO anon USING (true);
CREATE POLICY "anon_delete_follows" ON follows FOR DELETE TO anon USING (true);
