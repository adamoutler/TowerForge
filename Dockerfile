# Stage 1: Build the TowerForge static client bundle & Python companion artifacts
FROM node:22-bookworm-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY docs/ ./docs/
COPY towerforge.client/package.json towerforge.client/package-lock.json ./towerforge.client/

WORKDIR /app/towerforge.client
RUN npm ci --ignore-scripts

COPY towerforge.client/ ./
COPY towerforge-link-py/ /app/towerforge-link-py/
RUN python3 /app/towerforge-link-py/build_pyz.py
RUN npm run build

# Stage 2: Serve static bundle via hardened nginx:1.27-alpine
FROM nginx:1.27-alpine AS runtime

RUN rm -rf /docker-entrypoint.d/* /usr/share/nginx/html/* \
    && sed -i 's|/var/run/nginx.pid|/tmp/nginx.pid|g; s|/run/nginx.pid|/tmp/nginx.pid|g; /^user /d' /etc/nginx/nginx.conf \
    && find / -xdev -perm /6000 -type f -exec chmod a-s {} + 2>/dev/null || true

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/towerforge.client/dist/ /usr/share/nginx/html/

RUN chown -R root:root /usr/share/nginx/html /etc/nginx/conf.d/default.conf \
    && chmod -R a=rX /usr/share/nginx/html \
    && chmod 0444 /etc/nginx/conf.d/default.conf \
    && chown -R nginx:nginx /var/cache/nginx /var/log/nginx

USER nginx:nginx

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
