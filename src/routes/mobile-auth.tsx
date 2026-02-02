import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useConvexAuth } from "convex/react";
import { useAuthActions, useAuthToken } from "@convex-dev/auth/react";
import { EmailPasswordForm } from "../components/auth/EmailPasswordForm";
import { GitHubIcon, GitLabIcon } from "../components/icons";

// Mobile app callback URL scheme
const MOBILE_CALLBACK_URL = "carrel://auth/callback";

// Redirect back to mobile app
function notifyCancel() {
  window.location.href = `${MOBILE_CALLBACK_URL}?cancelled=true`;
}

interface MobileAuthSearch {
  provider?: "github" | "gitlab" | "email";
  error?: string;
}

export const Route = createFileRoute("/mobile-auth")({
  validateSearch: (search: Record<string, unknown>): MobileAuthSearch => ({
    provider: search.provider as MobileAuthSearch["provider"],
    error: search.error as string | undefined,
  }),
  component: MobileAuthPage,
});

function MobileAuthPage() {
  const search = useSearch({ from: "/mobile-auth" });
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const authToken = useAuthToken();
  const { signIn } = useAuthActions();
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [authStarted, setAuthStarted] = useState(false);
  const [error] = useState<string | null>(search.error ?? null);
  const [tokenExchangeAttempted, setTokenExchangeAttempted] = useState(false);

  // Get the Convex Auth token and redirect to mobile app
  const exchangeAndNotify = useCallback(() => {
    if (!authToken) {
      window.location.href = `${MOBILE_CALLBACK_URL}?error=no_token`;
      return;
    }

    // Pass Convex Auth token to iOS - single token that works with Convex SDK
    const params = new URLSearchParams({
      token: authToken,
    });
    window.location.href = `${MOBILE_CALLBACK_URL}?${params.toString()}`;
  }, [authToken]);

  // Auto-start OAuth flow if provider is specified
  useEffect(() => {
    if (authStarted || isAuthLoading) return;

    const provider = search.provider;
    if (provider === "github" || provider === "gitlab") {
      // Use setTimeout to avoid setting state synchronously in effect
      setTimeout(() => setAuthStarted(true), 0);
      // Redirect back to this page after OAuth completes
      signIn(provider, {
        redirectTo: window.location.origin + "/mobile-auth",
      });
    }
  }, [search.provider, authStarted, isAuthLoading, signIn]);

  // Redirect to mobile app after successful authentication
  useEffect(() => {
    console.log("[mobile-auth] Auth state:", { isAuthenticated, hasToken: !!authToken, isRedirecting, tokenExchangeAttempted });

    // Wait for auth token to be available before redirecting
    if (isAuthenticated && authToken && !isRedirecting && !tokenExchangeAttempted) {
      console.log("[mobile-auth] Token ready, redirecting to app...");
      // Small delay to ensure session is fully established
      const timer = setTimeout(() => {
        setIsRedirecting(true);
        setTokenExchangeAttempted(true);
        // Notify mobile app (via postMessage or redirect)
        exchangeAndNotify();
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [isAuthenticated, authToken, isRedirecting, tokenExchangeAttempted, exchangeAndNotify]);

  // Handle successful email auth
  const handleEmailAuthSuccess = () => {
    console.log("[mobile-auth] Email auth success, waiting for token...");
    // Don't set tokenExchangeAttempted here - let the useEffect handle it
    // when authToken becomes available. The useEffect will trigger when
    // isAuthenticated && authToken both become true.
  };

  // Show redirecting state - only when token is ready
  if (isRedirecting || (isAuthenticated && authToken && !error)) {
    return (
      <MobileAuthLayout>
        <div className="flex flex-col items-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-900" />
          <p className="mt-4 text-gray-600">Redirecting to app...</p>
          <p className="mt-2 text-sm text-gray-500">
            If you're not redirected automatically,{" "}
            <button
              onClick={() => exchangeAndNotify()}
              className="text-blue-600 underline"
            >
              tap here
            </button>
          </p>
        </div>
      </MobileAuthLayout>
    );
  }

  // Show loading state during OAuth
  if (isAuthLoading || (authStarted && !error)) {
    return (
      <MobileAuthLayout>
        <div className="flex flex-col items-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-900" />
          <p className="mt-4 text-gray-600">Signing in...</p>
        </div>
      </MobileAuthLayout>
    );
  }

  // Show auth options
  return (
    <MobileAuthLayout>
      <div className="w-full max-w-sm">
        <h1 className="mb-2 text-center text-2xl font-normal text-gray-900">
          Sign in to Carrel
        </h1>
        <p className="mb-8 text-center text-gray-600">
          Connect your account to access papers on mobile
        </p>

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Email/Password Form */}
        {search.provider === "email" && (
          <div className="mb-6">
            <EmailPasswordForm onSuccess={handleEmailAuthSuccess} />
          </div>
        )}

        {/* Show all options if no specific provider requested */}
        {!search.provider && (
          <>
            <div className="mb-6">
              <EmailPasswordForm onSuccess={handleEmailAuthSuccess} />
            </div>

            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-white px-2 text-gray-500">
                  or continue with
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  setAuthStarted(true);
                  signIn("github", {
                    redirectTo: window.location.origin + "/mobile-auth",
                  });
                }}
                className="inline-flex w-full items-center justify-center rounded-md bg-gray-900 px-4 py-3 text-base font-normal text-white hover:bg-gray-800"
              >
                <GitHubIcon className="mr-2 h-5 w-5" />
                Continue with GitHub
              </button>

              <button
                onClick={() => {
                  setAuthStarted(true);
                  signIn("gitlab", {
                    redirectTo: window.location.origin + "/mobile-auth",
                  });
                }}
                className="inline-flex w-full items-center justify-center rounded-md bg-[#FC6D26] px-4 py-3 text-base font-normal text-white hover:bg-[#E24329]"
              >
                <GitLabIcon className="mr-2 h-5 w-5" />
                Continue with GitLab
              </button>
            </div>
          </>
        )}

        {/* Show specific OAuth button if requested */}
        {search.provider === "github" && !authStarted && (
          <button
            onClick={() => {
              setAuthStarted(true);
              signIn("github", {
                redirectTo: window.location.origin + "/mobile-auth",
              });
            }}
            className="inline-flex w-full items-center justify-center rounded-md bg-gray-900 px-4 py-3 text-base font-normal text-white hover:bg-gray-800"
          >
            <GitHubIcon className="mr-2 h-5 w-5" />
            Continue with GitHub
          </button>
        )}

        {search.provider === "gitlab" && !authStarted && (
          <button
            onClick={() => {
              setAuthStarted(true);
              signIn("gitlab", {
                redirectTo: window.location.origin + "/mobile-auth",
              });
            }}
            className="inline-flex w-full items-center justify-center rounded-md bg-[#FC6D26] px-4 py-3 text-base font-normal text-white hover:bg-[#E24329]"
          >
            <GitLabIcon className="mr-2 h-5 w-5" />
            Continue with GitLab
          </button>
        )}

        <p className="mt-8 text-center text-xs text-gray-500">
          After signing in, you'll be redirected back to the Carrel app.
        </p>

        {/* Cancel link */}
        <div className="mt-4 text-center">
          <button
            onClick={() => notifyCancel()}
            className="text-sm text-gray-600 underline"
          >
            Cancel and return to app
          </button>
        </div>
      </div>
    </MobileAuthLayout>
  );
}

function MobileAuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white p-6">
      <div className="mb-8">
        <span className="font-serif text-3xl font-normal tracking-tight text-gray-900">
          Carrel
        </span>
      </div>
      {children}
    </div>
  );
}
