FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
# Owned by `node` so the named volume mounted here inherits writable permissions on first start.
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 5001
CMD ["node", "--enable-source-maps", "dist/server.js"]
