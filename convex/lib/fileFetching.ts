import { isBinaryFile, isHtmlErrorPage } from "./latexUtils";
import { fetchWithTimeout, DEFAULT_API_TIMEOUT } from "./http";

// Fetch a single text file from GitHub or GitLab
export async function fetchTextFile(
  owner: string,
  repo: string,
  branch: string,
  filePath: string,
  token: string,
  provider: "github" | "gitlab" = "github",
  gitlabBaseUrl?: string // For self-hosted GitLab
): Promise<string | null> {
  let rawUrl: string;
  const headers: Record<string, string> = { "User-Agent": "Carrel" };
  const baseUrl = gitlabBaseUrl || "https://gitlab.com";

  if (provider === "github") {
    rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  } else {
    // Use GitLab API endpoint for raw file content (works with PRIVATE-TOKEN)
    const projectId = encodeURIComponent(`${owner}/${repo}`);
    const encodedFilePath = encodeURIComponent(filePath);
    rawUrl = `${baseUrl}/api/v4/projects/${projectId}/repository/files/${encodedFilePath}/raw?ref=${branch}`;
    if (token) {
      headers["PRIVATE-TOKEN"] = token;
    }
  }

  const response = await fetchWithTimeout(rawUrl, { headers }, DEFAULT_API_TIMEOUT);
  if (!response.ok) {
    return null;
  }
  const content = await response.text();
  // Check if the response is an HTML error page (login, captcha, soft 404, etc.)
  if (isHtmlErrorPage(content)) {
    console.log(`Received HTML error page instead of content for: ${filePath}`);
    return null;
  }
  return content;
}

// Fetch a single file with proper encoding
export async function fetchSingleFile(
  owner: string,
  repo: string,
  branch: string,
  filePath: string,
  token: string,
  provider: "github" | "gitlab" = "github",
  gitlabBaseUrl?: string // For self-hosted GitLab
): Promise<{ path: string; content: string; encoding?: string } | null> {
  let rawUrl: string;
  const headers: Record<string, string> = { "User-Agent": "Carrel" };
  const baseUrl = gitlabBaseUrl || "https://gitlab.com";

  if (provider === "github") {
    rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  } else {
    // Use GitLab API endpoint for raw file content (works with PRIVATE-TOKEN)
    const projectId = encodeURIComponent(`${owner}/${repo}`);
    const encodedFilePath = encodeURIComponent(filePath);
    rawUrl = `${baseUrl}/api/v4/projects/${projectId}/repository/files/${encodedFilePath}/raw?ref=${branch}`;
    if (token) {
      headers["PRIVATE-TOKEN"] = token;
    }
  }

  const response = await fetchWithTimeout(rawUrl, { headers }, DEFAULT_API_TIMEOUT);
  if (!response.ok) {
    return null;
  }

  // Get just the filename for extension check
  const filename = filePath.includes("/")
    ? filePath.substring(filePath.lastIndexOf("/") + 1)
    : filePath;

  // Get relative path (relative to the main tex file's directory)
  // For now, use the full path as stored
  const relativePath = filePath;

  if (isBinaryFile(filename)) {
    // Read binary files as base64 (memory efficient)
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    // Convert to base64 in chunks to avoid stack overflow
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
    }
    const base64 = btoa(binary);
    return { path: relativePath, content: base64, encoding: "base64" };
  } else {
    // Read text files as-is
    const content = await response.text();
    // Check if the response is an HTML error page (login, captcha, soft 404, etc.)
    if (isHtmlErrorPage(content)) {
      console.log(`Received HTML error page instead of content for: ${filePath}`);
      return null;
    }
    return { path: relativePath, content };
  }
}

