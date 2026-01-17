FROM texlive/texlive:latest

# Install Node.js and poppler-utils for PDF thumbnail generation
RUN apt-get update && apt-get install -y \
    curl \
    poppler-utils \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN useradd -m -s /bin/bash latexuser

WORKDIR /home/latexuser/app

# Copy package files and install dependencies
COPY --chown=latexuser:latexuser package.json ./
RUN npm install --production

# Copy server code
COPY --chown=latexuser:latexuser server.js ./

# Create work directory for compilations
RUN mkdir -p /home/latexuser/work && chown -R latexuser:latexuser /home/latexuser

# Switch to non-root user
USER latexuser

# Set work directory for temp files
ENV WORK_DIR=/home/latexuser/work

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

CMD ["node", "server.js"]
