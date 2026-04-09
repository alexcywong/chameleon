# Stage 1: Build frontend
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Install server dependencies (including devDeps for tsx)
FROM node:22-slim AS server-builder
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm ci
COPY server ./server

# Stage 3: Production image
FROM node:22-slim
WORKDIR /app
COPY --from=server-builder /app/server ./server
COPY --from=builder /app/dist ./dist
EXPOSE 3000
# Run server via tsx (TypeScript executor, installed in server devDeps)
CMD ["./server/node_modules/.bin/tsx", "./server/index.ts"]
