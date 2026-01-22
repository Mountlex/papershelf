# Carrel iOS App

Native iOS app for Carrel paper gallery, built with SwiftUI targeting iOS 26.

## Setup

1. Open the project in Xcode 17+
2. Create a new Xcode project:
   - File → New → Project → iOS App
   - Product Name: Carrel
   - Interface: SwiftUI
   - Language: Swift
   - Minimum Deployment: iOS 26.0
3. Replace the generated files with the files in this directory
4. Update `AuthManager.swift` with your Convex deployment URL:
   ```swift
   static let baseURL = URL(string: "https://your-deployment.convex.site")!
   static let siteURL = URL(string: "https://your-site.com")!
   ```

## Project Structure

```
CarrelApp/
├── App/
│   ├── CarrelApp.swift          # App entry point
│   └── ContentView.swift        # Root view with auth state
├── Core/
│   ├── Network/
│   │   ├── ConvexClient.swift   # HTTP client for Convex API
│   │   ├── APIError.swift       # Error types
│   │   └── Models/              # Codable response types
│   ├── Auth/
│   │   ├── AuthManager.swift    # Token storage, refresh logic
│   │   └── KeychainManager.swift # Secure token storage
│   └── Extensions/
├── Features/
│   ├── Auth/
│   │   ├── LoginView.swift      # Login buttons
│   │   └── OAuthWebView.swift   # WKWebView for OAuth
│   ├── Gallery/
│   │   ├── GalleryView.swift    # Main paper grid
│   │   ├── PaperCard.swift      # Individual paper card
│   │   └── GalleryViewModel.swift
│   ├── Paper/
│   │   ├── PaperDetailView.swift # PDF viewer + metadata
│   │   └── PaperViewModel.swift
│   └── Settings/
│       ├── SettingsView.swift
│       └── SettingsViewModel.swift
└── Shared/
    └── Components/
        ├── GlassCard.swift      # Glass material container
        └── StatusBadge.swift    # Build status indicator
```

## Features

- OAuth authentication (GitHub, GitLab)
- Paper gallery with thumbnails
- PDF viewing with PDFKit
- Pull-to-refresh
- Build/sync papers
- Edit paper metadata
- Toggle public/private sharing
- Secure token storage in Keychain

## Requirements

- Xcode 17+
- iOS 26.0+
- Swift 6

## URL Scheme

The app registers the `carrel://` URL scheme for OAuth callbacks. The web app redirects to `carrel://auth/callback?accessToken=...` after successful authentication.
