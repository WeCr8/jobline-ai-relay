FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json .
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

EXPOSE 4242
HEALTHCHECK --interval=30s --timeout=5s \
  CMD wget -qO- http://localhost:4242/api/v1/health || exit 1

USER node
CMD ["node", "dist/server.js"]
