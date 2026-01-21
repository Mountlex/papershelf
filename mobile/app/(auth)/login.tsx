import { View, Text, Pressable, StyleSheet, Image, ImageSourcePropType } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/lib/useAuth";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const iconSource: ImageSourcePropType = require("@/assets/icon.png");

export default function LoginScreen() {
  const { loginWithEmail, isLoading } = useAuth();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Image
          source={iconSource}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>Carrel</Text>
        <Text style={styles.subtitle}>Preview your LaTeX papers</Text>
      </View>

      <View style={styles.buttons}>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            styles.primaryButton,
            pressed && styles.buttonPressed,
          ]}
          onPress={loginWithEmail}
          disabled={isLoading}
        >
          <Ionicons name="mail-outline" size={20} color="white" />
          <Text style={styles.primaryButtonText}>Sign in with Email</Text>
        </Pressable>
      </View>

      <Text style={styles.terms}>
        By continuing, you agree to our Terms of Service
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    padding: 24,
    justifyContent: "center",
  },
  header: {
    alignItems: "center",
    marginBottom: 48,
  },
  logo: {
    width: 72,
    height: 72,
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#000",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: "#666",
  },
  buttons: {
    gap: 12,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 10,
    gap: 10,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  primaryButton: {
    backgroundColor: "#000",
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
  terms: {
    marginTop: 32,
    textAlign: "center",
    fontSize: 12,
    color: "#999",
  },
});
