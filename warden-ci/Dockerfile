# ---- build stage: compile TypeScript ----
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN ./node_modules/.bin/tsc

# ---- runtime stage: prod deps + compiled output only ----
FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/lib ./lib
EXPOSE 3000
CMD ["node", "lib/server.js"]
