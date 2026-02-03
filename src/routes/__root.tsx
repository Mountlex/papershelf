import { createRootRouteWithContext, Link, Outlet, Scripts, HeadContent, useRouterState } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { QueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import "../index.css";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  useUser,
  checkPendingLink,
  clearPendingLink,
  isLinkInProgress,
  getLinkReturnTo,
  clearLinkReturnTo,
} from "../hooks/useUser";
import { useTheme } from "../hooks/useTheme";
import { EmailPasswordForm } from "../components/auth/EmailPasswordForm";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { GitHubIcon, GitLabIcon, UserIcon, SignOutIcon, SunIcon, MoonIcon, SystemIcon } from "../components/icons";
import { PaperCardSkeletonGrid } from "../components/ui";

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
  const { theme, cycleTheme } = useTheme();
  const routerState = useRouterState();
  const isGalleryRoute = routerState.location.pathname === "/";
  const isRepositoriesRoute = routerState.location.pathname === "/repositories";
  const isReconnectGitLabRoute = routerState.location.pathname === "/reconnect/gitlab";
  const isMobileAuthRoute = routerState.location.pathname === "/mobile-auth";
  const linkProviderToAccount = useMutation(api.users.linkProviderToAccount);
  const [isLinking, setIsLinking] = useState(() => isLinkInProgress());
  const [linkError, setLinkError] = useState<string | null>(null);
  const [showRecovery, setShowRecovery] = useState(false);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const hasPendingLink = isLinkInProgress() || Boolean(checkPendingLink());
  const shouldShowLinking = isLinking && !isReconnectGitLabRoute && !isMobileAuthRoute;

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
          // Small delay to ensure session is committed, then redirect
          await new Promise((resolve) => setTimeout(resolve, 500));
          const returnTo = getLinkReturnTo();
          clearLinkReturnTo();
          window.location.assign(returnTo || window.location.href);
        } else {
          // Same user or other non-error case
          setIsLinking(false);
        }
      } catch (error) {
        console.error("Failed to link accounts:", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        setLinkError(errorMessage);
        clearPendingLink();
        clearLinkReturnTo();
        setIsLinking(false);
        // Show recovery UI for critical errors
        if (errorMessage.includes("expired") || errorMessage.includes("Invalid")) {
          previousFocusRef.current = document.activeElement as HTMLElement;
          setShowRecovery(true);
        }
      }
    }

    if (isAuthenticated && user && !isLoading) {
      handleLinkCompletion();
    }
  }, [isAuthenticated, user, isLoading, linkProviderToAccount]);

  // Timeout for linking state
  useEffect(() => {
    if (!isLinking) return;

    const timeout = setTimeout(() => {
      setIsLinking(false);
      setLinkError("Account linking timed out. Please try again.");
      clearPendingLink();
      clearLinkReturnTo();
    }, 30000);

    return () => clearTimeout(timeout);
  }, [isLinking]);

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
                    {theme === "system" ? (
                      <SystemIcon className="h-5 w-5" aria-hidden="true" />
                    ) : theme === "dark" ? (
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
                    {theme === "system" ? (
                      <SystemIcon className="h-5 w-5" aria-hidden="true" />
                    ) : theme === "dark" ? (
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
        <main className="container mx-auto min-h-[calc(100vh-8rem)] px-4 py-8 md:px-6">
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
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
              role="dialog"
              aria-modal="true"
              aria-labelledby="recovery-modal-title"
              aria-describedby="recovery-modal-description"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setShowRecovery(false);
                  setLinkError(null);
                }
              }}
            >
              <div className="mx-4 max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900">
                <h3 id="recovery-modal-title" className="text-lg font-normal text-gray-900 dark:text-gray-100">Account Linking Failed</h3>
                <div id="recovery-modal-description">
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                    The account linking session has expired or was invalid. This can happen if you took
                    more than 30 seconds to complete the OAuth flow, or if you navigated away.
                  </p>
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                    You can sign out and try again, or dismiss this message and continue using your
                    current account without linking.
                  </p>
                </div>
                <div className="mt-4 flex gap-3">
                  <button
                    autoFocus
                    onClick={() => {
                      setShowRecovery(false);
                      setLinkError(null);
                      previousFocusRef.current?.focus();
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
                      previousFocusRef.current?.focus();
                    }}
                    className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm font-normal text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    Dismiss & Continue
                  </button>
                </div>
              </div>
            </div>
          )}
          {shouldShowLinking ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-900 dark:border-gray-700 dark:border-t-gray-100" />
              <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">Linking accounts...</p>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">This should only take a few seconds. If a popup opened, please complete sign-in there.</p>
            </div>
          ) : isLoading ? (
            isGalleryRoute ? (
              <GalleryLoading />
            ) : isRepositoriesRoute ? (
              <RepositoriesLoading />
            ) : (
              <div className="flex items-center justify-center py-20">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-900 dark:border-gray-700 dark:border-t-gray-100" />
              </div>
            )
          ) : isAuthenticated || isReconnectGitLabRoute || isMobileAuthRoute ? (
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          ) : (
            <div className="flex flex-col items-center justify-center py-20">
              {hasPendingLink && (
                <div className="mb-6 w-full max-w-sm rounded-lg border border-amber-200 bg-amber-50 p-4 text-center dark:border-amber-800 dark:bg-amber-950">
                  <p className="text-sm font-normal text-amber-900 dark:text-amber-100">
                    Reconnect in progress
                  </p>
                  <p className="mt-1 text-sm text-amber-700 dark:text-amber-200">
                    Continue with GitLab to finish reconnecting your account.
                  </p>
                  <Link
                    to="/reconnect/gitlab"
                    className="mt-3 inline-flex items-center justify-center rounded-md bg-[#FC6D26] px-4 py-2 text-sm font-normal text-white hover:bg-[#E24329]"
                  >
                    Continue with GitLab
                  </Link>
                </div>
              )}
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
        <footer className="border-t border-gray-100 bg-white py-6 dark:border-gray-800 dark:bg-gray-900">
          <div className="container mx-auto flex flex-col items-center justify-between gap-4 px-4 text-sm text-gray-500 dark:text-gray-400 sm:flex-row md:px-6">
            <p>&copy; {new Date().getFullYear()} Carrel. All rights reserved.</p>
            <nav className="flex gap-6">
              <Link to="/privacy" className="hover:text-gray-900 dark:hover:text-gray-100">
                Privacy Policy
              </Link>
            </nav>
          </div>
        </footer>
        {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />}
      </div>
    </RootDocument>
  );
}

