# VPS deploy (DigitalOcean) — Docker prod stack behind host nginx

Raw-Docker deployment on a VPS (not Vercel — see DEPLOY.md for the Vercel path). The prod
stack is defined by `docker-compose.prod.yml` and sits behind the host's own nginx
(reverse proxy + TLS via certbot).

## Architecture

```
Internet ──HTTPS──► host nginx (:443, sites-available)
                      ├── /       ─► 127.0.0.1:8083  frontend container (nginx serving dist/)
                      └── /api/   ─► 127.0.0.1:4000   backend container (node dist)
                                        └────────────► postgres container (127.0.0.1:5432)
```

- Everything the containers publish is bound to `127.0.0.1` — only host nginx is public.
- Host nginx config lives in the repo at `deploy/nginx-host.conf`; copy it to
  `/etc/nginx/sites-available/juan-claimed.nexflare.tech`.

## Why images are pre-built off-box

The VPS has ~1 GB RAM and cannot run `tsc` (Node OOMs compiling the app + generated Prisma
client). So the images are **built on a stronger machine and shipped in**, and the VPS only
`docker load`s them and runs `up -d` (never `--build`).

### Build + ship (on a machine with RAM, e.g. laptop; must be linux/amd64)

```bash
docker build --platform linux/amd64 --provenance=false \
  -f backend/Dockerfile.prod -t juan-claimed-backend:latest ./backend

docker build --platform linux/amd64 --provenance=false \
  --build-arg VITE_API_BASE_URL="" \
  --build-arg VITE_GOOGLE_CLIENT_ID="<GOOGLE_CLIENT_ID from .env>" \
  --build-arg VITE_UNLOCK_GOOGLE_SYNCED_FIELDS="true" \
  -f frontend/Dockerfile.prod -t juan-claimed-frontend:latest ./frontend

docker save juan-claimed-backend:latest  | gzip > backend-prod.tar.gz
docker save juan-claimed-frontend:latest | gzip > frontend-prod.tar.gz
scp backend-prod.tar.gz frontend-prod.tar.gz jhoriz@<VPS>:~/
```

The image tags (`juan-claimed-backend` / `juan-claimed-frontend`) match the names compose
would build, so `up -d` (no `--build`) reuses them and the VPS never compiles.

- `VITE_API_BASE_URL=""` → same-origin. The frontend's own paths already carry `/api`
  (e.g. `apiFetch("/api/scopes")`), so the base must be just the origin; host nginx routes
  `/api/*` to the backend. No CORS, no hardcoded IP.
- `VITE_GOOGLE_CLIENT_ID` is baked into the JS at build time — rebuild to change it.
- `VITE_UNLOCK_GOOGLE_SYNCED_FIELDS="true"` unlocks eGovField fields for Google-only sessions
  (see `lib/egov-field-lock.ts`). Also **build-time** — the backend `.env`'s
  `UNLOCK_GOOGLE_SYNCED_FIELDS` only affects the backend container; the frontend needs this
  build-arg or the fields stay locked no matter what the runtime `.env` says.

### Load + run (on the VPS)

```bash
docker load < ~/backend-prod.tar.gz
docker load < ~/frontend-prod.tar.gz
docker images | grep juan-claimed          # both :latest present

cd ~/juan-claimed
docker compose -f docker-compose.prod.yml up -d       # NO --build
```

`migrate deploy` runs automatically from the backend image's CMD.

## Required env on the VPS (`~/juan-claimed/.env`)

```
POSTGRES_PASSWORD=<long random string>     # NOT "postgres"
GOOGLE_CLIENT_ID=<google client id>        # public, safe in repo-adjacent .env
JWT_SECRET=<secret>
# ...all EGOV_* and BLOB_READ_WRITE_TOKEN as in the root .env
```

`DATABASE_URL` is derived from `POSTGRES_PASSWORD` inside the compose file — don't set it
separately. `VITE_API_BASE_URL` is baked at build time, not read here.

## Host nginx

```bash
sudo cp deploy/nginx-host.conf /etc/nginx/sites-available/juan-claimed.nexflare.tech
sudo ln -sf /etc/nginx/sites-available/juan-claimed.nexflare.tech /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## Seed + verify

```bash
docker compose -f docker-compose.prod.yml exec backend npx prisma db seed
docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -d app \
  -c 'SELECT username, role FROM dim_user;'
```

Then log in at https://juan-claimed.nexflare.tech (`superadmin` / `password123` — change it).

---

## SECURITY — mandatory

The DB was ransomware-wiped once because the dev stack published Postgres on `0.0.0.0:5432`
with `postgres`/`postgres`. Rules:

1. **Never run the dev `docker-compose.yml` on a public host.** It's for laptop use. Its
   Postgres/Studio are now bound to `127.0.0.1`, but the DB password is still the weak dev
   default — localhost-only is what keeps it safe.
2. On the VPS use **only** `docker-compose.prod.yml` (localhost-bound, password from `.env`).
3. Firewall the DB ports as defence in depth:
   ```bash
   sudo ufw deny 5432
   sudo ufw deny 5555
   ```
4. Use a strong `POSTGRES_PASSWORD`. Changing it later requires recreating the volume
   (Postgres only sets the password on first init) — see "wipe & rebuild" below.

## Wipe & rebuild the database (destroys all DB data)

Use when the volume is compromised, or to apply a new `POSTGRES_PASSWORD`.

```bash
# set the new POSTGRES_PASSWORD in .env FIRST
docker compose -f docker-compose.prod.yml down -v      # -v deletes the postgres_data volume
docker compose -f docker-compose.prod.yml up -d        # fresh DB, new password, creates 'app'
docker compose -f docker-compose.prod.yml exec backend npx prisma db seed
```

## Everyday commands

```bash
# status / logs
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f backend

# redeploy new code: rebuild+ship images (above), then on the VPS:
docker compose -f docker-compose.prod.yml up -d

# stop (keeps data)
docker compose -f docker-compose.prod.yml down

# disk cleanup (safe; does NOT touch running containers or volumes)
docker image prune -f
docker builder prune -f
```

Never run `docker system prune -a --volumes` or `docker volume prune` on this box — they
delete the Postgres volume (and other apps' data).
