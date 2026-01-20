import { createRootRouteWithContext, Link, Outlet, Scripts, HeadContent } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { QueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import "../index.css";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useUser, checkPendingLink, clearPendingLink, isLinkInProgress } from "../hooks/useUser";
import { useTheme } from "../hooks/useTheme";
import { EmailPasswordForm } from "../components/auth/EmailPasswordForm";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { GitHubIcon, GitLabIcon, UserIcon, SignOutIcon, SunIcon, MoonIcon } from "../components/icons";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Carrel" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  const {
    user,
    isLoading,
    isAuthenticated,
    signInWithGitHub,
    signInWithGitLab,
    signOut,
  } = useUser();
  const { theme, resolvedTheme, cycleTheme } = useTheme();
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
    <RootDocument>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <header className="sticky top-0 z-50 w-full border-b border-gray-100 bg-white/98 backdrop-blur-sm dark:border-gray-800 dark:bg-gray-900/98">
          <div className="container mx-auto flex h-14 items-center px-4 md:px-6">
            <Link to="/" className="flex items-center space-x-2">
              <span className="font-serif text-3xl font-normal tracking-tight text-gray-900 dark:text-gray-100">Carrel</span>
            </Link>
            <nav className="ml-auto flex items-center space-x-6">
              {isAuthenticated && (
                <>
                  <Link
                    to="/"
                    className="text-base font-normal text-gray-600 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 [&.active]:text-gray-900 dark:[&.active]:text-gray-100"
                  >
                    Gallery
                  </Link>
                  <Link
                    to="/repositories"
                    className="text-base font-normal text-gray-600 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 [&.active]:text-gray-900 dark:[&.active]:text-gray-100"
                  >
                    Repositories
                  </Link>
                </>
              )}
              {isLoading ? (
                <div className="h-8 w-8 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700" />
              ) : isAuthenticated ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={cycleTheme}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                    title={`Theme: ${theme} (click to change)`}
                    aria-label={`Current theme: ${theme}. Click to change theme`}
                  >
                    {resolvedTheme === "dark" ? (
                      <MoonIcon className="h-5 w-5" aria-hidden="true" />
                    ) : (
                      <SunIcon className="h-5 w-5" aria-hidden="true" />
                    )}
                  </button>
                  <Link
                    to="/profile"
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-gray-100 text-gray-600 transition-colors hover:bg-gray-200 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
                    title="Profile"
                    aria-label="Go to profile"
                  >
                    <UserIcon className="h-5 w-5" aria-hidden="true" />
                  </Link>
                  <button
                    onClick={() => signOut()}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                    title="Sign out"
                    aria-label="Sign out of your account"
                  >
                    <SignOutIcon className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={cycleTheme}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                    title={`Theme: ${theme} (click to change)`}
                    aria-label={`Current theme: ${theme}. Click to change theme`}
                  >
                    {resolvedTheme === "dark" ? (
                      <MoonIcon className="h-5 w-5" aria-hidden="true" />
                    ) : (
                      <SunIcon className="h-5 w-5" aria-hidden="true" />
                    )}
                  </button>
                  <button
                    onClick={() => signInWithGitHub()}
                    className="inline-flex items-center rounded-md bg-gray-900 px-3 py-2 text-base font-normal text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
                    title="Sign in with GitHub"
                    aria-label="Sign in with GitHub"
                  >
                    <GitHubIcon className="h-5 w-5" aria-hidden="true" />
                    <span className="ml-2 hidden sm:inline">GitHub</span>
                  </button>
                  <button
                    onClick={() => signInWithGitLab()}
                    className="inline-flex items-center rounded-md bg-[#FC6D26] px-3 py-2 text-base font-normal text-white hover:bg-[#E24329]"
                    title="Sign in with GitLab"
                    aria-label="Sign in with GitLab"
                  >
                    <GitLabIcon className="h-5 w-5" aria-hidden="true" />
                    <span className="ml-2 hidden sm:inline">GitLab</span>
                  </button>
                </div>
              )}
            </nav>
          </div>
        </header>
        <main className="container mx-auto px-4 py-8 md:px-6">
          {linkError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
              <p className="text-sm font-normal text-red-800 dark:text-red-200">Failed to link accounts</p>
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{linkError}</p>
              <button
                onClick={() => setLinkError(null)}
                className="mt-2 text-sm text-red-700 underline dark:text-red-300"
              >
                Dismiss
              </button>
            </div>
          )}
          {/* Recovery modal for failed account linking */}
          {showRecovery && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div className="mx-4 max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900">
                <h3 className="text-lg font-normal text-gray-900 dark:text-gray-100">Account Linking Failed</h3>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                  The account linking session has expired or was invalid. This can happen if you took
                  more than 10 minutes to complete the OAuth flow, or if you navigated away.
                </p>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                  You can sign out and try again, or dismiss this message and continue using your
                  current account without linking.
                </p>
                <div className="mt-4 flex gap-3">
                  <button
                    onClick={() => {
                      setShowRecovery(false);
                      setLinkError(null);
                      signOut();
                    }}
                    className="flex-1 rounded-md bg-gray-900 px-4 py-2 text-sm font-normal text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
                  >
                    Sign Out & Try Again
                  </button>
                  <button
                    onClick={() => {
                      setShowRecovery(false);
                      setLinkError(null);
                    }}
                    className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm font-normal text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    Dismiss & Continue
                  </button>
                </div>
              </div>
            </div>
          )}
          {isLinking ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-900 dark:border-gray-700 dark:border-t-gray-100" />
              <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">Linking accounts...</p>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">This should only take a few seconds. If a popup opened, please complete sign-in there.</p>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-900 dark:border-gray-700 dark:border-t-gray-100" />
            </div>
          ) : isAuthenticated ? (
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          ) : (
            <div className="flex flex-col items-center justify-center py-20">
              <h1 className="mb-4 text-3xl font-normal text-gray-900 dark:text-gray-100">
                Welcome to Carrel
              </h1>
              <p className="mb-8 max-w-md text-center text-gray-600 dark:text-gray-400">
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
                  <div className="w-full border-t border-gray-300 dark:border-gray-700" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="bg-gray-50 px-2 text-gray-500 dark:bg-gray-950 dark:text-gray-400">or continue with</span>
                </div>
              </div>

              {/* OAuth Buttons */}
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  onClick={() => signInWithGitHub()}
                  className="inline-flex items-center justify-center rounded-md bg-gray-900 px-6 py-3 text-base font-normal text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
                >
                  <GitHubIcon className="mr-2 h-5 w-5" />
                  Sign in with GitHub
                </button>
                <button
                  onClick={() => signInWithGitLab()}
                  className="inline-flex items-center justify-center rounded-md bg-[#FC6D26] px-6 py-3 text-base font-normal text-white hover:bg-[#E24329]"
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
    </RootDocument>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('carrel_theme');if(t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark')}catch(e){}})()`,
          }}
        />
      </head>
      <body className="bg-gray-50 dark:bg-gray-950">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