// Helper to fetch directory contents recursively from GitHub or GitLab
export async function fetchDirectoryFiles(
  owner: string,
  repo: string,
  branch: string,
  dirPath: string,
  token: string,
  provider: "github" | "gitlab" = "github",
  gitlabBaseUrl?: string // For self-hosted GitLab
): Promise<Array<{ path: string; content: string; encoding?: string }>> {
  const files: Array<{ path: string; content: string; encoding?: string }> = [];
  const baseUrl = gitlabBaseUrl || "https://gitlab.com";

  const headers: Record<string, string> = {
    "User-Agent": "Carrel",
  };

  let listUrl: string;
  if (provider === "github") {
    headers["Accept"] = "application/vnd.github.v3+json";
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    listUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}?ref=${branch}`;
  } else {
    if (token) {
      headers["PRIVATE-TOKEN"] = token;
    }
    const projectId = encodeURIComponent(`${owner}/${repo}`);
    const params = new URLSearchParams({ ref: branch, per_page: "100" });
    if (dirPath) {
      params.set("path", dirPath);
    }
    listUrl = `${baseUrl}/api/v4/projects/${projectId}/repository/tree?${params}`;
  }

  const listResponse = await fetchWithTimeout(listUrl, { headers }, DEFAULT_API_TIMEOUT);

  if (!listResponse.ok) {
    throw new Error(`Failed to list directory: ${listResponse.statusText}`);
  }

  const items = await listResponse.json();
  const itemList = Array.isArray(items) ? items : [items];

  for (const item of itemList) {
    const itemType = provider === "gitlab" ? (item.type === "tree" ? "dir" : "file") : item.type;
    const itemPath = item.path;
    const itemName = item.name;

    if (itemType === "file") {
      // Skip very large files (over 5MB) - GitLab doesn't return size in tree, so skip this check for GitLab
      if (provider === "github" && item.size > 5000000) continue;

      // Fetch file content
      let rawUrl: string;
      const fetchHeaders: Record<string, string> = { "User-Agent": "Carrel" };
      if (provider === "github") {
        rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${itemPath}`;
        if (token) {
          fetchHeaders["Authorization"] = `Bearer ${token}`;
        }
      } else {
        // Use GitLab API endpoint for raw file content (works with PRIVATE-TOKEN)
        const projectId = encodeURIComponent(`${owner}/${repo}`);
        const encodedFilePath = encodeURIComponent(itemPath);
        rawUrl = `${baseUrl}/api/v4/projects/${projectId}/repository/files/${encodedFilePath}/raw?ref=${branch}`;
        if (token) {
          fetchHeaders["PRIVATE-TOKEN"] = token;
        }
      }

      const fileResponse = await fetchWithTimeout(rawUrl, { headers: fetchHeaders }, DEFAULT_API_TIMEOUT);

      if (fileResponse.ok) {
        // Store path relative to the directory
        const relativePath = itemPath.startsWith(dirPath + "/")
          ? itemPath.slice(dirPath.length + 1)
          : itemName;

        if (isBinaryFile(itemName)) {
          // Read binary files as byte array
          const buffer = await fileResponse.arrayBuffer();
          const bytes = Array.from(new Uint8Array(buffer));
          files.push({ path: relativePath, content: bytes as unknown as string, encoding: "bytes" });
        } else {
          // Read text files as-is
          const content = await fileResponse.text();
          // Check if the response is an HTML error page (login, captcha, soft 404, etc.)
          if (isHtmlErrorPage(content)) {
            console.log(`Received HTML error page instead of content for: ${itemPath}`);
            continue;
          }
          files.push({ path: relativePath, content });
        }
      }
    } else if (itemType === "dir") {
      // Recursively fetch subdirectory
      const subFiles = await fetchDirectoryFiles(owner, repo, branch, itemPath, token, provider, gitlabBaseUrl);
      for (const subFile of subFiles) {
        const relativePath = itemPath.startsWith(dirPath + "/")
          ? itemPath.slice(dirPath.length + 1) + "/" + subFile.path
          : itemName + "/" + subFile.path;
        files.push({ path: relativePath, content: subFile.content, encoding: subFile.encoding });
      }
    }
  }

  return files;
}

