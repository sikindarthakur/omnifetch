# Base image with Node.js & Linux
FROM node:22-alpine

# Install Python3, FFmpeg, and dependencies for yt-dlp
RUN apk add --no-cache \
    python3 \
    py3-pip \
    ffmpeg \
    curl \
    bash

# Install yt-dlp binary directly
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    pip3 install --no-cache-dir --break-system-packages instaloader

# Set working directory
WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application source code
COPY . .

# Expose standard web port
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV YTDLP_PATH=/usr/local/bin/yt-dlp

# Start server
CMD ["node", "server/index.js"]
