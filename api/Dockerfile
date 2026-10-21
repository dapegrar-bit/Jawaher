FROM node:22-alpine AS build
WORKDIR /app/api
COPY api/package.json ./
RUN npm install --no-audit --no-fund
COPY api/tsconfig.json ./
COPY api/src ./src
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/api
COPY api/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/api/dist ./dist
COPY api/scripts ./scripts
COPY db /app/db
EXPOSE 4000
CMD ["node", "dist/main.js"]
