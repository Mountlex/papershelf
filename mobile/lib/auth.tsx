import {
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { AuthContext } from "./AuthContext";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { useRouter } from "expo-router";

const CONVEX_URL = process.env.EXPO_PUBLIC_CONVEX_URL!;
// HTTP routes are served on .convex.site, not .convex.cloud
const CONVEX_SITE_URL = CONVEX_URL.replace('.convex.cloud', '.convex.site');

// Storage keys
const ACCESS_TOKEN_KEY = "carrel_access_token";
const REFRESH_TOKEN_KEY = "carrel_refresh_token";
const TOKEN_EXPIRY_KEY = "carrel_token_expiry";
const USER_KEY = "carrel_user";

interface User {
  id: string;
  email: string;
  name?: string;
}

// Warm up browser for faster OAuth
WebBrowser.warmUpAsync();

function getDeviceInfo() {
  return {
    deviceId: Device.modelId || `${Platform.OS}-${Device.deviceName}`,
    deviceName: Device.deviceName || Device.modelName || "Unknown Device",
    platform: Platform.OS as "ios" | "android",
  };
}

async function clearStoredAuth() {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.deleteItemAsync(TOKEN_EXPIRY_KEY),
    SecureStore.deleteItemAsync(USER_KEY),
  ]);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const routerRef = useRef(router);

  // Keep router ref updated
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const exchangeSessionForTokens = useCallback(async (): Promise<boolean> => {
    try {
      const deviceInfo = getDeviceInfo();

      const response = await fetch(`${CONVEX_SITE_URL}/api/mobile/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(deviceInfo),
      });

      if (!response.ok) {
        throw new Error("Failed to exchange session for tokens");
      }

      const data = await response.json();

      // Store tokens securely
      await Promise.all([
        SecureStore.setItemAsync(ACCESS_TOKEN_KEY, data.accessToken),
        SecureStore.setItemAsync(REFRESH_TOKEN_KEY, data.refreshToken),
        SecureStore.setItemAsync(TOKEN_EXPIRY_KEY, data.expiresAt.toString()),
      ]);

      setAccessToken(data.accessToken);

      // Verify token and get user info
      const verifyResponse = await fetch(`${CONVEX_SITE_URL}/api/mobile/verify`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${data.accessToken}`,
        },
      });

      if (verifyResponse.ok) {
        const verifyData = await verifyResponse.json();
        const userData: User = {
          id: verifyData.userId,
          email: verifyData.email,
          name: verifyData.name,
        };
        await SecureStore.setItemAsync(USER_KEY, JSON.stringify(userData));
        setUser(userData);
      }

      return true;
    } catch (error) {
      console.error("Token exchange error:", error);
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      // Revoke refresh token on server
      const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
      if (refreshToken) {
        await fetch(`${CONVEX_SITE_URL}/api/mobile/revoke`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ refreshToken }),
        }).catch(() => {
          // Ignore errors - we're logging out anyway
        });
      }

      // Clear local storage
      await clearStoredAuth();

      setAccessToken(null);
      setUser(null);
      routerRef.current.replace("/(auth)/login");
    } catch (error) {
      console.error("Logout error:", error);
    }
  }, []);

  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    try {
      const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);

      if (!refreshToken) {
        return null;
      }

      const response = await fetch(`${CONVEX_SITE_URL}/api/mobile/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        // Refresh token is invalid, clear auth state
        await clearStoredAuth();
        setAccessToken(null);
        setUser(null);
        return null;
      }

      const data = await response.json();

      await Promise.all([
        SecureStore.setItemAsync(ACCESS_TOKEN_KEY, data.accessToken),
        SecureStore.setItemAsync(TOKEN_EXPIRY_KEY, data.expiresAt.toString()),
      ]);

      setAccessToken(data.accessToken);
      return data.accessToken;
    } catch (error) {
      console.error("Token refresh error:", error);
      return null;
    }
  }, []);

  const loginWithEmail = useCallback(() => {
    // Navigate to WebView login screen
    routerRef.current.push({
      pathname: "/(auth)/webview-login",
      params: { provider: "email" },
    });
  }, []);

  const completeWebViewAuth = useCallback(async (): Promise<boolean> => {
    try {
      setIsLoading(true);
      const success = await exchangeSessionForTokens();
      if (success) {
        routerRef.current.replace("/(tabs)");
      }
      return success;
    } catch (error) {
      console.error("WebView auth completion error:", error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [exchangeSessionForTokens]);

  const setTokensFromWebView = useCallback(async (tokens: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  }): Promise<boolean> => {
    try {
      setIsLoading(true);

      // Store tokens securely
      await Promise.all([
        SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken),
        SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken),
        SecureStore.setItemAsync(TOKEN_EXPIRY_KEY, tokens.expiresAt.toString()),
      ]);

      setAccessToken(tokens.accessToken);

      // Verify token and get user info
      const verifyResponse = await fetch(`${CONVEX_SITE_URL}/api/mobile/verify`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      });

      if (verifyResponse.ok) {
        const verifyData = await verifyResponse.json();
        const userData: User = {
          id: verifyData.userId,
          email: verifyData.email,
          name: verifyData.name,
        };
        await SecureStore.setItemAsync(USER_KEY, JSON.stringify(userData));
        setUser(userData);
      }

      routerRef.current.replace("/(tabs)");
      return true;
    } catch (error) {
      console.error("setTokensFromWebView error:", error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load stored auth state on mount
  useEffect(() => {
    async function loadStoredAuth() {
      try {
        const [storedToken, storedExpiry, storedUser] = await Promise.all([
          SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
          SecureStore.getItemAsync(TOKEN_EXPIRY_KEY),
          SecureStore.getItemAsync(USER_KEY),
        ]);

        if (storedToken && storedExpiry && storedUser) {
          const expiry = parseInt(storedExpiry, 10);

          // Check if token is still valid (with 1 minute buffer)
          if (Date.now() < expiry - 60000) {
            setAccessToken(storedToken);
            setUser(JSON.parse(storedUser));
          } else {
            // Try to refresh
            await refreshAccessToken();
          }
        }
      } catch (error) {
        console.error("Error loading stored auth:", error);
      } finally {
        setIsLoading(false);
      }
    }

    loadStoredAuth();
  }, [refreshAccessToken]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!accessToken,
        isLoading,
        accessToken,
        loginWithEmail,
        logout,
        refreshAccessToken,
        completeWebViewAuth,
        setTokensFromWebView,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

