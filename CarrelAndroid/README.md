# Carrel Android App

Native Android app for Carrel paper gallery, built with Kotlin and Jetpack Compose.

## Setup

1. Open the project in Android Studio (Hedgehog or later)
2. Update `ConvexClient.kt` with your Convex deployment URL:
   ```kotlin
   companion object {
       const val BASE_URL = "https://your-deployment.convex.site"
       const val SITE_URL = "https://your-site.com"
   }
   ```
3. Sync Gradle and run the app

## Project Structure

```
app/src/main/java/com/carrel/app/
├── CarrelApplication.kt              # Application class, DI setup
├── MainActivity.kt                   # Single activity host
├── core/
│   ├── network/
│   │   ├── ConvexClient.kt          # Ktor HTTP client
│   │   ├── ApiResult.kt             # Result wrapper
│   │   └── models/
│   │       ├── Paper.kt
│   │       ├── User.kt
│   │       └── AuthTokens.kt
│   ├── auth/
│   │   ├── AuthManager.kt           # Token management
│   │   ├── TokenStorage.kt          # EncryptedSharedPreferences
│   │   └── OAuthHandler.kt          # Chrome Custom Tabs
│   └── di/
│       └── AppModule.kt             # Simple DI container
├── features/
│   ├── auth/
│   │   ├── LoginScreen.kt
│   │   └── LoginViewModel.kt
│   ├── gallery/
│   │   ├── GalleryScreen.kt
│   │   ├── PaperCard.kt
│   │   └── GalleryViewModel.kt
│   ├── paper/
│   │   ├── PaperDetailScreen.kt
│   │   └── PaperViewModel.kt
│   └── settings/
│       ├── SettingsScreen.kt
│       └── SettingsViewModel.kt
├── ui/
│   ├── theme/
│   │   ├── Theme.kt                 # Material 3 theme
│   │   ├── Color.kt
│   │   └── Type.kt
│   ├── components/
│   │   └── StatusBadge.kt
│   └── navigation/
│       └── NavGraph.kt              # Compose Navigation
```

## Features

- OAuth authentication (GitHub, GitLab) via Chrome Custom Tabs
- Paper gallery with staggered grid layout
- PDF viewing with PdfRenderer
- Pull-to-refresh
- Build/sync papers
- Edit paper metadata
- Toggle public/private sharing
- Secure token storage with EncryptedSharedPreferences
- Material 3 / Material You dynamic colors

## Tech Stack

- **Kotlin** 2.1
- **Jetpack Compose** with Material 3
- **Ktor** for networking
- **Coil** for image loading
- **EncryptedSharedPreferences** for secure storage
- **Chrome Custom Tabs** for OAuth
- **Compose Navigation**

## Requirements

- Android Studio Hedgehog or later
- JDK 17
- Android SDK 35
- Minimum SDK: 26 (Android 8.0)

## Deep Link

The app registers the `carrel://auth/callback` deep link for OAuth callbacks. After authentication, the web app redirects to:

```
carrel://auth/callback?accessToken=...&refreshToken=...&expiresAt=...
```

This is configured in `AndroidManifest.xml`:

```xml
<intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="carrel" android:host="auth" />
</intent-filter>
```

## Building

```bash
# Debug build
./gradlew assembleDebug

# Release build
./gradlew assembleRelease
```

## Testing

Run in Android Studio emulator (API 26+) and test:
1. OAuth flow with Chrome Custom Tabs
2. Paper list loads with thumbnails
3. PDF viewing
4. Pull-to-refresh
5. Logout flow
6. Dynamic color theming (Android 12+)
