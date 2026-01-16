import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";
import { useUser } from "../hooks/useUser";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const { user, isLoading, isAuthenticated, signIn, signOut } = useUser();

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
              <div className="flex items-center space-x-3">
                {user?.image && (
                  <img
                    src={user.image}
                    alt={user.name || "User"}
                    className="h-8 w-8 rounded-full"
                  />
                )}
                <button
                  onClick={() => signOut()}
                  className="text-sm font-medium text-gray-600 transition-colors hover:text-gray-900"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <button
                onClick={() => signIn()}
                className="inline-flex items-center rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                <svg
                  className="mr-2 h-4 w-4"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                Sign in with GitHub
              </button>
            )}
          </nav>
        </div>
      </header>
      <main className="container mx-auto px-4 py-8">
        {isAuthenticated ? (
          <Outlet />
        ) : (
          <div className="flex flex-col items-center justify-center py-20">
            <h1 className="mb-4 text-3xl font-bold text-gray-900">
              Welcome to PaperShelf
            </h1>
            <p className="mb-8 text-center text-gray-600">
              Preview and share your LaTeX papers from GitHub repositories.
              <br />
              Sign in with GitHub to get started.
            </p>
            <button
              onClick={() => signIn()}
              className="inline-flex items-center rounded-md bg-gray-900 px-6 py-3 text-base font-medium text-white hover:bg-gray-800"
            >
              <svg
                className="mr-2 h-5 w-5"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              Sign in with GitHub
            </button>
          </div>
        )}
      </main>
      <TanStackRouterDevtools position="bottom-right" />
    </div>
  );
}
