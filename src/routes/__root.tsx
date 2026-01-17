import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";
import { useState, useRef, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useUser, checkPendingLink, clearPendingLink, isLinkInProgress } from "../hooks/useUser";
import type { Id } from "../../convex/_generated/dataModel";

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

function RootComponent() {
  const {
    user,
    isLoading,
    isAuthenticated,
    signInWithGitHub,
    signInWithGitLab,
    linkWithGitHub,
    linkWithGitLab,
    disconnectGitHub,
    disconnectGitLab,
    signOut,
    connectedProviders,
    selfHostedGitLabInstances,
  } = useUser();
  const linkProviderToAccount = useMutation(api.users.linkProviderToAccount);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [isLinking, setIsLinking] = useState(() => isLinkInProgress());
  const [linkError, setLinkError] = useState<string | null>(null);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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

      // If current user differs from original, we need to link
      if (user._id !== pendingLink.originalUserId) {
        setIsLinking(true);
        try {
          await linkProviderToAccount({
            originalUserId: pendingLink.originalUserId as Id<"users">,
          });
          clearPendingLink();
          // Small delay to ensure session is committed, then reload
          await new Promise((resolve) => setTimeout(resolve, 500));
          window.location.reload();
        } catch (error) {
          console.error("Failed to link accounts:", error);
          const errorMessage = error instanceof Error ? error.message : String(error);
          setLinkError(errorMessage);
          clearPendingLink();
          setIsLinking(false);
        }
      } else {
        // Same user - OAuth added provider to existing account (same email)
        clearPendingLink();
        setIsLinking(false);
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
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setIsMenuOpen(!isMenuOpen)}
                  className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-gray-100"
                >
                  {user?.image && (
                    <img
                      src={user.image}
                      alt={user.name || "User"}
                      className="h-8 w-8 rounded-full"
                    />
                  )}
                  <div className="flex items-center gap-1">
                    {connectedProviders.github && (
                      <GitHubIcon className="h-4 w-4 text-gray-700" />
                    )}
                    {connectedProviders.gitlab && (
                      <GitLabIcon className="h-4 w-4 text-[#FC6D26]" />
                    )}
                    {connectedProviders.selfHostedGitLab && (
                      <GitLabIcon className="h-4 w-4 text-[#554488]" />
                    )}
                  </div>
                  <svg
                    className={`h-4 w-4 text-gray-500 transition-transform ${isMenuOpen ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Dropdown menu */}
                {isMenuOpen && (
                  <div className="absolute right-0 mt-2 w-64 rounded-lg border bg-white py-2 shadow-lg">
                    <div className="border-b px-4 py-2">
                      <p className="text-sm font-medium text-gray-900">{user?.name || "User"}</p>
                      <p className="text-xs text-gray-500">{user?.email}</p>
                    </div>

                    <div className="px-4 py-2">
                      <p className="mb-2 text-xs font-medium uppercase text-gray-500">Connected Accounts</p>

                      {/* GitHub status */}
                      <div className="flex items-center justify-between py-1">
                        <div className="flex items-center gap-2">
                          <GitHubIcon className="h-4 w-4" />
                          <span className="text-sm">GitHub</span>
                        </div>
                        {connectedProviders.github ? (
                          <button
                            onClick={() => {
                              disconnectGitHub();
                              setIsMenuOpen(false);
                            }}
                            className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                          >
                            Disconnect
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              linkWithGitHub();
                              setIsMenuOpen(false);
                            }}
                            className="rounded bg-gray-900 px-2 py-1 text-xs text-white hover:bg-gray-800"
                          >
                            Connect
                          </button>
                        )}
                      </div>

                      {/* GitLab status */}
                      <div className="flex items-center justify-between py-1">
                        <div className="flex items-center gap-2">
                          <GitLabIcon className="h-4 w-4 text-[#FC6D26]" />
                          <span className="text-sm">GitLab</span>
                        </div>
                        {connectedProviders.gitlab ? (
                          <button
                            onClick={() => {
                              disconnectGitLab();
                              setIsMenuOpen(false);
                            }}
                            className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                          >
                            Disconnect
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              linkWithGitLab();
                              setIsMenuOpen(false);
                            }}
                            className="rounded bg-[#FC6D26] px-2 py-1 text-xs text-white hover:bg-[#E24329]"
                          >
                            Connect
                          </button>
                        )}
                      </div>

                      {/* Self-hosted GitLab instances */}
                      {selfHostedGitLabInstances.length > 0 ? (
                        selfHostedGitLabInstances.map((instance) => (
                          <div key={instance._id} className="flex items-center justify-between py-1">
                            <div className="flex items-center gap-2">
                              <GitLabIcon className="h-4 w-4 text-[#554488]" />
                              <span className="text-sm truncate max-w-[120px]" title={instance.name}>
                                {instance.name}
                              </span>
                            </div>
                            <span className="flex items-center gap-1 text-xs text-green-600">
                              <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                              Configured
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="flex items-center justify-between py-1">
                          <div className="flex items-center gap-2">
                            <GitLabIcon className="h-4 w-4 text-[#554488]" />
                            <span className="text-sm">Self-Hosted GitLab</span>
                          </div>
                          <span className="text-xs text-gray-400">
                            Not configured
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="border-t px-4 py-2">
                      <button
                        onClick={() => {
                          signOut();
                          setIsMenuOpen(false);
                        }}
                        className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                      >
                        Sign out
                      </button>
                    </div>
                  </div>
                )}
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
