-- Full schema for a new database.
-- PostgreSQL 15 or newer.
-- Run this file once. Do not also run sql/group-chats.sql on the same database.

BEGIN;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  email varchar(150) NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id uuid REFERENCES users(id),
  user2_id uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  chat_type varchar(10) NOT NULL DEFAULT 'direct',
  group_name varchar(100),
  created_by uuid REFERENCES users(id),
  CONSTRAINT different_users CHECK (user1_id <> user2_id),
  CONSTRAINT unique_chat_pair UNIQUE (user1_id, user2_id),
  CONSTRAINT chats_chat_type_check CHECK (chat_type IN ('direct', 'group')),
  CONSTRAINT chats_shape_check CHECK (
    (
      chat_type = 'direct'
      AND user1_id IS NOT NULL
      AND user2_id IS NOT NULL
      AND group_name IS NULL
    )
    OR (
      chat_type = 'group'
      AND user1_id IS NULL
      AND user2_id IS NULL
      AND group_name IS NOT NULL
      AND btrim(group_name) <> ''
      AND created_by IS NOT NULL
    )
  )
);

CREATE INDEX idx_chats_user1 ON chats (user1_id);
CREATE INDEX idx_chats_user2 ON chats (user2_id);

CREATE TABLE chat_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  role varchar(20) NOT NULL,
  CONSTRAINT chat_members_role_check CHECK (role IN ('admin', 'member')),
  CONSTRAINT chat_members_chat_user_key UNIQUE (chat_id, user_id)
);

CREATE INDEX chat_members_user_id_idx ON chat_members (user_id);

COMMIT;
