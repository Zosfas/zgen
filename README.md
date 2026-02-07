# Steam Drive Vault

## Deployment Target
- `Railway (Node server)`: deploy `server/server.js` using `npm start`.
- Legacy Netlify files were moved to `legacy/` and are not used by Railway.

## Local Server Run
1. Install dependencies.
2. Fill `.env`.
3. Run:

```powershell
npm install
npm run dev
```

## Railway Run
1. Push repo to GitHub.
2. Create a Railway project from that repo.
3. Set Start Command to `npm start` (or rely on `package.json` script auto-detect).
4. Add all required environment variables from `.env`.
5. Set `DISCORD_CALLBACK_URL` to:
- `https://<your-railway-domain>/auth/discord/callback`

## Real Discord + Drive Setup
1. Discord:
- Set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_CALLBACK_URL`.
- Optional: set `DISCORD_ALLOWED_GUILD` to restrict users to one server.
- Optional: set `ADMIN_DISCORD_IDS` as comma-separated Discord user IDs for admin role assignment.
2. Google Drive:
- Create a service account and download the JSON key (or place JSON in env).
- Share the Drive folder with the service account email.
- Set `GOOGLE_FOLDER_ID` and either `GOOGLE_SERVICE_ACCOUNT_PATH` (local file) or `GOOGLE_SERVICE_ACCOUNT_JSON`/`GOOGLE_SERVICE_ACCOUNT_BASE64`.
3. Enable live mode:
- Set `DRIVE_MODE=drive`.

## MongoDB (User Data Only)
MongoDB should be used for user/session/profile data only, not game catalog or file mapping.

Required env vars:
- `MONGODB_URI`
- `MONGODB_DB`
- `MONGODB_USERS_COLLECTION`
- Optional: `DEFAULT_DAILY_USES` (default `10`)

Stored user profile fields:
- `userId`, `username`, `discriminator`, `avatar`
- `usesDate`, `usesLeftToday`
- `role`, `banned`, `lastLoginAt`

Admin role behavior:
- On login, users with IDs listed in `ADMIN_DISCORD_IDS` are assigned `role: "admin"`.

## Search and Download Behavior
- Local mode: matches game name/AppID from `data/games.json`.
- Drive mode: resolves game names through AppID mapping and maps AppID to Drive files named like `220200` or `220200.zip`.
- User data mode: on login, profile is upserted in MongoDB and `/api/me` returns `usesLeftToday`.
- Download mode: each successful `/api/download` call consumes 1 daily use when MongoDB user store is enabled.
