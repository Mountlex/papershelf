// Binary file extensions that need base64 encoding
export const BINARY_EXTENSIONS = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".tif",
  ".eps", ".ps", ".svg", ".ico", ".webp", ".zip", ".tar", ".gz",
]);

export function isBinaryFile(filename: string): boolean {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf("."));
  return BINARY_EXTENSIONS.has(ext);
}

// Image extensions that \includegraphics might use
export const IMAGE_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".eps", ".ps", ".svg", ".gif", ".bmp"];

// Check if content looks like an HTML error page instead of expected content
// This catches cases where servers return 200 OK with HTML error pages
// (e.g., login pages, captcha pages, soft 404s)
export function isHtmlErrorPage(content: string): boolean {
  const trimmed = content.trimStart().toLowerCase();
  return (
    trimmed.startsWith("<!doctype html") ||
    trimmed.startsWith("<html") ||
    (trimmed.startsWith("<?xml") && trimmed.includes("<html"))
  );
}

// Parse a .tex file to extract its dependencies
export function parseTexDependencies(content: string, basePath: string): Array<{ path: string; isTexFile: boolean }> {
  const deps: Array<{ path: string; isTexFile: boolean }> = [];
  const seen = new Set<string>();

  // Helper to normalize and resolve paths
  const addDep = (rawPath: string, isTexFile: boolean, defaultExt?: string) => {
    let path = rawPath.trim();
    // Remove quotes if present
    path = path.replace(/^["']|["']$/g, "");
    // Skip absolute paths and URLs
    if (path.startsWith("/") || path.includes("://")) return;
    // Skip empty paths
    if (!path) return;

    // Add default extension if missing and specified
    if (defaultExt && !path.includes(".")) {
      path = path + defaultExt;
    }

    // Resolve relative to base path
    const fullPath = basePath ? `${basePath}/${path}` : path;
    // Normalize path (remove ./ and resolve ../)
    const normalized = fullPath
      .split("/")
      .filter((p) => p && p !== ".")
      .reduce((acc: string[], part) => {
        if (part === "..") acc.pop();
        else acc.push(part);
        return acc;
      }, [])
      .join("/");

    if (!seen.has(normalized)) {
      seen.add(normalized);
      deps.push({ path: normalized, isTexFile });
    }
  };

  // Remove comments (lines starting with % and inline comments)
  const contentNoComments = content
    .split("\n")
    .map((line) => {
      const commentIdx = line.indexOf("%");
      if (commentIdx === 0) return "";
      if (commentIdx > 0 && line[commentIdx - 1] !== "\\") {
        return line.substring(0, commentIdx);
      }
      return line;
    })
    .join("\n");

  // \input{file} - may omit .tex extension
  const inputRegex = /\\input\{([^}]+)\}/g;
  let match;
  while ((match = inputRegex.exec(contentNoComments)) !== null) {
    const path = match[1];
    addDep(path, true, ".tex");
  }

  // \include{file} - always omits .tex extension
  const includeRegex = /\\include\{([^}]+)\}/g;
  while ((match = includeRegex.exec(contentNoComments)) !== null) {
    addDep(match[1], true, ".tex");
  }

  // \includegraphics[...]{file} - various image extensions
  const graphicsRegex = /\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g;
  while ((match = graphicsRegex.exec(contentNoComments)) !== null) {
    const imgPath = match[1];
    if (imgPath.includes(".")) {
      // Has extension, use as-is
      addDep(imgPath, false);
    } else {
      // No extension - LaTeX will try various extensions
      // Add all possible image extensions
      for (const ext of IMAGE_EXTENSIONS) {
        addDep(imgPath + ext, false);
      }
    }
  }

  // \bibliography{file} - may omit .bib extension
  const bibRegex = /\\bibliography\{([^}]+)\}/g;
  while ((match = bibRegex.exec(contentNoComments)) !== null) {
    // Can be comma-separated list
    const bibs = match[1].split(",");
    for (const bib of bibs) {
      addDep(bib.trim(), false, ".bib");
    }
  }

  // \addbibresource{file} - biblatex style
  const bibresourceRegex = /\\addbibresource\{([^}]+)\}/g;
  while ((match = bibresourceRegex.exec(contentNoComments)) !== null) {
    addDep(match[1], false, ".bib");
  }

  // \usepackage{pkg} - might be local .sty file
  const usepackageRegex = /\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/g;
  while ((match = usepackageRegex.exec(contentNoComments)) !== null) {
    // Can be comma-separated list
    const packages = match[1].split(",");
    for (const pkg of packages) {
      addDep(pkg.trim(), false, ".sty");
    }
  }

  // \usepackage[style=X]{biblatex} - custom biblatex styles need .bbx and .cbx files
  const biblatexRegex = /\\usepackage\[([^\]]*)\]\{biblatex\}/g;
  while ((match = biblatexRegex.exec(contentNoComments)) !== null) {
    const options = match[1];
    // Look for style=, bibstyle=, or citestyle= options
    const styleMatch = options.match(/(?:^|,)\s*style\s*=\s*([^,\]]+)/);
    const bibstyleMatch = options.match(/(?:^|,)\s*bibstyle\s*=\s*([^,\]]+)/);
    const citestyleMatch = options.match(/(?:^|,)\s*citestyle\s*=\s*([^,\]]+)/);

    if (styleMatch) {
      const style = styleMatch[1].trim();
      addDep(style, false, ".bbx"); // bibliography style
      addDep(style, false, ".cbx"); // citation style
    }
    if (bibstyleMatch) {
      addDep(bibstyleMatch[1].trim(), false, ".bbx");
    }
    if (citestyleMatch) {
      addDep(citestyleMatch[1].trim(), false, ".cbx");
    }
  }

  // \documentclass{cls} - might be local .cls file
  const docclassRegex = /\\documentclass(?:\[[^\]]*\])?\{([^}]+)\}/g;
  while ((match = docclassRegex.exec(contentNoComments)) !== null) {
    addDep(match[1], false, ".cls");
  }

  // \lstinputlisting[...]{file} - listings package
  const lstRegex = /\\lstinputlisting(?:\[[^\]]*\])?\{([^}]+)\}/g;
  while ((match = lstRegex.exec(contentNoComments)) !== null) {
    addDep(match[1], false);
  }

  // \verbatiminput{file}
  const verbatimRegex = /\\verbatiminput\{([^}]+)\}/g;
  while ((match = verbatimRegex.exec(contentNoComments)) !== null) {
    addDep(match[1], false);
  }

  // \inputminted{lang}{file} - minted package
  const mintedRegex = /\\inputminted\{[^}]*\}\{([^}]+)\}/g;
  while ((match = mintedRegex.exec(contentNoComments)) !== null) {
    addDep(match[1], false);
  }

  // \import{path}{file} and \subimport{path}{file}
  const importRegex = /\\(?:sub)?import\{([^}]*)\}\{([^}]+)\}/g;
  while ((match = importRegex.exec(contentNoComments)) !== null) {
    const importPath = match[1];
    const file = match[2];
    const fullPath = importPath ? `${importPath}/${file}` : file;
    addDep(fullPath, true, ".tex");
  }

  // \subfile{file} - subfiles package
  const subfileRegex = /\\subfile\{([^}]+)\}/g;
  while ((match = subfileRegex.exec(contentNoComments)) !== null) {
    addDep(match[1], true, ".tex");
  }

  return deps;
}
