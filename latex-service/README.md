# PaperShelf LaTeX Service

A self-hosted LaTeX compilation service for PaperShelf.

## Deployment Options

### Option 1: Fly.io (Recommended)

**Pros:** Easy setup, good free tier, fast deployments
**Cons:** Large image (~4GB) may take a while to deploy initially

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Launch (from latex-service directory)
cd latex-service
fly launch --no-deploy

# Set up volume for faster builds (optional)
fly volumes create latex_cache --size 1

# Deploy
fly deploy

# Get your URL
fly status
```

Your service will be at: `https://your-app-name.fly.dev`

### Option 2: Railway

**Pros:** Git-push deployments, good free tier
**Cons:** May have memory limits on free tier

1. Go to [railway.app](https://railway.app)
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your repo and the `latex-service` directory
4. Railway auto-detects the Dockerfile

Your service will be at: `https://your-app.up.railway.app`

### Option 3: Render

**Pros:** Free tier, auto-scaling
**Cons:** Cold starts on free tier

1. Go to [render.com](https://render.com)
2. New → Web Service → Connect your repo
3. Set root directory to `latex-service`
4. Render auto-detects Docker

### Option 4: Local / Self-hosted

```bash
cd latex-service
docker compose up -d
```

Service runs at: `http://localhost:3001`

For a VPS (DigitalOcean, Linode, Hetzner):
```bash
# On your server
git clone <your-repo>
cd papershelf/latex-service
docker compose up -d
```

## Configuration

After deploying, add the environment variable to Convex:

```bash
npx convex env set LATEX_SERVICE_URL https://your-latex-service.fly.dev
```

## API Usage

### POST /compile

Compile LaTeX from JSON resources:

```bash
curl -X POST https://your-service/compile \
  -H "Content-Type: application/json" \
  -d '{
    "resources": [
      {"path": "main.tex", "content": "\\documentclass{article}\\begin{document}Hello\\end{document}"}
    ],
    "target": "main.tex",
    "compiler": "pdflatex"
  }' \
  --output output.pdf
```

### POST /compile/upload

Compile from file uploads:

```bash
curl -X POST https://your-service/compile/upload \
  -F "files=@main.tex" \
  -F "files=@references.bib" \
  -F "target=main.tex" \
  -F "compiler=pdflatex" \
  --output output.pdf
```

### GET /health

Health check endpoint.

## Supported Compilers

- `pdflatex` (default)
- `xelatex`
- `lualatex`
