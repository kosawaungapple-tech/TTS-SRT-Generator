# Hosted render server (for regular users)

Admins keep using their own local PC worker. Regular users render on this server.

1. Get a VPS (Ubuntu, 4+ vCPU / 8 GB recommended) and a domain pointing at it.
2. Install Docker, then copy this folder and the worker file:
   `cp ../../public/worker/vbs-ffmpeg-worker.js .`
3. Create `.env`:
   ```
   DOMAIN=render.example.com
   RENDER_SECRET=<long random string, e.g. openssl rand -hex 32>
   ```
4. `docker compose up -d --build`
5. In Vercel project env vars set `RENDER_SERVER_URL=https://render.example.com` and the same `RENDER_SECRET`, then redeploy.
6. Optional: set `renderEnabled=false` on a user's `user_controls/{code}` doc to block one user.

Limits (env): MAX_JOBS parallel renders, MAX_QUEUE waiting, MAX_UPLOAD_MB per upload, DAILY_LIMIT renders per user per day, OUTPUT_TTL_MIN minutes before files are deleted.
