# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS ui-builder
WORKDIR /app
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS ui
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
WORKDIR /app
COPY --from=ui-builder /app /app
EXPOSE 3000
CMD ["npm", "run", "start"]

FROM node:22-bookworm-slim AS api
ENV NODE_ENV=production
ENV PORT=8787
ENV PRINT_TEMP_ROOT=/tmp/print-assistant-ephemeral
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    cups-client \
    fonts-noto-cjk \
    libreoffice-writer \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
EXPOSE 8787
CMD ["node", "server/index.mjs"]
