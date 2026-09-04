# ---- Backend build stage ----
FROM node:24-bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci
COPY backend/ ./backend/
RUN npm run build -w backend

# Remove build/test tooling before copying dependencies into the clean runtime.
FROM builder AS production-dependencies
RUN npm prune --omit=dev

# ---- Backend runtime stage ----
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=builder /app/backend/dist ./backend/dist
RUN mkdir -p /data && chown -R node:node /app /data
WORKDIR /app/backend
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
