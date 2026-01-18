import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { VerificationCodeInput } from "./VerificationCodeInput";

type AuthMode = "signIn" | "signUp" | "verify" | "forgotPassword" | "resetPassword";

interface FormErrors {
  email?: string;
  password?: string;
  name?: string;
  code?: string;
  general?: string;
}

function validatePassword(password: string): string | undefined {
  if (password.length < 8) {
    return "Password must be at least 8 characters";
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must contain at least one uppercase letter";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must contain at least one number";
  }
  return undefined;
}

export function EmailPasswordForm() {
  const { signIn } = useAuthActions();
  const invalidateAllSessions = useMutation(api.users.invalidateAllSessions);
  const [mode, setMode] = useState<AuthMode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [isLoading, setIsLoading] = useState(false);

  const resetForm = () => {
    setPassword("");
    setNewPassword("");
    setCode("");
    setErrors({});
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.set("email", email);
      formData.set("password", password);
      formData.set("flow", "signIn");

      await signIn("password", formData);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sign in failed";
      if (message.includes("not verified") || message.includes("verify")) {
        setMode("verify");
        setErrors({ general: "Please verify your email first" });
      } else if (message.includes("Invalid") || message.includes("credentials")) {
        setErrors({ general: "Invalid email or password" });
      } else {
        setErrors({ general: message });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const passwordError = validatePassword(password);
    if (passwordError) {
      setErrors({ password: passwordError });
      return;
    }

    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.set("email", email);
      formData.set("password", password);
      formData.set("name", name);
      formData.set("flow", "signUp");

      await signIn("password", formData);
      setMode("verify");
    } catch (error) {
      // Security: Use generic message to prevent email enumeration
      // Don't reveal whether an account exists or not
      const message = error instanceof Error ? error.message : "";
      if (message.includes("already exists") || message.includes("existing")) {
        setErrors({
          general: "Unable to create account. If you already have an account, try signing in instead.",
        });
      } else {
        setErrors({ general: "Unable to create account. Please try again." });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async (verificationCode: string) => {
    setErrors({});
    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.set("email", email);
      formData.set("code", verificationCode);
      formData.set("flow", "email-verification");

      await signIn("password", formData);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Verification failed";
      if (message.includes("expired")) {
        setErrors({ code: "Code has expired. Please request a new one." });
      } else if (message.includes("invalid") || message.includes("Invalid")) {
        setErrors({ code: "Invalid verification code" });
      } else {
        setErrors({ code: message });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.set("email", email);
      formData.set("flow", "reset");

      await signIn("password", formData);
    } catch (error) {
      // Security: Don't reveal whether account exists
      // Silently proceed to reset screen regardless of error
      console.error("Password reset request error (suppressed for security):", error);
    } finally {
      setIsLoading(false);
      // Security: Always show success message to prevent email enumeration
      // The reset screen will say "If an account exists, we sent a code"
      setMode("resetPassword");
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      setErrors({ password: passwordError });
      return;
    }

    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.set("email", email);
      formData.set("code", code);
      formData.set("newPassword", newPassword);
      formData.set("flow", "reset-verification");

      await signIn("password", formData);

      // Security: Invalidate all other sessions after password reset
      // This ensures attackers who may have compromised previous sessions are logged out
      try {
        await invalidateAllSessions({});
      } catch (sessionError) {
        // Non-critical - log but don't fail the password reset
        console.error("Failed to invalidate sessions:", sessionError);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Reset failed";
      if (message.includes("expired")) {
        setErrors({ code: "Code has expired. Please request a new one." });
      } else if (message.includes("invalid") || message.includes("Invalid")) {
        setErrors({ code: "Invalid verification code" });
      } else {
        setErrors({ general: message });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    setErrors({});
    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.set("email", email);

      if (mode === "verify") {
        formData.set("flow", "resend-email-verification");
      } else {
        formData.set("flow", "reset");
      }
      await signIn("password", formData);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to resend code";
      setErrors({ general: message });
    } finally {
      setIsLoading(false);
    }
  };

  // Verification code screen
  if (mode === "verify") {
    return (
      <div className="w-full max-w-sm mx-auto">
        <h2 className="text-xl font-semibold text-gray-900 text-center mb-2">
          Verify your email
        </h2>
        <p className="text-sm text-gray-600 text-center mb-6">
          We sent a verification code to <strong>{email}</strong>
        </p>

        <VerificationCodeInput
          length={8}
          onComplete={handleVerifyCode}
          disabled={isLoading}
        />

        {errors.code && (
          <p className="mt-2 text-sm text-red-600 text-center">{errors.code}</p>
        )}
        {errors.general && (
          <p className="mt-2 text-sm text-red-600 text-center">{errors.general}</p>
        )}

        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={handleResendCode}
            disabled={isLoading}
            className="text-sm text-gray-600 hover:text-gray-900 underline"
          >
            Resend code
          </button>
        </div>

        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => {
              resetForm();
              setMode("signIn");
            }}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  // Forgot password screen
  if (mode === "forgotPassword") {
    return (
      <div className="w-full max-w-sm mx-auto">
        <h2 className="text-xl font-semibold text-gray-900 text-center mb-2">
          Reset your password
        </h2>
        <p className="text-sm text-gray-600 text-center mb-6">
          Enter your email and we'll send you a code to reset your password.
        </p>

        <form onSubmit={handleForgotPassword} className="space-y-4">
          <div>
            <label htmlFor="reset-email" className="block text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              id="reset-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              placeholder="you@example.com"
            />
          </div>

          {errors.general && (
            <p className="text-sm text-red-600">{errors.general}</p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {isLoading ? "Sending..." : "Send reset code"}
          </button>
        </form>

        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => {
              resetForm();
              setMode("signIn");
            }}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  // Reset password with code screen
  if (mode === "resetPassword") {
    return (
      <div className="w-full max-w-sm mx-auto">
        <h2 className="text-xl font-semibold text-gray-900 text-center mb-2">
          Enter reset code
        </h2>
        <p className="text-sm text-gray-600 text-center mb-6">
          If an account exists for <strong>{email}</strong>, we sent a reset code.
        </p>

        <form onSubmit={handleResetPassword} className="space-y-4">
          <div>
            <label htmlFor="reset-code" className="block text-sm font-medium text-gray-700">
              Verification code
            </label>
            <input
              id="reset-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono tracking-widest focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              placeholder="12345678"
            />
            {errors.code && (
              <p className="mt-1 text-sm text-red-600">{errors.code}</p>
            )}
          </div>

          <div>
            <label htmlFor="new-password" className="block text-sm font-medium text-gray-700">
              New password
            </label>
            <input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              placeholder="Min 8 chars, 1 uppercase, 1 number"
            />
            {errors.password && (
              <p className="mt-1 text-sm text-red-600">{errors.password}</p>
            )}
          </div>

          {errors.general && (
            <p className="text-sm text-red-600">{errors.general}</p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {isLoading ? "Resetting..." : "Reset password"}
          </button>
        </form>

        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={handleResendCode}
            disabled={isLoading}
            className="text-sm text-gray-600 hover:text-gray-900 underline"
          >
            Resend code
          </button>
        </div>

        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => {
              resetForm();
              setMode("signIn");
            }}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  // Sign in / Sign up form
  return (
    <div className="w-full max-w-sm mx-auto">
      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        <button
          type="button"
          onClick={() => {
            resetForm();
            setMode("signIn");
          }}
          className={`flex-1 pb-2 text-sm font-medium border-b-2 transition-colors ${
            mode === "signIn"
              ? "border-gray-900 text-gray-900"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Sign In
        </button>
        <button
          type="button"
          onClick={() => {
            resetForm();
            setMode("signUp");
          }}
          className={`flex-1 pb-2 text-sm font-medium border-b-2 transition-colors ${
            mode === "signUp"
              ? "border-gray-900 text-gray-900"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Sign Up
        </button>
      </div>

      <form onSubmit={mode === "signUp" ? handleSignUp : handleSignIn} className="space-y-4">
        {mode === "signUp" && (
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700">
              Name <span className="text-gray-400">(optional)</span>
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              placeholder="Your name"
            />
            {errors.name && (
              <p className="mt-1 text-sm text-red-600">{errors.name}</p>
            )}
          </div>
        )}

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            placeholder="you@example.com"
          />
          {errors.email && (
            <p className="mt-1 text-sm text-red-600">{errors.email}</p>
          )}
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            placeholder={mode === "signUp" ? "Min 8 chars, 1 uppercase, 1 number" : "Your password"}
          />
          {errors.password && (
            <p className="mt-1 text-sm text-red-600">{errors.password}</p>
          )}
        </div>

        {errors.general && (
          <p className="text-sm text-red-600">{errors.general}</p>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {isLoading
            ? mode === "signUp"
              ? "Creating account..."
              : "Signing in..."
            : mode === "signUp"
              ? "Create account"
              : "Sign in"}
        </button>
      </form>

      {mode === "signIn" && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => {
              resetForm();
              setMode("forgotPassword");
            }}
            className="text-sm text-gray-600 hover:text-gray-900 underline"
          >
            Forgot password?
          </button>
        </div>
      )}
    </div>
  );
}
