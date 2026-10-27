# syntax=docker/dockerfile:1.7
# AgroHands: zero npm dependencies, so the image is just Node (Alpine) + source.
ARG NODE_VERSION=22-alpine

# ---- test: the build fails if the test suite fails ---------------------------------------------
FROM node:${NODE_VERSION} AS test
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
COPY public ./public
COPY test ./test
RUN node --disable-warning=ExperimentalWarning --test test/*.test.js

# ---- runtime ------------------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
ARG GIT_SHA=dev
ARG APP_VERSION=
LABEL org.opencontainers.image.title="AgroHands" \
      org.opencontainers.image.description="Verified farm workforce platform" \
      org.opencontainers.image.revision="${GIT_SHA}"

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DB_PATH=/data/agrohands.db \
    BACKUP_DIR=/backups \
    TRUST_PROXY=true \
    GIT_SHA=${GIT_SHA} \
    APP_VERSION=${APP_VERSION}

WORKDIR /app
# Only what the app needs at runtime — no tests, no docs. Owned by root, so the app cannot modify its own code.
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
COPY public ./public
# Pull in the test stage so BuildKit cannot skip it: no passing tests, no image.
COPY --from=test /app/package.json /tmp/.tests-passed

RUN mkdir -p /data /backups && chown node:node /data /backups
USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

STOPSIGNAL SIGTERM
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
