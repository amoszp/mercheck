# ---------- Frontend ----------
FROM node:24-alpine AS web
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY index.html vite.config.js tailwind.config.js postcss.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

# ---------- Server ----------
FROM node:24-alpine AS server
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

# ---------- Runtime ----------
FROM node:24-alpine
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --omit=dev
COPY --from=server /app/server/dist ./dist
COPY --from=web /app/dist /app/dist

ENV NODE_ENV=production
ENV PORT=4480
ENV DB_PATH=/app/server/data/mercheck.db
EXPOSE 4480
CMD ["node", "dist/index.js"]
