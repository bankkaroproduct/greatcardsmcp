FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY dist/ ./dist/

ENV MCP_TRANSPORT=sse
ENV PORT=3100

EXPOSE 3100

CMD ["node", "dist/index.js"]
