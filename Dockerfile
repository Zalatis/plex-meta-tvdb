FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

# Install ALL deps including devDependencies for the build step
RUN npm ci

COPY . .

# Build TypeScript to JS
RUN npm run build

# Remove dev deps after build
RUN npm prune --omit=dev

EXPOSE 3000

CMD ["node", "dist/server.js"]
