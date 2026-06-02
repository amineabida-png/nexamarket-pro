FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

FROM node:20-alpine AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nexamarket && \
    adduser --system --uid 1001 nexamarket

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=nexamarket:nexamarket src/ ./src/
COPY --chown=nexamarket:nexamarket public/ ./public/
COPY --chown=nexamarket:nexamarket package.json ./

RUN mkdir -p /app/data && chown nexamarket:nexamarket /app/data

USER nexamarket
ENV PORT=3000
ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]
