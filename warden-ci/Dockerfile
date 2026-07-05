FROM node:20-slim
WORKDIR /app
# Copy both files explicitly — glob patterns behave inconsistently with remote builders
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY lib/ ./lib/
EXPOSE 3000
CMD ["node", "lib/server.js"]
