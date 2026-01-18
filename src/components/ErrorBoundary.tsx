import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Error caught by boundary:", error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const errorMessage = this.state.error?.message || "";
      const isAuthError = errorMessage.toLowerCase().includes("auth") ||
                          errorMessage.toLowerCase().includes("session") ||
                          errorMessage.toLowerCase().includes("token");

      return (
        <div className="flex min-h-[400px] flex-col items-center justify-center px-4">
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center max-w-md">
            <svg
              className="mx-auto h-12 w-12 text-red-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <h2 className="mt-4 text-lg font-semibold text-red-800">
              Something went wrong
            </h2>
            <p className="mt-2 text-sm text-red-600">
              {isAuthError
                ? "There was a problem with your session. Please try again or reload the page."
                : "An unexpected error occurred. Please try again or reload the page."}
            </p>
            <p className="mt-2 text-xs text-red-500">
              {errorMessage && `Details: ${errorMessage}`}
            </p>
            <div className="mt-4 flex justify-center gap-3">
              <button
                onClick={this.handleRetry}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Try Again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
