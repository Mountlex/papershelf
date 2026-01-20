import { useState } from "react";

interface OverleafSetupModalProps {
  onClose: () => void;
  onSave: (email: string, token: string) => Promise<void>;
}

export function OverleafSetupModal({ onClose, onSave }: OverleafSetupModalProps) {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!email.trim() || !token.trim()) {
      setError("Please enter both email and token");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await onSave(email.trim(), token.trim());
      onClose();
    } catch (err) {
      console.error("Failed to save Overleaf credentials:", err);
      const message = err instanceof Error ? err.message : "";
      if (message.includes("401") || message.includes("auth") || message.includes("unauthorized")) {
        setError("Invalid email or token. Please verify your Overleaf credentials are correct.");
      } else if (message.includes("network") || message.includes("fetch")) {
        setError("Unable to connect. Please check your internet connection and try again.");
      } else {
        setError("Failed to save credentials. Please verify your email and token are correct.");
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-normal text-gray-900 dark:text-gray-100">Connect Overleaf Account</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          To access your Overleaf projects, you'll need your Overleaf email and a Git token.
          You can generate a Git token in your{" "}
          <a
            href="https://www.overleaf.com/user/settings"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            Overleaf Account Settings ↗
          </a>{" "}
          under "Git Integration".
        </p>
        <p className="mb-4 text-xs text-gray-500 dark:text-gray-500">
          The Git token is a password-like credential that allows Carrel to clone your projects via Git.
        </p>

        <div className="space-y-4">
          <div>
            <label htmlFor="overleaf-email" className="block text-sm font-normal text-gray-700 dark:text-gray-300">
              Overleaf Email
            </label>
            <input
              id="overleaf-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
            />
          </div>

          <div>
            <label htmlFor="overleaf-token" className="block text-sm font-normal text-gray-700 dark:text-gray-300">
              Git Token
            </label>
            <input
              id="overleaf-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Your Overleaf Git token"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
            />
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-normal text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || !email.trim() || !token.trim()}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-normal text-white hover:bg-green-700 disabled:opacity-50"
            >
              {isSaving ? "Saving..." : "Save Credentials"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
