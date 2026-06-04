FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /data
ENV PORT=5050
ENV DB_PATH=/data/odc.db
EXPOSE 5050
CMD ["node", "server.js"]
