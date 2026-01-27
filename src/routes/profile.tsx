import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useAction } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";
import { useUser } from "../hooks/useUser";
import { validatePassword, PASSWORD_REQUIREMENTS } from "../lib/validation";
import { GitHubIcon, GitLabIcon, OverleafIcon } from "../components/icons";
import { OverleafSetupModal } from "../components/repositories/OverleafSetupModal";
import { SelfHostedGitLabSetupModal } from "../components/repositories/SelfHostedGitLabSetupModal";
import { ConfirmDialog } from "../components/ConfirmDialog";

export const Route = createFileRoute("/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const navigate = useNavigate();
  const { signOut } = useAuthActions();
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
  const saveOverleafCredentials = useMutation(api.users.saveOverleafCredentials);
  const addSelfHostedGitLabInstance = useAction(api.git.addSelfHostedGitLabInstanceWithTest);
  const deleteSelfHostedGitLabInstance = useMutation(api.users.deleteSelfHostedGitLabInstance);
  const deleteAccountMutation = useMutation(api.users.deleteAccount);

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
  const [codeSentSuccess, setCodeSentSuccess] = useState(false);

  // Overleaf setup modal state
  const [showOverleafSetup, setShowOverleafSetup] = useState(false);

  // Self-hosted GitLab setup modal state
  const [showSelfHostedGitLabSetup, setShowSelfHostedGitLabSetup] = useState(false);

  // Delete account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Delete GitLab instance state
  const [instanceToDelete, setInstanceToDelete] = useState<{ id: string; name: string } | null>(null);

  // Disconnect provider confirmation states
  const [showDisconnectGitHub, setShowDisconnectGitHub] = useState(false);
  const [showDisconnectGitLab, setShowDisconnectGitLab] = useState(false);
  const [showDisconnectOverleaf, setShowDisconnectOverleaf] = useState(false);

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
    setCodeSentSuccess(false);
    try {
      await requestPasswordChangeCode();
      setPasswordMode("enterCode");
      setCodeSentSuccess(true);
      setTimeout(() => setCodeSentSuccess(false), 5000);
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

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccountMutation();
      // Sign out and redirect to home after deletion
      await signOut();
      navigate({ to: "/" });
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete account");
      setIsDeleting(false);
    }
  };

  const handleDeleteGitLabInstance = async () => {
    if (!instanceToDelete) return;
    try {
      await deleteSelfHostedGitLabInstance({ id: instanceToDelete.id as Parameters<typeof deleteSelfHostedGitLabInstance>[0]["id"] });
      setInstanceToDelete(null);
    } catch (error) {
      console.error("Failed to delete GitLab instance:", error);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-8 text-2xl font-normal text-gray-900 dark:text-gray-100">Profile</h1>

      {/* Account Settings */}
      <div className="mb-8 rounded-lg border bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h3 className="mb-6 text-lg font-normal text-gray-900 dark:text-gray-100">Account Settings</h3>

        {/* Name Field */}
        <div className="mb-6">
          <label className="block text-sm font-normal text-gray-700 mb-2 dark:text-gray-300">Name</label>
          {isEditingName ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-gray-100"
                placeholder="Your name"
              />
              <button
                onClick={handleSaveName}
                disabled={nameLoading}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-normal text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
              >
                {nameLoading ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => {
                  setIsEditingName(false);
                  setName(user?.name || "");
                  setNameError(null);
                }}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-normal text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-gray-900 dark:text-gray-100">{user?.name || "Not set"}</span>
              <button
                onClick={() => {
                  setName(user?.name || "");
                  setIsEditingName(true);
                }}
                className="text-sm text-gray-600 hover:text-gray-900 underline dark:text-gray-400 dark:hover:text-gray-100"
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
          <label className="block text-sm font-normal text-gray-700 mb-2 dark:text-gray-300">Email</label>
          <div className="flex items-center justify-between">
            <span className="text-gray-900 dark:text-gray-100">{user?.email}</span>
          </div>
        </div>

        {/* Password Field */}
        <div>
          <label className="block text-sm font-normal text-gray-700 mb-2 dark:text-gray-300">Password</label>
          {passwordMode === "idle" && (
            <div className="flex items-center justify-between">
              <span className="text-gray-500 dark:text-gray-400">••••••••</span>
              <button
                onClick={handleSendPasswordCode}
                disabled={passwordLoading}
                className="text-sm text-gray-600 hover:text-gray-900 underline dark:text-gray-400 dark:hover:text-gray-100"
              >
                {passwordLoading ? "Sending code..." : "Change password"}
              </button>
            </div>
          )}
          {passwordMode === "enterCode" && (
            <form onSubmit={handleChangePassword} className="space-y-3">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                We sent a verification code to <strong>{user?.email}</strong>
              </p>
              {codeSentSuccess && (
                <p className="text-sm text-green-600 dark:text-green-400">
                  Verification code sent successfully. Please check your email.
                </p>
              )}
              <div>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono tracking-widest focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  placeholder="Enter 6-digit code"
                />
              </div>
              <div>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  placeholder={`New password (${PASSWORD_REQUIREMENTS.toLowerCase()})`}
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={passwordLoading}
                  className="rounded-md bg-gray-900 px-4 py-2 text-sm font-normal text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
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
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-normal text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
              </div>
              <button
                type="button"
                onClick={handleSendPasswordCode}
                disabled={passwordLoading}
                className="text-sm text-gray-600 hover:text-gray-900 underline dark:text-gray-400 dark:hover:text-gray-100"
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
      <div className="mb-8 rounded-lg border bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h3 className="mb-4 text-lg font-normal text-gray-900 dark:text-gray-100">
          Connected Accounts
        </h3>
        <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
          Connect your Git provider accounts to access repositories and sync papers.
        </p>

        <div className="space-y-4">
          {/* GitHub */}
          <div className="flex items-center justify-between rounded-lg border p-4 dark:border-gray-800">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-900 dark:bg-gray-100">
                <GitHubIcon className="h-5 w-5 text-white dark:text-gray-900" />
              </div>
              <div>
                <p className="font-normal text-gray-900 dark:text-gray-100">GitHub</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {connectedProviders.github
                    ? "Connected"
                    : "Access your GitHub repositories"}
                </p>
              </div>
            </div>
            {connectedProviders.github ? (
              <button
                onClick={() => setShowDisconnectGitHub(true)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-normal text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={linkWithGitHub}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-normal text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
              >
                Connect
              </button>
            )}
          </div>

          {/* GitLab */}
          <div className="flex items-center justify-between rounded-lg border p-4 dark:border-gray-800">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FC6D26]">
                <GitLabIcon className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="font-normal text-gray-900 dark:text-gray-100">GitLab</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {connectedProviders.gitlab
                    ? "Connected"
                    : "Access your GitLab repositories"}
                </p>
              </div>
            </div>
            {connectedProviders.gitlab ? (
              <button
                onClick={() => setShowDisconnectGitLab(true)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-normal text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={linkWithGitLab}
                className="rounded-md bg-[#FC6D26] px-4 py-2 text-sm font-normal text-white hover:bg-[#E24329]"
              >
                Connect
              </button>
            )}
          </div>

          {/* Overleaf */}
          <div className="flex items-center justify-between rounded-lg border p-4 dark:border-gray-800">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#47A141]">
                <OverleafIcon className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="font-normal text-gray-900 dark:text-gray-100">Overleaf</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {connectedProviders.overleaf
                    ? "Connected"
                    : "Sync your Overleaf projects"}
                </p>
              </div>
            </div>
            {connectedProviders.overleaf ? (
              <button
                onClick={() => setShowDisconnectOverleaf(true)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-normal text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={() => setShowOverleafSetup(true)}
                className="rounded-md bg-[#47A141] px-4 py-2 text-sm font-normal text-white hover:bg-[#3d8a37]"
              >
                Configure
              </button>
            )}
          </div>

          {/* Self-hosted GitLab instances */}
          {selfHostedGitLabInstances.length > 0 && (
            <>
              {selfHostedGitLabInstances.map((instance: { _id: string; name: string; url: string }) => (
                <div
                  key={instance._id}
                  className="flex items-center justify-between rounded-lg border p-4 dark:border-gray-800"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#554488]">
                      <GitLabIcon className="h-5 w-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-normal text-gray-900 dark:text-gray-100">{instance.name}</p>
                      <p className="truncate text-sm text-gray-500 dark:text-gray-400" title={instance.url}>
                        {instance.url.replace(/^https?:\/\//, "")}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setInstanceToDelete({ id: instance._id, name: instance.name })}
                    className="shrink-0 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-normal text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                    aria-label={`Disconnect ${instance.name}`}
                  >
                    Disconnect
                  </button>
                </div>
              ))}
            </>
          )}

          {/* Add Self-hosted GitLab Instance */}
          <div className="flex items-center justify-between rounded-lg border border-dashed p-4 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
                <GitLabIcon className="h-5 w-5 text-[#554488]" />
              </div>
              <div>
                <p className="font-normal text-gray-900 dark:text-gray-100">
                  {selfHostedGitLabInstances.length > 0 ? "Add Another Instance" : "Self-Hosted GitLab"}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {selfHostedGitLabInstances.length > 0
                    ? "Connect additional GitLab servers"
                    : "Add your own GitLab instance"}
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowSelfHostedGitLabSetup(true)}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-normal text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {selfHostedGitLabInstances.length > 0 ? "Add" : "Configure"}
            </button>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="rounded-lg border border-red-200 bg-white p-6 shadow-sm dark:border-red-900 dark:bg-gray-900">
        <h3 className="mb-4 text-lg font-normal text-red-600 dark:text-red-400">
          Danger Zone
        </h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-normal text-gray-900 dark:text-gray-100">Delete Account</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Permanently delete your account and all associated data. This action cannot be undone.
            </p>
          </div>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="shrink-0 rounded-md border border-red-600 px-4 py-2 text-sm font-normal text-red-600 hover:bg-red-50 dark:border-red-500 dark:text-red-500 dark:hover:bg-red-950"
          >
            Delete Account
          </button>
        </div>
        {deleteError && (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400">{deleteError}</p>
        )}
      </div>

      {/* Delete Account Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Account"
        message="Are you sure you want to permanently delete your account? This will remove all your repositories, papers, and data. This action cannot be undone."
        confirmLabel={isDeleting ? "Deleting..." : "Delete Account"}
        variant="danger"
        onConfirm={handleDeleteAccount}
        onCancel={() => {
          setShowDeleteConfirm(false);
          setDeleteError(null);
        }}
      />

      {/* Disconnect GitHub Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDisconnectGitHub}
        title="Disconnect GitHub"
        message="Are you sure you want to disconnect GitHub? All repositories and papers from GitHub will be permanently deleted."
        confirmLabel="Disconnect"
        variant="danger"
        onConfirm={() => {
          disconnectGitHub();
          setShowDisconnectGitHub(false);
        }}
        onCancel={() => setShowDisconnectGitHub(false)}
      />

      {/* Disconnect GitLab Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDisconnectGitLab}
        title="Disconnect GitLab"
        message="Are you sure you want to disconnect GitLab? All repositories and papers from GitLab will be permanently deleted."
        confirmLabel="Disconnect"
        variant="danger"
        onConfirm={() => {
          disconnectGitLab();
          setShowDisconnectGitLab(false);
        }}
        onCancel={() => setShowDisconnectGitLab(false)}
      />

      {/* Disconnect Overleaf Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDisconnectOverleaf}
        title="Disconnect Overleaf"
        message="Are you sure you want to disconnect Overleaf? All repositories and papers from Overleaf will be permanently deleted."
        confirmLabel="Disconnect"
        variant="danger"
        onConfirm={() => {
          disconnectOverleaf();
          setShowDisconnectOverleaf(false);
        }}
        onCancel={() => setShowDisconnectOverleaf(false)}
      />

      {/* Disconnect GitLab Instance Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!instanceToDelete}
        title="Disconnect GitLab Instance"
        message={`Are you sure you want to disconnect "${instanceToDelete?.name}"? All repositories and papers from this instance will be permanently deleted.`}
        confirmLabel="Disconnect"
        variant="danger"
        onConfirm={handleDeleteGitLabInstance}
        onCancel={() => setInstanceToDelete(null)}
      />

      {/* Overleaf Setup Modal */}
      {showOverleafSetup && (
        <OverleafSetupModal
          onClose={() => setShowOverleafSetup(false)}
          onSave={async (email, token) => {
            await saveOverleafCredentials({ email, token });
          }}
        />
      )}

      {/* Self-hosted GitLab Setup Modal */}
      {showSelfHostedGitLabSetup && (
        <SelfHostedGitLabSetupModal
          onClose={() => setShowSelfHostedGitLabSetup(false)}
          onSave={async (name, url, token) => {
            await addSelfHostedGitLabInstance({ name, url, token });
          }}
        />
      )}
    </div>
  );
}
