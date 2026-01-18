# Carrel Mobile

React Native mobile app for Carrel - access your academic papers offline.

## Features

- Browse papers from your Carrel account
- Download individual papers or all at once
- Offline PDF viewing with native reader
- Background downloads
- Storage management

## Setup

### Prerequisites

- Node.js 20+
- Bun or npm
- Expo CLI (`npm install -g expo-cli`)
- iOS Simulator (Mac) or Android Emulator
- Xcode 16+ (for iOS development)

### Installation

```bash
cd mobile
bun install

# Copy environment file
cp .env.example .env
# Edit .env with your Convex URL
```

### Development

```bash
# Start Expo dev server
bun run dev

# Run on iOS simulator
bun run ios

# Run on Android emulator
bun run android
```

### Building

This app uses **Development Builds** (not Expo Go) because it includes native modules:
- `react-native-pdf` for PDF viewing
- `expo-sqlite` for offline storage

```bash
# Create development build
bun run build:dev

# Create preview build
bun run build:preview

# Create production build
bun run build:prod
```

## Project Structure

```
mobile/
├── app/                    # Expo Router screens
│   ├── (auth)/            # Login screens
│   ├── (tabs)/            # Main tab navigation
│   │   ├── index.tsx      # Papers gallery
│   │   ├── offline.tsx    # Offline papers
│   │   └── settings.tsx   # Settings
│   └── paper/[id].tsx     # PDF viewer
├── components/            # React components
├── hooks/                 # Custom React hooks
├── lib/                   # Core utilities
│   ├── auth.tsx          # Authentication
│   ├── downloadManager.ts # Download queue
│   ├── offlineStorage.ts # SQLite database
│   └── backgroundTasks.ts # Background fetch
└── assets/               # Images and icons
```

## Architecture

### Authentication

The app uses JWT tokens for authentication:

1. User logs in via OAuth (GitHub/GitLab) in a web browser
2. Web app sets session cookie
3. Mobile app exchanges session for JWT access + refresh tokens
4. Tokens stored securely in `expo-secure-store`

### Offline Storage

- SQLite database tracks downloaded papers
- PDFs stored in app's document directory (persistent)
- Thumbnails cached alongside PDFs

### Download Manager

- Queue-based download system
- Max 2 concurrent downloads
- Progress tracking with events
- Resume support after app restart

## Backend Endpoints

The app uses these Convex endpoints:

**Queries:**
- `papers.list` - Get user's papers
- `papers.get` - Get single paper

**HTTP (Mobile Auth):**
- `POST /api/auth/mobile/token` - Exchange session for tokens
- `POST /api/auth/mobile/refresh` - Refresh access token
- `POST /api/auth/mobile/revoke` - Revoke refresh token

## Adding Assets

Replace placeholder files in `assets/`:

- `icon.png` - App icon (1024x1024, square)
- `splash.png` - Splash screen (1284x2778)
- `adaptive-icon.png` - Android adaptive icon (1024x1024)

## Environment Variables

| Variable | Description |
|----------|-------------|
| `EXPO_PUBLIC_CONVEX_URL` | Your Convex deployment URL |
| `EXPO_PUBLIC_WEB_URL` | Web app URL for OAuth redirects |
