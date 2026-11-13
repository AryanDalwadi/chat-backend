BEGIN;

ALTER TABLE chats
  ADD COLUMN chat_type varchar(10) NOT NULL DEFAULT 'direct',
  ADD COLUMN group_name varchar(100),
  ADD COLUMN created_by uuid REFERENCES users(id);

ALTER TABLE chats
  ALTER COLUMN user1_id DROP NOT NULL,
  ALTER COLUMN user2_id DROP NOT NULL;

ALTER TABLE chats
  ADD CONSTRAINT chats_chat_type_check CHECK (chat_type IN ('direct', 'group')),
  ADD CONSTRAINT chats_shape_check CHECK (
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
  );

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
