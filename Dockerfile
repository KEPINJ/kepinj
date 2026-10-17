# ---- build frontend ----
FROM node:22-alpine AS web
WORKDIR /app
COPY shared ./shared
COPY web/package*.json ./web/
RUN cd web && npm ci
COPY web ./web
RUN cd web && npm run build

# ---- runtime ----
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev
COPY shared ./shared
COPY server ./server
COPY samples ./samples
COPY --from=web /app/web/dist ./web/dist
WORKDIR /app/server
EXPOSE 8080
USER node
CMD ["node", "src/index.js"]
