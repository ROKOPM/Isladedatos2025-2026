FROM node:24-alpine AS frontend-build

WORKDIR /src

COPY frontend/frontend_cambiante/frontend/package*.json ./
RUN npm ci

COPY frontend/frontend_cambiante/frontend/ ./
RUN npm run build

FROM nginx:alpine

COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf
RUN rm -rf /usr/share/nginx/html/*
COPY --from=frontend-build /src/dist/ /usr/share/nginx/html/

EXPOSE 80
