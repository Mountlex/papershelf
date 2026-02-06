/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ResendOTP from "../ResendOTP.js";
import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as git from "../git.js";
import type * as http from "../http.js";
import type * as latex from "../latex.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_cascadeDelete from "../lib/cascadeDelete.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_gitProviders from "../lib/gitProviders.js";
import type * as lib_http from "../lib/http.js";
import type * as lib_paperHelpers from "../lib/paperHelpers.js";
import type * as lib_providers_gitHelpers from "../lib/providers/gitHelpers.js";
import type * as lib_providers_github from "../lib/providers/github.js";
import type * as lib_providers_gitlab from "../lib/providers/gitlab.js";
import type * as lib_providers_index from "../lib/providers/index.js";
import type * as lib_providers_overleaf from "../lib/providers/overleaf.js";
import type * as lib_providers_types from "../lib/providers/types.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_settings from "../lib/settings.js";
import type * as lib_validation from "../lib/validation.js";
import type * as mobileAuth from "../mobileAuth.js";
import type * as mobileEmailAuth from "../mobileEmailAuth.js";
import type * as notifications from "../notifications.js";
import type * as papers from "../papers.js";
import type * as passwordActions from "../passwordActions.js";
import type * as repositories from "../repositories.js";
import type * as sessionCleanup from "../sessionCleanup.js";
import type * as sync from "../sync.js";
import type * as thumbnail from "../thumbnail.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ResendOTP: typeof ResendOTP;
  auth: typeof auth;
  crons: typeof crons;
  git: typeof git;
  http: typeof http;
  latex: typeof latex;
  "lib/audit": typeof lib_audit;
  "lib/auth": typeof lib_auth;
  "lib/cascadeDelete": typeof lib_cascadeDelete;
  "lib/crypto": typeof lib_crypto;
  "lib/gitProviders": typeof lib_gitProviders;
  "lib/http": typeof lib_http;
  "lib/paperHelpers": typeof lib_paperHelpers;
  "lib/providers/gitHelpers": typeof lib_providers_gitHelpers;
  "lib/providers/github": typeof lib_providers_github;
  "lib/providers/gitlab": typeof lib_providers_gitlab;
  "lib/providers/index": typeof lib_providers_index;
  "lib/providers/overleaf": typeof lib_providers_overleaf;
  "lib/providers/types": typeof lib_providers_types;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/settings": typeof lib_settings;
  "lib/validation": typeof lib_validation;
  mobileAuth: typeof mobileAuth;
  mobileEmailAuth: typeof mobileEmailAuth;
  notifications: typeof notifications;
  papers: typeof papers;
  passwordActions: typeof passwordActions;
  repositories: typeof repositories;
  sessionCleanup: typeof sessionCleanup;
  sync: typeof sync;
  thumbnail: typeof thumbnail;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
