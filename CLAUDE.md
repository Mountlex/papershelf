# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Carrel is a web service for previewing PDFs from LaTeX projects. It supports multiple Git providers (GitHub, GitLab, Overleaf, self-hosted GitLab) and offers a Pinterest-style gallery for academic papers.

## Commands

```bash
# Development
bun run dev           # Start Vite frontend only (port 5173)
bun run dev:convex    # Start Convex backend only
bun run dev:all       # Start both frontend and backend concurrently

# Production
bun run build         # TypeScript check + Vite production build

# Code quality
bun run lint          # Run ESLint

# Convex
npx convex dev        # Start Convex dev server (also generates types)
npx convex deploy     # Deploy Convex functions to production
```

## Architecture

**Three-tier structure:**
- Frontend: React + Vite + TanStack Router (file-based routing in `src/routes/`)
- Backend: Convex serverless functions (`convex/`) with real-time database
- Optional: LaTeX microservice (`latex-service/`) for compilation and thumbnails

**Key data flow:**
1. Users authenticate via OAuth (GitHub/GitLab) → tokens stored in `users` table
2. Users add Git repositories → tracked in `repositories` table
3. Files within repos are tracked in `trackedFiles` with PDF source type (committed/artifact/release/compile)
4. Sync fetches latest commits and creates/updates `papers` with cached PDFs
5. PDFs are cached by commit hash - only re-fetched when repo changes

## Backend Organization (`convex/`)

- `schema.ts` - Database tables: users, repositories, trackedFiles, papers, compilationJobs, selfHostedGitLabInstances
- `auth.ts` / `auth.config.ts` - Convex Auth setup with GitHub + GitLab OAuth
- `repositories.ts` - CRUD for Git repositories and tracked files
- `papers.ts` - Paper queries, metadata updates, public sharing
- `sync.ts` - Main sync logic: fetch commits, compile/fetch PDFs
- `git.ts` - Git operations across providers
- `latex.ts` - LaTeX compilation via external service
- `lib/gitProviders.ts` - URL parsing for GitHub/GitLab/Overleaf
- `lib/fileFetching.ts` - Authenticated file fetching from Git providers

## Frontend Organization (`src/`)

- `routes/__root.tsx` - Root layout with header and auth
- `routes/index.tsx` - Gallery view with drag-to-upload
- `routes/repositories.tsx` - Repository management UI
- `routes/papers.$id.tsx` - Single paper detail view
- `routes/share.$slug.tsx` - Public share page
- `hooks/useUser.ts` - Auth state and provider detection

Routes are file-based via TanStack Router - `routeTree.gen.ts` is auto-generated.

## Database Schema

Key relationships:
- `repositories` belong to `users` (by userId)
- `trackedFiles` belong to `repositories` (by repositoryId)
- `papers` link to `trackedFiles` and `repositories`, or can be standalone uploads
- `selfHostedGitLabInstances` belong to `users` for multi-instance support

PDF source types in `trackedFiles.pdfSourceType`: `committed`, `artifact`, `release`, `compile`

## Multi-Provider Git Support

The app supports four Git providers, each with different authentication:
- **GitHub**: OAuth token from auth flow
- **GitLab**: OAuth token from auth flow
- **Overleaf**: Basic auth (email + token stored in users table)
- **Self-hosted GitLab**: Per-instance tokens in `selfHostedGitLabInstances` table

Provider detection and URL parsing logic is in `convex/lib/gitProviders.ts`.

## LaTeX Service (`latex-service/`)

Optional Docker microservice for:
- `POST /compile` - Compile LaTeX to PDF
- `POST /thumbnail` - Generate PDF thumbnails
- `POST /git/archive` - Fetch git repository archives

Requires `LATEX_SERVICE_URL` environment variable when enabled.
