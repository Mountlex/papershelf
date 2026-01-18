# Carrel

A web service to preview PDFs from your LaTeX projects on GitHub. Features a clean, Pinterest-style gallery for academic papers with support for multiple PDF sources.

## Features

- **GitHub OAuth** - Sign in with GitHub to access private repositories
- Connect GitHub repositories (public and private)
- Track specific files/folders within repositories
- Multiple PDF source options:
  - Committed PDFs in the repo
  - GitHub Actions artifacts
  - GitHub Releases
  - Server-side LaTeX compilation
- PDF caching with git commit tracking (only re-fetches when commits change)
- Share papers publicly with shareable links
- Clean, responsive gallery UI

## Tech Stack

- **Frontend**: React + Vite + TanStack Router + Tailwind CSS
- **Backend**: Convex (database, file storage, serverless functions)
- **Auth**: Convex Auth with GitHub OAuth
- **PDF Rendering**: Browser native / pdf.js
- **LaTeX Compilation**: LaTeX.Online API

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (or Node.js 18+)
- A [Convex](https://convex.dev) account (free tier available)
- A GitHub OAuth App (for authentication)

### 1. Create a GitHub OAuth App

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click "New OAuth App"
3. Fill in:
   - **Application name**: Carrel (or whatever you like)
   - **Homepage URL**: `http://localhost:5173`
   - **Authorization callback URL**: `https://<your-convex-deployment>.convex.site/api/auth/callback/github`
4. Click "Register application"
5. Copy the **Client ID**
6. Click "Generate a new client secret" and copy the **Client Secret**

### 2. Install Dependencies

```bash
bun install
```

### 3. Set up Convex

```bash
npx convex dev
```

This will:
- Prompt you to log in to Convex
- Create a new Convex project (or link to an existing one)
- Generate TypeScript types
- Start the Convex dev server
- Populate `.env.local` with your `VITE_CONVEX_URL`

### 4. Configure GitHub OAuth in Convex

In the Convex dashboard ([dashboard.convex.dev](https://dashboard.convex.dev)):

1. Go to your project → Settings → Environment Variables
2. Add these variables:
   - `AUTH_GITHUB_ID` = your GitHub OAuth Client ID
   - `AUTH_GITHUB_SECRET` = your GitHub OAuth Client Secret

Also update your GitHub OAuth App's callback URL to match your Convex deployment:
- `https://<your-deployment-name>.convex.site/api/auth/callback/github`

You can find your deployment name in the Convex dashboard URL or in `.env.local`.

### 5. Start the Frontend

In a separate terminal:

```bash
bun run dev
```

Or run both together:

```bash
bun run dev:all
```

### 6. Open Your Browser

Go to [http://localhost:5173](http://localhost:5173) and sign in with GitHub!

## Project Structure

```
carrel/
├── convex/                 # Convex backend
│   ├── schema.ts           # Database schema
│   ├── auth.config.ts      # GitHub OAuth configuration
│   ├── auth.ts             # Auth exports
│   ├── http.ts             # HTTP routes for OAuth callback
│   ├── repositories.ts     # Repository CRUD operations
│   ├── papers.ts           # Paper queries and mutations
│   ├── users.ts            # User management
│   └── sync.ts             # GitHub sync actions
│
├── src/
│   ├── routes/             # TanStack Router pages
│   │   ├── __root.tsx      # Root layout with auth
│   │   ├── index.tsx       # Gallery (home)
│   │   ├── repositories.tsx# Repo management
│   │   ├── papers.$id.tsx  # Paper detail
│   │   └── share.$slug.tsx # Public share page
│   │
│   ├── hooks/
│   │   └── useUser.ts      # Auth hook
│   │
│   └── main.tsx            # App entry point
│
├── package.json
└── vite.config.ts
```

## Usage

1. **Sign in**: Click "Sign in with GitHub" to authenticate
2. **Add a Repository**: Go to "Repositories" and add a GitHub URL (public or private)
3. **Track Files**: Select which .tex or .pdf files to track
4. **Sync**: Click "Sync" to fetch the latest commit and update PDFs
5. **View Papers**: Browse your papers in the gallery
6. **Share**: Toggle a paper to "Public" to get a shareable link

## Development

### Scripts

- `bun run dev` - Start Vite dev server
- `bun run dev:convex` - Start Convex dev server
- `bun run dev:all` - Start both servers concurrently
- `bun run build` - Build for production
- `bun run lint` - Run ESLint

### Convex Dashboard

Access your Convex dashboard at [dashboard.convex.dev](https://dashboard.convex.dev) to:
- View and edit data
- Monitor function calls
- Check logs and errors
- Manage environment variables

## Deployment

### Frontend (Vercel)

1. Connect your GitHub repo to Vercel
2. Set the `VITE_CONVEX_URL` environment variable
3. Deploy!

### Convex

1. Set production environment variables in Convex dashboard
2. Run `npx convex deploy`

### Update GitHub OAuth App

For production, update your GitHub OAuth App:
- **Homepage URL**: Your production URL
- **Authorization callback URL**: `https://<your-prod-deployment>.convex.site/api/auth/callback/github`

## License

MIT
