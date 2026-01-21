import * as SecureStore from "expo-secure-store";

const CONVEX_URL = process.env.EXPO_PUBLIC_CONVEX_URL!;
// HTTP routes are served on .convex.site, not .convex.cloud
const CONVEX_SITE_URL = CONVEX_URL.replace('.convex.cloud', '.convex.site');

// Storage keys
const ACCESS_TOKEN_KEY = "carrel_access_token";
const REFRESH_TOKEN_KEY = "carrel_refresh_token";
const TOKEN_EXPIRY_KEY = "carrel_token_expiry";

// Helper to get current access token (with auto-refresh)
export async function getAccessToken(): Promise<string | null> {
  const storedToken = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  const storedExpiry = await SecureStore.getItemAsync(TOKEN_EXPIRY_KEY);

  if (!storedToken || !storedExpiry) {
    return null;
  }

  const expiry = parseInt(storedExpiry, 10);

  // Refresh if expiring within 1 minute
  if (Date.now() > expiry - 60000) {
    const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    if (!refreshToken) {
      return null;
    }

    const response = await fetch(`${CONVEX_SITE_URL}/api/mobile/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, data.accessToken);
    await SecureStore.setItemAsync(TOKEN_EXPIRY_KEY, data.expiresAt.toString());
    return data.accessToken;
  }

  return storedToken;
}

// Export the site URL for use in other modules
export { CONVEX_SITE_URL };
