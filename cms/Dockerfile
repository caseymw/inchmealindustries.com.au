# Multi-stage build following Strapi's official Docker guide
# (https://docs.strapi.io/cms/installation/docker), adapted for SQLite:
# python3 is added alongside build-base/gcc so better-sqlite3's native
# build (via node-gyp) succeeds on Alpine, the same way sharp/libvips needs
# vips-dev.

# Build stage
FROM node:22-alpine AS build
RUN apk update && apk add --no-cache build-base gcc autoconf automake zlib-dev libpng-dev bash vips-dev python3 git > /dev/null 2>&1
WORKDIR /opt/
COPY package.json package-lock.json* ./
RUN npm install -g node-gyp
RUN npm config set fetch-retry-maxtimeout 600000 -g && npm install
ENV PATH=/opt/node_modules/.bin:$PATH
WORKDIR /opt/app
COPY . .
ENV NODE_ENV=production
RUN npm run build

# Production stage
FROM node:22-alpine
RUN apk add --no-cache vips-dev
ENV NODE_ENV=production
WORKDIR /opt/
COPY --from=build /opt/package.json /opt/package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
ENV PATH=/opt/node_modules/.bin:$PATH
WORKDIR /opt/app
COPY --from=build /opt/app ./
RUN mkdir -p database && chown -R node:node /opt/app
USER node
EXPOSE 1337
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:1337/_health || exit 1
CMD ["npm", "run", "start"]
