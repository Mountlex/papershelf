import { View, Text, Pressable, StyleSheet, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/lib/auth";

export default function LoginScreen() {
  const { loginWithGitHub, loginWithGitLab, loginWithEmail, isLoading } = useAuth();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Image
          source={require("@/assets/icon.png")}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>Carrel</Text>
        <Text style={styles.subtitle}>Your academic papers, everywhere</Text>
      </View>

      <View style={styles.buttons}>
        <Pressable
          style={[styles.button, styles.githubButton]}
          onPress={loginWithGitHub}
          disabled={isLoading}
        >
          <Ionicons name="logo-github" size={24} color="white" />
          <Text style={styles.buttonText}>Continue with GitHub</Text>
        </Pressable>

        <Pressable
          style={[styles.button, styles.gitlabButton]}
          onPress={loginWithGitLab}
          disabled={isLoading}
        >
          <Ionicons name="git-branch" size={24} color="white" />
          <Text style={styles.buttonText}>Continue with GitLab</Text>
        </Pressable>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        <Pressable
          style={[styles.button, styles.emailButton]}
          onPress={loginWithEmail}
          disabled={isLoading}
        >
          <Ionicons name="mail-outline" size={24} color="#333" />
          <Text style={[styles.buttonText, styles.emailButtonText]}>
            Continue with Email
          </Text>
        </Pressable>
      </View>

      <Text style={styles.terms}>
        By continuing, you agree to our Terms of Service and Privacy Policy
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
    width: 80,
    height: 80,
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    color: "#111",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
  },
  buttons: {
    gap: 12,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  githubButton: {
    backgroundColor: "#24292e",
  },
  gitlabButton: {
    backgroundColor: "#fc6d26",
  },
  emailButton: {
    backgroundColor: "#f5f5f5",
    borderWidth: 1,
    borderColor: "#ddd",
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "white",
  },
  emailButtonText: {
    color: "#333",
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 8,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#ddd",
  },
  dividerText: {
    marginHorizontal: 16,
    color: "#999",
    fontSize: 14,
  },
  terms: {
    marginTop: 32,
    textAlign: "center",
    fontSize: 12,
    color: "#999",
    lineHeight: 18,
  },
});
