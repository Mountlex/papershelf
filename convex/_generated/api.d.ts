/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as git from "../git.js";
import type * as http from "../http.js";
import type * as latex from "../latex.js";
import type * as lib_fileFetching from "../lib/fileFetching.js";
import type * as lib_gitProviders from "../lib/gitProviders.js";
import type * as lib_latexUtils from "../lib/latexUtils.js";
import type * as mobileAuth from "../mobileAuth.js";
import type * as papers from "../papers.js";
import type * as repositories from "../repositories.js";
import type * as sync from "../sync.js";
import type * as thumbnail from "../thumbnail.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  git: typeof git;
  http: typeof http;
  latex: typeof latex;
  "lib/fileFetching": typeof lib_fileFetching;
  "lib/gitProviders": typeof lib_gitProviders;
  "lib/latexUtils": typeof lib_latexUtils;
  mobileAuth: typeof mobileAuth;
  papers: typeof papers;
  repositories: typeof repositories;
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
