FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --production

COPY server-online ./server-online
COPY src ./src

EXPOSE 3033

CMD ["node", "server-online/index.mjs"]
