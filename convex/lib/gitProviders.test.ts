import { describe, it, expect } from "vitest";
import {
  parseGitHubUrl,
  parseGitLabUrl,
  parseOverleafUrl,
  getProviderFromUrl,
  getGitLabHeaders,
} from "./gitProviders";

describe("parseGitHubUrl", () => {
  it("parses standard GitHub URLs", () => {
    expect(parseGitHubUrl("https://github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
    expect(parseGitHubUrl("https://github.com/owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("parses GitHub URLs with hyphens and dots", () => {
    expect(parseGitHubUrl("https://github.com/my-org/my-repo.js")).toEqual({
      owner: "my-org",
      repo: "my-repo.js",
    });
  });

  it("returns null for invalid URLs", () => {
    expect(parseGitHubUrl("https://gitlab.com/owner/repo")).toBeNull();
    expect(parseGitHubUrl("not-a-url")).toBeNull();
  });
});

describe("parseGitLabUrl", () => {
  it("parses standard GitLab URLs", () => {
    expect(parseGitLabUrl("https://gitlab.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("parses nested group URLs", () => {
    expect(parseGitLabUrl("https://gitlab.com/group/subgroup/repo")).toEqual({
      owner: "group/subgroup",
      repo: "repo",
    });
  });

  it("returns null for invalid URLs", () => {
    expect(parseGitLabUrl("https://github.com/owner/repo")).toBeNull();
  });
});

describe("parseOverleafUrl", () => {
  it("parses git.overleaf.com URLs", () => {
    const result = parseOverleafUrl("https://git.overleaf.com/abc123def456");
    expect(result).toEqual({
      projectId: "abc123def456",
      gitUrl: "https://git.overleaf.com/abc123def456",
    });
  });

  it("parses overleaf.com/project URLs", () => {
    const result = parseOverleafUrl("https://www.overleaf.com/project/abc123def456");
    expect(result).toEqual({
      projectId: "abc123def456",
      gitUrl: "https://git.overleaf.com/abc123def456",
    });
  });

  it("returns null for invalid URLs", () => {
    expect(parseOverleafUrl("https://github.com/owner/repo")).toBeNull();
  });
});

describe("getProviderFromUrl", () => {
  it("detects GitHub URLs", () => {
    expect(getProviderFromUrl("https://github.com/owner/repo")).toBe("github");
  });

  it("detects GitLab URLs", () => {
    expect(getProviderFromUrl("https://gitlab.com/owner/repo")).toBe("gitlab");
  });

  it("detects Overleaf URLs", () => {
    expect(getProviderFromUrl("https://git.overleaf.com/abc123")).toBe("overleaf");
    expect(getProviderFromUrl("https://overleaf.com/project/abc123")).toBe("overleaf");
  });

  it("returns null for unknown URLs", () => {
    expect(getProviderFromUrl("https://example.com/repo")).toBeNull();
  });
});

describe("getGitLabHeaders", () => {
  it("returns headers with User-Agent", () => {
    const headers = getGitLabHeaders();
    expect(headers["User-Agent"]).toBe("Carrel");
    expect(headers["PRIVATE-TOKEN"]).toBeUndefined();
  });

  it("includes PRIVATE-TOKEN when token is provided", () => {
    const headers = getGitLabHeaders("my-token");
    expect(headers["User-Agent"]).toBe("Carrel");
    expect(headers["PRIVATE-TOKEN"]).toBe("my-token");
  });

  it("does not include PRIVATE-TOKEN when token is null", () => {
    const headers = getGitLabHeaders(null);
    expect(headers["PRIVATE-TOKEN"]).toBeUndefined();
  });

  it("does not include PRIVATE-TOKEN when token is empty string", () => {
    const headers = getGitLabHeaders("");
    expect(headers["PRIVATE-TOKEN"]).toBeUndefined();
  });
});
