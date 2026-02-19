# =============================================================================
# Praxrr Dockerfile
# =============================================================================
# Multi-stage build for minimal final image size
#
# Build:  docker build -t praxrr .
# Run:    docker run -v ./config:/config -p 6868:6868 praxrr

# -----------------------------------------------------------------------------
# Stage 1: Build
# -----------------------------------------------------------------------------
FROM denoland/deno:2.5.6 AS builder

WORKDIR /build

# Copy dependency files first (cache key)
COPY deno.json deno.lock* ./

# Copy everything else
COPY . .

# Install dependencies (needs full source to resolve npm: imports)
RUN deno install --node-modules-dir

# Build the application
# 1. Vite builds SvelteKit to dist/build/
# 2. Deno compiles to standalone binary

# Build-time variables for version card
# TARGETARCH is automatically set by Docker buildx (amd64 or arm64)
ARG TARGETARCH
ARG VITE_CHANNEL=stable
ENV VITE_PLATFORM=docker-${TARGETARCH}
ENV VITE_CHANNEL=${VITE_CHANNEL}

ENV APP_BASE_PATH=/build/dist/build
RUN cd packages/praxrr-app && deno run -A npm:vite build
RUN deno compile \
    --no-check \
    --allow-net \
    --allow-read \
    --allow-write \
    --allow-env \
    --allow-ffi \
    --allow-run \
    --allow-sys \
    --target x86_64-unknown-linux-gnu \
    --output dist/build/praxrr \
    dist/build/mod.ts

# -----------------------------------------------------------------------------
# Stage 2: Runtime
# -----------------------------------------------------------------------------
FROM debian:12-slim

# Labels for container metadata
LABEL org.opencontainers.image.title="Praxrr"
LABEL org.opencontainers.image.description="Configuration management for Radarr and Sonarr"
LABEL org.opencontainers.image.source="https://github.com/yandy-r/praxrr"
LABEL org.opencontainers.image.licenses="AGPL-3.0"

# Install runtime dependencies
# - git: PCD repository operations (clone, pull, push)
# - tar: Backup creation and restoration
# - curl: Health checks
# - gosu: Drop privileges to non-root user
# - ca-certificates: HTTPS connections
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    tar \
    curl \
    gosu \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create application directory
WORKDIR /app

# Copy built application from builder stage
COPY --from=builder /build/dist/build/praxrr /app/praxrr
COPY --from=builder /build/dist/build/server.js /app/server.js
COPY --from=builder /build/dist/build/static /app/static

# Copy entrypoint script
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create config directory
RUN mkdir -p /config

# Environment variables
ENV PORT=6868
ENV HOST=0.0.0.0
ENV APP_BASE_PATH=/config
ENV TZ=UTC

# Expose port
EXPOSE 6868

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:${PORT}/api/v1/health || exit 1

# Volume for persistent data
VOLUME /config

# Entrypoint handles PUID/PGID/UMASK then runs the app
ENTRYPOINT ["/entrypoint.sh"]
