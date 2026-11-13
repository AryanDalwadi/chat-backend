# Chat backend

Node.js API for direct chats and group chats. PostgreSQL stores users, chats, and group membership. Firestore stores messages, read receipts, and last-seen pointers.

## Requirements

- Node.js 20 or newer
- PostgreSQL 15 or newer
- A Firebase project with Firestore and Email/Password authentication

## Setup

```bash
npm install
```

Create a database and load the schema:

```bash
psql -U postgres -c "CREATE DATABASE chat_backend;"
psql -U postgres -d chat_backend -f sql/schema.sql
```

`sql/schema.sql` is the full schema for a new database. `sql/group-chats.sql` is only the later migration for a database that already had the original direct-chat tables. Run one of them, not both.

Create a `.env` file in the project root:

```env
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your-database-password
DB_NAME=chat_backend
```

Download a Firebase service account key and save it as `firebase-service-account.json` in the project root. Both `.env` and that JSON file are gitignored.

Add the same people to PostgreSQL and to Firebase Authentication. Protected routes match the token email to `users.email`.

```sql
INSERT INTO users (name, email)
VALUES
  ('Aryan', 'aryan@example.com'),
  ('Rahul', 'rahul@example.com');
```

Start the server:

```bash
npm run dev
```

The API listens on `http://localhost:3000`. `GET /health` returns `{ "ok": true }`.

## Authentication

Send a Firebase ID token on protected routes:

```http
Authorization: Bearer <firebase-id-token>
```

The API uses the token email to find `users.id`. A direct chat can be created and a message can be sent without a token. Group changes, message reads, message edits, and last-seen updates require a token.

## Endpoints

### Create or get a direct chat

`POST /api/chat/create`

```json
{ "userAId": "uuid", "userBId": "uuid" }
```

Returns the same `chatId` when that pair already exists.

### Create a group

`POST /api/chat/group/create`

```json
{
  "groupName": "Weekend Cricket Team",
  "createdBy": "uuid",
  "memberIds": ["uuid", "uuid"]
}
```

`createdBy` must be the signed-in user. The creator is added when missing and stored as `admin`.

### Add group members

`POST /api/chat/group/:chatId/members/add`

```json
{ "memberIds": ["uuid", "uuid"] }
```

Only a group admin can add members. People who are already members are skipped. New rows use the role `member`.

### Remove a group member

`DELETE /api/chat/group/:chatId/members/:memberId`

Only a group admin can remove a member. The last remaining member cannot be removed. Removing the current `created_by` user promotes the earliest joined remaining member to `admin`. Messages are kept. The removed user can no longer access the group.

### List a user's chats

`GET /api/user/:userId/chats`

Returns direct chats and groups for that user, newest first.

### Send a message

`POST /api/chat/:chatId/message/send`

```json
{ "senderId": "uuid", "text": "Hello" }
```

The message is stored in Firestore at `chats/{chatId}/messages/{messageId}`.

### Get messages

`GET /api/chat/:chatId/messages?limit=50&cursor=<messageId>`

The caller must be a member. `limit` defaults to 50 and cannot be higher than 100. Results are chronological. `nextCursor` is present when more messages exist.

### Mark a message read

`POST /api/chat/:chatId/message/:messageId/read`

```json
{ "userId": "uuid" }
```

`userId` must be the signed-in user. An existing `readAt` is not overwritten.

### Update last seen

`POST /api/chat/:chatId/lastseen`

```json
{ "userId": "uuid", "messageId": "firestore-message-id" }
```

The pointer does not move backward.

### Edit a message

`PUT /api/chat/:chatId/message/:messageId`

```json
{ "text": "Updated message text" }
```

Only the original sender can edit. Deleted messages cannot be edited. `text` is required and limited to 4000 characters. `senderId` and `createdAt` stay unchanged. `editedAt` is set with the Firestore server timestamp.
