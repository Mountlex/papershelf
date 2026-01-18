import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useUser } from "../hooks/useUser";

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

// Overleaf icon component
function OverleafIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M22.3515.7484C19.1109-.5101 7.365-.982 7.3452 6.0266c-3.4272 2.194-5.6967 5.768-5.6967 9.598a8.373 8.373 0 0 0 13.1225 6.898 8.373 8.373 0 0 0-1.7668-14.7194c-.6062-.2339-1.9234-.6481-2.9753-.559-1.5007.9544-3.3308 2.9155-4.1949 4.8693 2.5894-3.082 7.5046-2.425 9.1937 1.2287 1.6892 3.6538-.9944 7.8237-5.0198 7.7998a5.4995 5.4995 0 0 1-4.1949-1.9328c-1.485-1.7483-1.8678-3.6444-1.5615-5.4975 1.057-6.4947 8.759-10.1894 14.486-11.6094-1.8677.989-5.2373 2.6134-7.5948 4.3837C18.015 9.1382 19.1308 3.345 22.3515.7484z" />
    </svg>
  );
}

export const Route = createFileRoute("/profile")({
  component: ProfilePage,
});

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

function ProfilePage() {
  const {
    user,
    linkWithGitHub,
    linkWithGitLab,
    disconnectGitHub,
    disconnectGitLab,
    disconnectOverleaf,
    connectedProviders,
    selfHostedGitLabInstances,
  } = useUser();

  const updateProfile = useMutation(api.users.updateProfile);
  const requestPasswordChangeCode = useAction(api.passwordActions.requestPasswordChangeCode);
  const changePassword = useAction(api.passwordActions.changePassword);

  // Name editing state
  const [isEditingName, setIsEditingName] = useState(false);
  const [name, setName] = useState(user?.name || "");
  const [nameLoading, setNameLoading] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSuccess, setNameSuccess] = useState(false);

  // Password change state
  const [passwordMode, setPasswordMode] = useState<"idle" | "sendCode" | "enterCode">("idle");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  const handleSaveName = async () => {
    setNameLoading(true);
    setNameError(null);
    setNameSuccess(false);
    try {
      await updateProfile({ name: name.trim() });
      setIsEditingName(false);
      setNameSuccess(true);
      setTimeout(() => setNameSuccess(false), 3000);
    } catch (error) {
      setNameError(error instanceof Error ? error.message : "Failed to update name");
    } finally {
      setNameLoading(false);
    }
  };

  const handleSendPasswordCode = async () => {
    setPasswordLoading(true);
    setPasswordError(null);
    try {
      await requestPasswordChangeCode();
      setPasswordMode("enterCode");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send code";
      if (message.includes("No password account")) {
        setPasswordError("Password change is only available for email/password accounts.");
      } else {
        setPasswordError(message);
      }
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    const passwordErr = validatePassword(newPassword);
    if (passwordErr) {
      setPasswordError(passwordErr);
      return;
    }

    setPasswordLoading(true);
    setPasswordError(null);
    try {
      await changePassword({ code, newPassword });
      setPasswordMode("idle");
      setCode("");
      setNewPassword("");
      setPasswordSuccess(true);
      setTimeout(() => setPasswordSuccess(false), 3000);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to change password";
      if (message.includes("expired") || message.includes("No valid code")) {
        setPasswordError("Code has expired. Please request a new one.");
      } else if (message.includes("Invalid")) {
        setPasswordError("Invalid verification code");
      } else {
        setPasswordError(message);
      }
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-8 text-2xl font-bold text-gray-900">Profile</h1>

      {/* Account Settings */}
      <div className="mb-8 rounded-lg border bg-white p-6 shadow-sm">
        <h3 className="mb-6 text-lg font-semibold text-gray-900">Account Settings</h3>

        {/* Name Field */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Name</label>
          {isEditingName ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                placeholder="Your name"
              />
              <button
                onClick={handleSaveName}
                disabled={nameLoading}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {nameLoading ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => {
                  setIsEditingName(false);
                  setName(user?.name || "");
                  setNameError(null);
                }}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-gray-900">{user?.name || "Not set"}</span>
              <button
                onClick={() => {
                  setName(user?.name || "");
                  setIsEditingName(true);
                }}
                className="text-sm text-gray-600 hover:text-gray-900 underline"
              >
                Edit
              </button>
            </div>
          )}
          {nameError && <p className="mt-2 text-sm text-red-600">{nameError}</p>}
          {nameSuccess && <p className="mt-2 text-sm text-green-600">Name updated successfully</p>}
        </div>

        {/* Email Field (read-only) */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
          <div className="flex items-center justify-between">
            <span className="text-gray-900">{user?.email}</span>
          </div>
        </div>

        {/* Password Field */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
          {passwordMode === "idle" && (
            <div className="flex items-center justify-between">
              <span className="text-gray-500">••••••••</span>
              <button
                onClick={handleSendPasswordCode}
                disabled={passwordLoading}
                className="text-sm text-gray-600 hover:text-gray-900 underline"
              >
                {passwordLoading ? "Sending code..." : "Change password"}
              </button>
            </div>
          )}
          {passwordMode === "enterCode" && (
            <form onSubmit={handleChangePassword} className="space-y-3">
              <p className="text-sm text-gray-600">
                We sent a verification code to <strong>{user?.email}</strong>
              </p>
              <div>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono tracking-widest focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                  placeholder="Enter 6-digit code"
                />
              </div>
              <div>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                  placeholder="New password (min 8 chars, 1 uppercase, 1 number)"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={passwordLoading}
                  className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {passwordLoading ? "Updating..." : "Update password"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPasswordMode("idle");
                    setCode("");
                    setNewPassword("");
                    setPasswordError(null);
                  }}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
              <button
                type="button"
                onClick={handleSendPasswordCode}
                disabled={passwordLoading}
                className="text-sm text-gray-600 hover:text-gray-900 underline"
              >
                Resend code
              </button>
            </form>
          )}
          {passwordError && <p className="mt-2 text-sm text-red-600">{passwordError}</p>}
          {passwordSuccess && <p className="mt-2 text-sm text-green-600">Password updated successfully</p>}
        </div>
      </div>

      {/* Connected Accounts */}
      <div className="mb-8 rounded-lg border bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold text-gray-900">
          Connected Accounts
        </h3>
        <p className="mb-6 text-sm text-gray-500">
          Connect your Git provider accounts to access repositories and sync papers.
        </p>

        <div className="space-y-4">
          {/* GitHub */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-900">
                <GitHubIcon className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="font-medium text-gray-900">GitHub</p>
                <p className="text-sm text-gray-500">
                  {connectedProviders.github
                    ? "Connected"
                    : "Access your GitHub repositories"}
                </p>
              </div>
            </div>
            {connectedProviders.github ? (
              <button
                onClick={disconnectGitHub}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={linkWithGitHub}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                Connect
              </button>
            )}
          </div>

          {/* GitLab */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FC6D26]">
                <GitLabIcon className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="font-medium text-gray-900">GitLab</p>
                <p className="text-sm text-gray-500">
                  {connectedProviders.gitlab
                    ? "Connected"
                    : "Access your GitLab repositories"}
                </p>
              </div>
            </div>
            {connectedProviders.gitlab ? (
              <button
                onClick={disconnectGitLab}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={linkWithGitLab}
                className="rounded-md bg-[#FC6D26] px-4 py-2 text-sm font-medium text-white hover:bg-[#E24329]"
              >
                Connect
              </button>
            )}
          </div>

          {/* Overleaf */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#47A141]">
                <OverleafIcon className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="font-medium text-gray-900">Overleaf</p>
                <p className="text-sm text-gray-500">
                  {connectedProviders.overleaf
                    ? "Connected"
                    : "Sync your Overleaf projects"}
                </p>
              </div>
            </div>
            {connectedProviders.overleaf ? (
              <button
                onClick={disconnectOverleaf}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Disconnect
              </button>
            ) : (
              <Link
                to="/repositories"
                className="rounded-md bg-[#47A141] px-4 py-2 text-sm font-medium text-white hover:bg-[#3d8a37]"
              >
                Configure
              </Link>
            )}
          </div>

          {/* Self-hosted GitLab instances */}
          {selfHostedGitLabInstances.length > 0 ? (
            selfHostedGitLabInstances.map((instance: { _id: string; name: string }) => (
              <div
                key={instance._id}
                className="flex items-center justify-between rounded-lg border p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#554488]">
                    <GitLabIcon className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{instance.name}</p>
                    <p className="text-sm text-gray-500">Self-hosted GitLab</p>
                  </div>
                </div>
                <span className="flex items-center gap-1 text-sm text-green-600">
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Configured
                </span>
              </div>
            ))
          ) : (
            <div className="flex items-center justify-between rounded-lg border border-dashed p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                  <GitLabIcon className="h-5 w-5 text-[#554488]" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">Self-Hosted GitLab</p>
                  <p className="text-sm text-gray-500">
                    Add your own GitLab instance
                  </p>
                </div>
              </div>
              <Link
                to="/repositories"
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Configure
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
