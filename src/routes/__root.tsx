import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";
import { useState, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useUser, checkPendingLink, clearPendingLink, isLinkInProgress } from "../hooks/useUser";
import { EmailPasswordForm } from "../components/auth/EmailPasswordForm";

export const Route = createRootRoute({
  component: RootComponent,
});

// GitHub icon component
function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

// GitLab icon component
function GitLabIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M4.845.904c-.435 0-.82.28-.955.692C2.639 5.449 1.246 9.728.07 13.335a1.437 1.437 0 00.522 1.607l11.071 8.045c.2.145.472.144.67-.004l11.073-8.04a1.436 1.436 0 00.522-1.61c-1.285-3.942-2.683-8.256-3.817-11.746a1.004 1.004 0 00-.957-.684.987.987 0 00-.949.69l-2.405 7.408H8.203l-2.41-7.408a.987.987 0 00-.942-.69h-.006z" />
    </svg>
  );
}

// User profile icon component
function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}

// Sign out icon component
function SignOutIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
    </svg>
  );
}

function RootComponent() {
  const {
    user,
    isLoading,
    isAuthenticated,
    signInWithGitHub,
    signInWithGitLab,
    signOut,
  } = useUser();
  const linkProviderToAccount = useMutation(api.users.linkProviderToAccount);
  const [isLinking, setIsLinking] = useState(() => isLinkInProgress());
  const [linkError, setLinkError] = useState<string | null>(null);
  const [showRecovery, setShowRecovery] = useState(false);

  // Detect link completion after OAuth redirect
  useEffect(() => {
    async function handleLinkCompletion() {
      const pendingLink = checkPendingLink();

      if (!pendingLink || !user?._id) {
        // No pending link - clear the in-progress state if set
        if (isLinkInProgress()) {
          setIsLinking(false);
          clearPendingLink();
        }
        return;
      }

      // We have a pending link intent - try to complete it
      setIsLinking(true);
      try {
        // Use the secure intent token (server validates ownership)
        const result = await linkProviderToAccount({
          intentToken: pendingLink.intentToken,
        });
        clearPendingLink();

        if (result.linked) {
          // Small delay to ensure session is committed, then reload
          await new Promise((resolve) => setTimeout(resolve, 500));
          window.location.reload();
        } else {
          // Same user or other non-error case
          setIsLinking(false);
        }
      } catch (error) {
        console.error("Failed to link accounts:", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        setLinkError(errorMessage);
        clearPendingLink();
        setIsLinking(false);
        // Show recovery UI for critical errors
        if (errorMessage.includes("expired") || errorMessage.includes("Invalid")) {
          setShowRecovery(true);
        }
      }
    }

    if (isAuthenticated && user && !isLoading) {
      handleLinkCompletion();
    }
  }, [isAuthenticated, user, isLoading, linkProviderToAccount]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-50 w-full border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <div className="container mx-auto flex h-14 items-center px-4">
          <Link to="/" className="flex items-center space-x-2">
            <span className="text-xl font-bold">PaperShelf</span>
          </Link>
          <nav className="ml-auto flex items-center space-x-6">
            {isAuthenticated && (
              <>
                <Link
                  to="/"
                  className="text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 [&.active]:text-gray-900"
                >
                  Gallery
                </Link>
                <Link
                  to="/repositories"
                  className="text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 [&.active]:text-gray-900"
                >
                  Repositories
                </Link>
              </>
            )}
            {isLoading ? (
              <div className="h-8 w-8 animate-pulse rounded-full bg-gray-200" />
            ) : isAuthenticated ? (
              <div className="flex items-center gap-2">
                <Link
                  to="/profile"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-gray-100 text-gray-600 transition-colors hover:bg-gray-200 hover:text-gray-900"
                  title="Profile"
                >
                  <UserIcon className="h-5 w-5" />
                </Link>
                <button
                  onClick={() => signOut()}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                  title="Sign out"
                >
                  <SignOutIcon className="h-5 w-5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => signInWithGitHub()}
                  className="inline-flex items-center rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
                  title="Sign in with GitHub"
                >
                  <GitHubIcon className="h-4 w-4" />
                  <span className="ml-2 hidden sm:inline">GitHub</span>
                </button>
                <button
                  onClick={() => signInWithGitLab()}
                  className="inline-flex items-center rounded-md bg-[#FC6D26] px-3 py-2 text-sm font-medium text-white hover:bg-[#E24329]"
                  title="Sign in with GitLab"
                >
                  <GitLabIcon className="h-4 w-4" />
                  <span className="ml-2 hidden sm:inline">GitLab</span>
                </button>
              </div>
            )}
          </nav>
        </div>
      </header>
      <main className="container mx-auto px-4 py-8">
        {linkError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-medium text-red-800">Failed to link accounts</p>
            <p className="mt-1 text-sm text-red-600">{linkError}</p>
            <button
              onClick={() => setLinkError(null)}
              className="mt-2 text-sm text-red-700 underline"
            >
              Dismiss
            </button>
          </div>
        )}
        {/* Recovery modal for failed account linking */}
        {showRecovery && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="mx-4 max-w-md rounded-lg bg-white p-6 shadow-xl">
              <h3 className="text-lg font-semibold text-gray-900">Account Linking Failed</h3>
              <p className="mt-2 text-sm text-gray-600">
                The account linking session has expired or was invalid. This can happen if you took
                more than 10 minutes to complete the OAuth flow, or if you navigated away.
              </p>
              <p className="mt-2 text-sm text-gray-600">
                Please sign in to your original account and try linking again.
              </p>
              <div className="mt-4 flex gap-3">
                <button
                  onClick={() => {
                    setShowRecovery(false);
                    setLinkError(null);
                    signOut();
                  }}
                  className="flex-1 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
                >
                  Sign Out & Try Again
                </button>
                <button
                  onClick={() => {
                    setShowRecovery(false);
                    setLinkError(null);
                  }}
                  className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Continue Anyway
                </button>
              </div>
            </div>
          </div>
        )}
        {isLinking ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-900" />
            <p className="mt-4 text-sm text-gray-600">Linking accounts...</p>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-900" />
          </div>
        ) : isAuthenticated ? (
          <Outlet />
        ) : (
          <div className="flex flex-col items-center justify-center py-20">
            <h1 className="mb-4 text-3xl font-bold text-gray-900">
              Welcome to PaperShelf
            </h1>
            <p className="mb-8 max-w-md text-center text-gray-600">
              Preview and share your LaTeX papers from GitHub or GitLab repositories.
              Sign in to get started.
            </p>

            {/* Email/Password Form */}
            <div className="w-full max-w-sm mb-6">
              <EmailPasswordForm />
            </div>

            {/* Divider */}
            <div className="relative w-full max-w-sm mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-gray-50 px-2 text-gray-500">or continue with</span>
              </div>
            </div>

            {/* OAuth Buttons */}
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                onClick={() => signInWithGitHub()}
                className="inline-flex items-center justify-center rounded-md bg-gray-900 px-6 py-3 text-base font-medium text-white hover:bg-gray-800"
              >
                <GitHubIcon className="mr-2 h-5 w-5" />
                Sign in with GitHub
              </button>
              <button
                onClick={() => signInWithGitLab()}
                className="inline-flex items-center justify-center rounded-md bg-[#FC6D26] px-6 py-3 text-base font-medium text-white hover:bg-[#E24329]"
              >
                <GitLabIcon className="mr-2 h-5 w-5" />
                Sign in with GitLab
              </button>
            </div>
          </div>
        )}
      </main>
      <TanStackRouterDevtools position="bottom-right" />
    </div>
  );
}
