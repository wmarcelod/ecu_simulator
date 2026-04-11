# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files from frontend
COPY app/frontend/package*.json ./

# Install dependencies using npm
RUN npm install

# Copy frontend source code
COPY app/frontend .

# Remove development-only plugins from vite.config.ts before build
RUN sed -i '/import.*viteSourceLocator/d; /import.*atoms.*from.*@metagptx/d; /viteSourceLocator({/,/}),/d; /atoms(),/d' vite.config.ts

# Build the application
RUN npm run build

# Serve stage
FROM nginx:alpine

# Copy built assets to nginx
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Expose port 80
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/index.html || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
