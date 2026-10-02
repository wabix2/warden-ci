# ---- build stage: compile TypeScript ----
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
RUN ./node_modules/.bin/tsc

# ---- runtime stage: prod deps + compiled output only ----
FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY TERMS.md PRIVACY.md REFUND.md ./
COPY assets/ ./assets/
COPY index.html report.html dashboard.html landing.html robots.txt sitemap.xml site.webmanifest ./
EXPOSE 3000
CMD ["node", "dist/server.js"]
