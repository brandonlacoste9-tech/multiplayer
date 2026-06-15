FROM node:20-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies (including devDependencies for ts-node)
RUN npm install

# Copy the rest of the server code
COPY . .

# Expose the Colyseus port
EXPOSE 2567

# Start the Colyseus engine via ts-node
CMD ["npx", "ts-node", "index.ts"]
