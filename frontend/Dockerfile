FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 5173
# --host so the port is reachable from outside the container; the Vite config
# proxies /api to VITE_API_TARGET, which compose points at the backend service.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