function GalleryLoading() {
  return (
    <div>
      <div className="mb-6 md:mb-8">
        <div className="flex items-center justify-between">
          <div className="h-7 w-40 rounded-md bg-gray-200 dark:bg-gray-800" />
          <div className="flex items-center gap-2">
            <div className="hidden h-9 w-56 rounded-md bg-gray-200 dark:bg-gray-800 md:block" />
            <div className="hidden h-9 w-28 rounded-md bg-gray-200 dark:bg-gray-800 md:block" />
            <div className="hidden h-9 w-28 rounded-md bg-gray-200 dark:bg-gray-800 md:block" />
            <div className="hidden h-9 w-32 rounded-md bg-gray-200 dark:bg-gray-800 md:block" />
          </div>
        </div>
      </div>
      <PaperCardSkeletonGrid count={8} />
    </div>
  );
}

function RepositoriesLoading() {
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 md:mb-8">
        <div className="h-7 w-36 rounded-md bg-gray-200 dark:bg-gray-800" />
        <div className="flex items-center gap-2">
          <div className="h-9 w-28 rounded-md bg-gray-200 dark:bg-gray-800" />
          <div className="h-9 w-36 rounded-md bg-gray-200 dark:bg-gray-800" />
        </div>
      </div>
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={`repo-skeleton-${index}`}
            className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-8">
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <div className="h-11 w-11 rounded-lg bg-gray-200 dark:bg-gray-800" />
                <div className="min-w-0 flex-1">
                  <div className="h-5 w-40 rounded-md bg-gray-200 dark:bg-gray-800" />
                  <div className="mt-2 h-4 w-64 rounded-md bg-gray-100 dark:bg-gray-850" />
                </div>
              </div>
              <div className="hidden shrink-0 items-center gap-6 lg:flex">
                <div className="flex w-14 flex-col items-center">
                  <div className="h-6 w-10 rounded-md bg-gray-200 dark:bg-gray-800" />
                  <div className="mt-2 h-3 w-12 rounded-md bg-gray-100 dark:bg-gray-850" />
                </div>
                <div className="flex w-[115px] flex-col items-center">
                  <div className="h-5 w-20 rounded-md bg-gray-200 dark:bg-gray-800" />
                  <div className="mt-2 h-3 w-24 rounded-md bg-gray-100 dark:bg-gray-850" />
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 border-t border-gray-100 pt-4 dark:border-gray-800 lg:border-l lg:border-t-0 lg:py-1 lg:pl-8 lg:pt-0">
                <div className="h-9 w-28 rounded-md bg-gray-200 dark:bg-gray-800" />
                <div className="h-9 w-9 rounded-md bg-gray-200 dark:bg-gray-800" />
                <div className="h-9 w-9 rounded-md bg-gray-200 dark:bg-gray-800" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
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
