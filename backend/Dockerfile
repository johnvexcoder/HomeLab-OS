# ---- Backend build stage ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY backend/package.json backend/package-lock.json* ./
RUN npm install
COPY backend/ .
RUN npm run build

# ---- Backend runtime stage ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
RUN apk add --no-cache wget
EXPOSE 4000
CMD ["node", "dist/index.js"]
