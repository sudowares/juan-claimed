FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 5175

# Mirrors backend's seedIfEmpty.ts bootstrap pattern: refresh a generated artifact from its
# real source on every container start instead of relying on a hand-maintained copy. Source
# is docker-compose.yml's read-only ./docs:/docs-source mount (the repo's own docs/, not
# frontend's) — copied into public/docs so Vite serves it at /docs alongside the app, always
# matching whatever's currently in docs/. Mirrored for prod in Dockerfile.prod's build-time
# COPY instead (no running container there to do it on start).
CMD ["sh", "-c", "mkdir -p public/docs && cp -r /docs-source/. public/docs/ && npm run dev -- --host"]
