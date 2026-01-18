import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { AuthProvider } from "@/lib/auth";
import { registerBackgroundTasks } from "@/lib/backgroundTasks";

// Prevent splash screen from auto-hiding
SplashScreen.preventAutoHideAsync();

const convex = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL!, {
  unsavedChangesWarning: false,
});

export default function RootLayout() {
  useEffect(() => {
    // Register background download tasks
    registerBackgroundTasks();

    // Hide splash screen after initialization
    SplashScreen.hideAsync();
  }, []);

  return (
    <ConvexProvider client={convex}>
      <AuthProvider>
        <Stack
          screenOptions={{
            headerShown: false,
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen
            name="paper/[id]"
            options={{
              headerShown: true,
              title: "",
              presentation: "card",
            }}
          />
        </Stack>
        <StatusBar style="auto" />
      </AuthProvider>
    </ConvexProvider>
  );
}
