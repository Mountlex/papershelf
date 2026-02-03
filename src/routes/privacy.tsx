import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPolicy,
});

function PrivacyPolicy() {
  return (
    <div className="mx-auto max-w-3xl py-8">
      <Link
        to="/"
        className="mb-6 inline-flex items-center text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
      >
        <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Gallery
      </Link>

      <h1 className="mb-8 font-serif text-4xl font-normal text-gray-900 dark:text-gray-100">
        Privacy Policy
      </h1>

      <div className="prose prose-gray dark:prose-invert max-w-none">
        <p className="text-sm text-gray-500 dark:text-gray-400">Last updated: February 2, 2026</p>

        <section className="mt-8">
          <h2 className="text-xl font-medium text-gray-900 dark:text-gray-100">Overview</h2>
          <p className="mt-3 text-gray-600 dark:text-gray-400">
            Carrel is a service for previewing and organizing PDF papers from Git repositories.
            This privacy policy explains what data we collect, how we use it, and your rights
            regarding your personal information.
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-medium text-gray-900 dark:text-gray-100">Data We Collect</h2>

          <h3 className="mt-4 text-lg font-medium text-gray-800 dark:text-gray-200">Account Information</h3>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            When you sign in with GitHub or GitLab, we receive and store:
          </p>
          <ul className="mt-2 list-disc pl-6 text-gray-600 dark:text-gray-400">
            <li>Your username and display name</li>
            <li>Your email address</li>
            <li>Your profile picture URL</li>
            <li>OAuth access tokens (encrypted) to access your repositories</li>
          </ul>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            If you sign in with email/password, we store your email address and a securely
            hashed password.
          </p>

          <h3 className="mt-4 text-lg font-medium text-gray-800 dark:text-gray-200">Repository Data</h3>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            When you add a repository to Carrel, we store:
          </p>
          <ul className="mt-2 list-disc pl-6 text-gray-600 dark:text-gray-400">
            <li>Repository URL and name</li>
            <li>File paths you choose to track</li>
            <li>PDF files and thumbnails (cached for performance)</li>
            <li>Paper metadata (titles, annotations you add)</li>
          </ul>

          <h3 className="mt-4 text-lg font-medium text-gray-800 dark:text-gray-200">Usage Data</h3>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            We collect basic usage information to improve the service:
          </p>
          <ul className="mt-2 list-disc pl-6 text-gray-600 dark:text-gray-400">
            <li>When you sign in and use the app</li>
            <li>Errors that occur during operation</li>
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-medium text-gray-900 dark:text-gray-100">How We Use Your Data</h2>
          <ul className="mt-3 list-disc pl-6 text-gray-600 dark:text-gray-400">
            <li>To provide the Carrel service (syncing papers, generating previews)</li>
            <li>To authenticate you and secure your account</li>
            <li>To communicate with you about your account if necessary</li>
            <li>To improve the service and fix bugs</li>
          </ul>
          <p className="mt-3 text-gray-600 dark:text-gray-400">
            We do not sell your personal information to third parties.
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-medium text-gray-900 dark:text-gray-100">Third-Party Services</h2>
          <p className="mt-3 text-gray-600 dark:text-gray-400">
            Carrel uses the following third-party services:
          </p>
          <ul className="mt-2 list-disc pl-6 text-gray-600 dark:text-gray-400">
            <li>
              <strong>Convex</strong> - Database and backend hosting (
              <a href="https://www.convex.dev/privacy" className="text-blue-600 hover:underline dark:text-blue-400">
                privacy policy
              </a>
              )
            </li>
            <li>
              <strong>GitHub</strong> - OAuth authentication and repository access (
              <a href="https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement" className="text-blue-600 hover:underline dark:text-blue-400">
                privacy policy
              </a>
              )
            </li>
            <li>
              <strong>GitLab</strong> - OAuth authentication and repository access (
              <a href="https://about.gitlab.com/privacy/" className="text-blue-600 hover:underline dark:text-blue-400">
                privacy policy
              </a>
              )
            </li>
            <li>
              <strong>Cloudflare</strong> - Website hosting and CDN (
              <a href="https://www.cloudflare.com/privacypolicy/" className="text-blue-600 hover:underline dark:text-blue-400">
                privacy policy
              </a>
              )
            </li>
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-medium text-gray-900 dark:text-gray-100">Data Retention</h2>
          <p className="mt-3 text-gray-600 dark:text-gray-400">
            We retain your data for as long as your account is active. If you delete your account,
            we will delete your personal data within 30 days. Cached PDFs and thumbnails may be
            retained longer for performance purposes but are not linked to your identity after
            account deletion.
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-medium text-gray-900 dark:text-gray-100">Your Rights</h2>
          <p className="mt-3 text-gray-600 dark:text-gray-400">
            You have the right to:
          </p>
          <ul className="mt-2 list-disc pl-6 text-gray-600 dark:text-gray-400">
            <li>Access your personal data</li>
            <li>Correct inaccurate data</li>
            <li>Delete your account and associated data</li>
            <li>Export your data</li>
            <li>Revoke OAuth access through GitHub/GitLab settings</li>
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-medium text-gray-900 dark:text-gray-100">Security</h2>
          <p className="mt-3 text-gray-600 dark:text-gray-400">
            We take security seriously. All data is transmitted over HTTPS. OAuth tokens are
            encrypted at rest. We do not store your GitHub or GitLab passwords.
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-medium text-gray-900 dark:text-gray-100">Mobile App</h2>
          <p className="mt-3 text-gray-600 dark:text-gray-400">
            The Carrel mobile app (Android and iOS) collects the same data as the web app.
            Additionally:
          </p>
          <ul className="mt-2 list-disc pl-6 text-gray-600 dark:text-gray-400">
            <li>PDFs are cached locally on your device for offline viewing</li>
            <li>Authentication tokens are stored securely in encrypted storage</li>
            <li>No data is shared with other apps on your device</li>
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-medium text-gray-900 dark:text-gray-100">Changes to This Policy</h2>
          <p className="mt-3 text-gray-600 dark:text-gray-400">
            We may update this privacy policy from time to time. We will notify you of any
            significant changes by posting the new policy on this page with an updated date.
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-medium text-gray-900 dark:text-gray-100">Contact</h2>
          <p className="mt-3 text-gray-600 dark:text-gray-400">
            If you have questions about this privacy policy or your personal data, please
            contact us at{" "}
            <a href="mailto:privacy@carrelapp.com" className="text-blue-600 hover:underline dark:text-blue-400">
              privacy@carrelapp.com
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
