import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useUser } from "../hooks/useUser";
import { validatePassword, PASSWORD_REQUIREMENTS } from "../lib/validation";
import { GitHubIcon, GitLabIcon, OverleafIcon } from "../components/icons";

export const Route = createFileRoute("/profile")({
  component: ProfilePage,
});

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
  const [passwordMode, setPasswordMode] = useState<"idle" | "enterCode">("idle");
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
        setPasswordError(
          "Password change is only available for accounts created with email and password. " +
          "Your account was created using GitHub or GitLab sign-in."
        );
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
          {nameSuccess && <p className="mt-2 text-sm text-green-600">Name updated to "{user?.name}"</p>}
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
                  placeholder={`New password (${PASSWORD_REQUIREMENTS.toLowerCase()})`}
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
          {passwordSuccess && (
            <p className="mt-2 text-sm text-green-600">
              Password updated successfully. You've been signed out of other devices for security.
            </p>
          )}
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
