import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(scriptDirectory, "../..");

export const staticRootFiles = [
  "404.html",
  "_headers",
  "index.html",
  "robots.txt",
  "site.css",
];

export const staticDirectories = [
  "competitive-analysis",
  "cost-analysis",
  "homepage",
  "inventory",
  "live-guidance",
  "procurement-planning",
  "store-orders",
  "store-transfer",
  "supplier-reconciliation",
];

const forbiddenBasenames = new Set([
  ".env",
  ".env.local",
  ".env.production",
]);
const forbiddenExtensions = new Set([".key", ".p12", ".pem", ".pfx"]);
const pagesFileLimit = 20_000;
const pagesFileSizeLimit = 25 * 1024 * 1024;
const pagesHeaderRuleLimit = 100;
const pagesHeaderLineLimit = 2_000;

function assertSafeTrackedPath(relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  const basename = path.posix.basename(normalized).toLowerCase();
  const extension = path.posix.extname(normalized).toLowerCase();

  if (
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized) ||
    forbiddenBasenames.has(basename) ||
    forbiddenExtensions.has(extension) ||
    basename.startsWith("secrets.")
  ) {
    throw new Error(`拒絕打包不安全路徑：${relativePath}`);
  }
}

export function collectStaticFiles() {
  const tracked = execFileSync(
    "git",
    ["ls-files", "-z", "--", ...staticRootFiles, ...staticDirectories],
    { cwd: repositoryRoot, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "en"));

  for (const requiredFile of staticRootFiles) {
    if (!tracked.includes(requiredFile)) {
      throw new Error(`缺少必要靜態檔案：${requiredFile}`);
    }
  }

  for (const relativePath of tracked) {
    assertSafeTrackedPath(relativePath);
    const isAllowedRoot = staticRootFiles.includes(relativePath);
    const isAllowedDirectory = staticDirectories.some(
      (directory) => relativePath.startsWith(`${directory}/`),
    );
    if (!isAllowedRoot && !isAllowedDirectory) {
      throw new Error(`靜態檔案超出允許範圍：${relativePath}`);
    }
  }

  return tracked;
}

function digest(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

export async function buildStaticSite({
  outputDirectory = path.join(repositoryRoot, "dist/static-site"),
  manifestPath = path.join(repositoryRoot, "dist/static-site-manifest.json"),
} = {}) {
  const files = collectStaticFiles();
  if (files.length > pagesFileLimit) {
    throw new Error(`超過 Cloudflare Pages 檔案上限：${files.length}`);
  }

  const headers = await readFile(path.join(repositoryRoot, "_headers"), "utf8");
  const headerLines = headers.split(/\r?\n/);
  const headerRuleCount = headerLines.filter(
    (line) => line.trim() && !/^\s/.test(line) && !line.startsWith("#"),
  ).length;
  if (headerRuleCount > pagesHeaderRuleLimit) {
    throw new Error(`超過 Cloudflare Pages _headers 規則上限：${headerRuleCount}`);
  }
  const oversizedHeaderLine = headerLines.findIndex(
    (line) => line.length > pagesHeaderLineLimit,
  );
  if (oversizedHeaderLine >= 0) {
    throw new Error(`_headers 第 ${oversizedHeaderLine + 1} 行超過 2,000 字元`);
  }

  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  const manifest = [];
  for (const relativePath of files) {
    const sourcePath = path.join(repositoryRoot, relativePath);
    const destinationPath = path.join(outputDirectory, relativePath);
    const sourceStat = await stat(sourcePath);
    if (!sourceStat.isFile()) {
      throw new Error(`只允許一般檔案：${relativePath}`);
    }
    if (sourceStat.size > pagesFileSizeLimit) {
      throw new Error(`超過 Cloudflare Pages 單檔 25 MiB 上限：${relativePath}`);
    }

    await mkdir(path.dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);

    const [sourceContents, outputContents] = await Promise.all([
      readFile(sourcePath),
      readFile(destinationPath),
    ]);
    const sourceSha256 = digest(sourceContents);
    const outputSha256 = digest(outputContents);
    if (sourceSha256 !== outputSha256) {
      throw new Error(`輸出守恆失敗：${relativePath}`);
    }

    manifest.push({
      path: relativePath,
      bytes: sourceContents.byteLength,
      sha256: sourceSha256,
    });
  }

  const totalBytes = manifest.reduce((sum, entry) => sum + entry.bytes, 0);
  const aggregateSha256 = digest(
    manifest.map((entry) => `${entry.path}:${entry.sha256}\n`).join(""),
  );
  const result = {
    schemaVersion: 1,
    fileCount: manifest.length,
    totalBytes,
    aggregateSha256,
    files: manifest,
  };

  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const result = await buildStaticSite();
  console.log(
    `靜態站封裝完成：${result.fileCount} 個檔案，${result.totalBytes} bytes，SHA-256 ${result.aggregateSha256}`,
  );
}