// Fetch only .tex files from a directory (for dependency detection)
export async function fetchTexFilesOnly(
  owner: string,
  repo: string,
  branch: string,
  dirPath: string,
  token: string,
  provider: "github" | "gitlab" = "github",
  gitlabBaseUrl?: string // For self-hosted GitLab
): Promise<Array<{ path: string; content: string }>> {
  const files: Array<{ path: string; content: string }> = [];
  const baseUrl = gitlabBaseUrl || "https://gitlab.com";

  const headers: Record<string, string> = {
    "User-Agent": "Carrel",
  };

  let listUrl: string;
  if (provider === "github") {
    headers["Accept"] = "application/vnd.github.v3+json";
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    listUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}?ref=${branch}`;
  } else {
    if (token) {
      headers["PRIVATE-TOKEN"] = token;
    }
    const projectId = encodeURIComponent(`${owner}/${repo}`);
    const params = new URLSearchParams({ ref: branch, per_page: "100" });
    if (dirPath) {
      params.set("path", dirPath);
    }
    listUrl = `${baseUrl}/api/v4/projects/${projectId}/repository/tree?${params}`;
  }

  console.log(`[fetchTexFilesOnly] Listing directory: ${listUrl} (provider: ${provider}, hasToken: ${!!token})`);
  const listResponse = await fetchWithTimeout(listUrl, { headers }, DEFAULT_API_TIMEOUT);

  if (!listResponse.ok) {
    const errorBody = await listResponse.text().catch(() => "");
    console.error(`[fetchTexFilesOnly] Failed to list directory: ${listResponse.status} ${listResponse.statusText}`, errorBody.slice(0, 500));
    throw new Error(`Failed to list directory: ${listResponse.status} ${listResponse.statusText}. ${
      listResponse.status === 401 || listResponse.status === 403
        ? "Authentication may be required or your token may have insufficient permissions."
        : ""
    }`);
  }

  const responseText = await listResponse.text();
  let items;
  try {
    items = JSON.parse(responseText);
  } catch {
    // If we can't parse JSON, it might be an HTML error page
    console.error(`[fetchTexFilesOnly] Non-JSON response (likely HTML error page):`, responseText.slice(0, 500));
    throw new Error("Repository returned an HTML page instead of JSON. This usually indicates authentication is required or the repository URL is incorrect.");
  }
  const itemList = Array.isArray(items) ? items : [items];
  console.log(`[fetchTexFilesOnly] Found ${itemList.length} items in directory (path: ${dirPath || "root"})`);

  if (itemList.length === 0) {
    console.warn(`[fetchTexFilesOnly] Directory listing returned empty. This may indicate: wrong project path, missing permissions, or empty directory.`);
  }

  for (const item of itemList) {
    const itemType = provider === "gitlab" ? (item.type === "tree" ? "dir" : "file") : item.type;
    const itemPath = item.path;
    const itemName = item.name;

    if (itemType === "file" && itemName.endsWith(".tex")) {
      // Fetch .tex file content
      let rawUrl: string;
      const fetchHeaders: Record<string, string> = { "User-Agent": "Carrel" };
      if (provider === "github") {
        rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${itemPath}`;
        if (token) {
          fetchHeaders["Authorization"] = `Bearer ${token}`;
        }
      } else {
        // Use GitLab API endpoint for raw file content (works with PRIVATE-TOKEN)
        // The web URL format (/-/raw/) requires session cookies and doesn't work with API tokens
        const projectId = encodeURIComponent(`${owner}/${repo}`);
        const encodedFilePath = encodeURIComponent(itemPath);
        rawUrl = `${baseUrl}/api/v4/projects/${projectId}/repository/files/${encodedFilePath}/raw?ref=${branch}`;
        if (token) {
          fetchHeaders["PRIVATE-TOKEN"] = token;
        }
      }

      const fileResponse = await fetchWithTimeout(rawUrl, { headers: fetchHeaders }, DEFAULT_API_TIMEOUT);
      if (fileResponse.ok) {
        const content = await fileResponse.text();
        // Check if the response is an HTML error page (login, captcha, soft 404, etc.)
        if (isHtmlErrorPage(content)) {
          console.log(`Received HTML error page instead of .tex content for: ${itemPath}`);
          continue;
        }
        files.push({ path: itemPath, content });
      } else {
        console.warn(`[fetchTexFilesOnly] Failed to fetch ${itemPath}: ${fileResponse.status} ${fileResponse.statusText}`);
      }
    } else if (itemType === "dir") {
      // Recursively fetch .tex files from subdirectories
      const subFiles = await fetchTexFilesOnly(owner, repo, branch, itemPath, token, provider, gitlabBaseUrl);
      files.push(...subFiles);
    }
  }

  return files;
}
