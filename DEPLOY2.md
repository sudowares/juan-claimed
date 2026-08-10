cd backend
$env:DATABASE_URL="postgresql://<user>:<password>@ep-xxxx-pooler.<region>.aws.neon.tech/neondb?sslmode=require"
npx prisma migrate deploy
npx prisma db seed

Notes:
- migrate deploy, not migrate dev — applies your existing migration files as-is, no prompts.
- This uses your local node_modules/prisma CLI but points at the remote Neon DB via the env var — you don't need Docker running for this part.
- If db seed errors about a missing script, check backend/package.json's "prisma": { "seed": ... } entry — but this should already work since it's the same seed script you run locally.
- Takes a minute or two. Once done, Neon has your full schema + seed data (agents, benefits, demo personas, etc.).

3. Deploy the backend to Vercel

1. Go to vercel.com, sign in (GitHub login lets it see your repos directly).
2. Add New → Project → import this repo.
3. Before deploying, expand Root Directory → set it to backend.
4. Framework Preset: leave as Other (Vercel will still pick up backend/api/index.ts automatically because of backend/vercel.json).
5. Don't deploy yet — first add env vars. Expand Environment Variables and add each of these (Project Settings → Environment Variables works too if you'd rather do it after the first deploy):

| Var                                                                     | Value                                                               |
|-------------------------------------------------------------------------|---------------------------------------------------------------------|
| DATABASE_URL                                                            | the same Neon pooled connection string from step 1                  |
| JWT_SECRET                                                              | copy from your local .env, or generate a new random string for prod |
| GOOGLE_CLIENT_ID                                                        | copy from local .env                                                |
| UNLOCK_GOOGLE_SYNCED_FIELDS                                             | false                                                               |
| EGOV_BASE_URL, EGOV_PARTNER_CODE, EGOV_PARTNER_SECRET                   | copy from local .env                                                |
| EGOV_EVERIFY_CLIENT_ID, EGOV_EVERIFY_CLIENT_SECRET, EGOV_EVERIFY_PUBKEY | copy from local .env                                                |
| EGOV_EMESSAGE_ACCESS_TOKEN, EGOV_MESSAGE_BASE_URL                       | copy from local .env                                                |
| EGOV_AI_ACCESS_CODE, EGOV_AI_CORE_BASE_URL                              | copy from local .env                                                |
| EGOV_PAY_API_KEY, EGOV_PAY_SETTLEMENT_TEMPLATE_UUID                     | copy from local .env                                                |
| EGOV_REPORT_ACCESS_TOKEN                                                | copy from local .env                                                |
| EGOV_FACE_LIVENESS_API_KEY                                              | copy from local .env                                                |
| EGOV_COMPASS_API_KEY                                                    | copy from local .env                                                |

5. Skip PRESET_USERNAME/PRESET_PASSWORD and BLOB_READ_WRITE_TOKEN — don't set those yet (blob token comes next).
6. Click Deploy. It'll build and give you a URL like https://your-backend-xyz.vercel.app. Save that URL — the frontend needs it.
7. Link Blob storage: in this backend project, go to the Storage tab → Create Database → Blob → create/connect a store to this project. Vercel auto-injects BLOB_READ_WRITE_TOKEN into the project's env vars for you — you don't type this one in by hand.
8. After linking Blob, trigger a redeploy (Deployments tab → ⋯ on the latest → Redeploy) so the function picks up the new env var.

4. Deploy the frontend to Vercel

1. Add New → Project → import the same repo again (a second, separate Vercel project).
2. Set Root Directory to frontend.
3. Framework Preset: Vercel should auto-detect Vite (build npm run build, output dist).
4. Add env vars:

| Var                              | Value                                                                   |
|----------------------------------|-------------------------------------------------------------------------|
| VITE_API_BASE_URL                | the backend URL from step 3.6, e.g. https://your-backend-xyz.vercel.app |
| VITE_GOOGLE_CLIENT_ID            | same value as backend's GOOGLE_CLIENT_ID                                |
| VITE_UNLOCK_GOOGLE_SYNCED_FIELDS | false                                                                   |

4. Skip VITE_PRESET_USERNAME/VITE_PRESET_PASSWORD for production.
5. Click Deploy. You'll get https://your-frontend-xyz.vercel.app.

5. Post-deploy follow-ups

1. Google OAuth: go to Google Cloud Console → APIs & Services → Credentials → your OAuth 2.0 Client ID → add https://your-frontend-xyz.vercel.app to Authorized JavaScript origins. Without this, Google sign-in will reject the popup with an origin error.
2. Open the frontend URL and click through: Google sign-in, staff login (type credentials manually since the preset is off), browse benefits, submit a form, upload an attachment — confirms DB, auth, and Blob are all wired correctly end to end.
3. Optional hardening later: tighten CORS in backend/src/app.ts (currently wide open) to just the frontend's real domain once you're confident everything works.

That's the whole path. Steps 1–2 (Neon) and running the two Vercel deploys (3, 4) are the only irreversible/external actions — everything else is just env var entry. Let me know if you hit an error at any step and paste it, happy to debug from here.