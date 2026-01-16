FROM texlive/texlive:latest

# Install Node.js
RUN apt-get update && apt-get install -y \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install dependencies
COPY package.json ./
RUN npm install --production

# Copy server code
COPY server.js ./

# Create temp directory
RUN mkdir -p /tmp

EXPOSE 3001

CMD ["node", "server.js"]
