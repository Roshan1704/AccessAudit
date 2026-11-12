# Production images for AccessAudit. Targets: api, worker, web.
# Not yet built or run in this repository's verification (see docs/PRODUCTION_READINESS.md).

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm ci
RUN npx tsc -b
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build -w @accessaudit/web

FROM node:22-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
RUN npm prune --omit=dev && chown -R node:node /app
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]

FROM node:22-bookworm-slim AS worker
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY --from=build /app /app
RUN npm prune --omit=dev \
 && npx playwright-core install --with-deps chromium \
 && chmod -R a+rX /ms-playwright \
 && chown -R node:node /app
USER node
# Chromium's sandbox needs user namespaces. If the host forbids them, set BROWSER_NO_SANDBOX=1,
# which makes the container the only isolation layer: run it read-only, with no extra capabilities
# and egress limited to the proxy. See docs/DEPLOYMENT.md.
CMD ["node", "apps/worker/dist/main.js"]

FROM nginx:1.27-alpine AS web
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
# Single-page app: unknown paths fall back to index.html.
RUN printf 'server {\n  listen 8080;\n  root /usr/share/nginx/html;\n  location / { try_files $uri /index.html; }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 8080
