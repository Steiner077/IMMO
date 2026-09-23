# Baut Verwaltungs-App (APP=web) oder Mieter-App (APP=tenant) als statische Dateien
FROM node:22-bookworm-slim AS build
ARG APP=web
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/tenant/package.json apps/tenant/
RUN npm ci --workspaces --include-workspace-root --ignore-scripts
COPY packages packages
COPY apps/${APP} apps/${APP}
RUN npm run build -w @immo/${APP}

FROM nginx:1.27-alpine
ARG APP=web
COPY deploy/nginx-spa.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/${APP}/dist /usr/share/nginx/html
EXPOSE 80
