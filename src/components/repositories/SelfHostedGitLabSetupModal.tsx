import { useState } from "react";

interface SelfHostedGitLabSetupModalProps {
  onClose: () => void;
  onSave: (name: string, url: string, token: string) => Promise<void>;
}

export function SelfHostedGitLabSetupModal({ onClose, onSave }: SelfHostedGitLabSetupModalProps) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Please enter a name for this instance");
      return;
    }
    if (!url.trim() || !token.trim()) {
      setError("Please enter both instance URL and token");
      return;
    }

    // Validate URL format
    try {
      new URL(url.trim());
    } catch {
      setError("Please enter a valid URL (e.g., https://gitlab.mycompany.com)");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await onSave(name.trim(), url.trim(), token.trim());
      onClose();
    } catch (err) {
      console.error("Failed to add self-hosted GitLab instance:", err);
      const message = err instanceof Error ? err.message : "";
      if (message.includes("401") || message.includes("403") || message.includes("auth")) {
        setError(
          "Authentication failed. Please verify your token has the required scopes: read_api and read_repository."
        );
      } else if (message.includes("network") || message.includes("fetch") || message.includes("ENOTFOUND")) {
        setError(
          "Unable to reach the GitLab instance. Please check the URL and your network connection."
        );
      } else if (message.includes("already") || message.includes("exists")) {
        setError("This GitLab instance has already been added.");
      } else {
        setError(
          "Failed to add instance. Please verify the URL and token are correct."
        );
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-normal text-gray-900 dark:text-gray-100">Add Self-Hosted GitLab Instance</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          To access your self-hosted GitLab repositories, you'll need your instance URL and a Personal Access Token (PAT).
          You can create a PAT in your GitLab{" "}
          <a
            href="https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            User Settings → Access Tokens ↗
          </a>.
        </p>
        <p className="mb-4 text-xs text-gray-500 dark:text-gray-500">
          Required scopes: <code className="rounded bg-gray-100 px-1 dark:bg-gray-700">read_api</code> and <code className="rounded bg-gray-100 px-1 dark:bg-gray-700">read_repository</code>.
          The token allows Carrel to list and clone your repositories.
        </p>

        <div className="space-y-4">
          <div>
            <label htmlFor="gitlab-name" className="block text-sm font-normal text-gray-700 dark:text-gray-300">
              Instance Name
            </label>
            <input
              id="gitlab-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Work GitLab, University GitLab"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
            />
          </div>

          <div>
            <label htmlFor="gitlab-url" className="block text-sm font-normal text-gray-700 dark:text-gray-300">
              GitLab Instance URL
            </label>
            <input
              id="gitlab-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://gitlab.mycompany.com"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
            />
          </div>

          <div>
            <label htmlFor="gitlab-token" className="block text-sm font-normal text-gray-700 dark:text-gray-300">
              Personal Access Token
            </label>
            <input
              id="gitlab-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="glpat-xxxxxxxxxxxxxxxxxxxx"
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
              disabled={isSaving || !name.trim() || !url.trim() || !token.trim()}
              className="rounded-md bg-[#554488] px-4 py-2 text-sm font-normal text-white hover:bg-[#443377] disabled:opacity-50"
            >
              {isSaving ? "Adding..." : "Add Instance"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
