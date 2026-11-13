import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import {
  buildStaticSite,
  collectStaticFiles,
  repositoryRoot,
} from "../scripts/build-static-site.mjs";

describe("Cloudflare 靜態站封裝", () => {
  test("Static Assets Worker 只開啟受 Access 保護的 workers.dev 測試入口", async () => {
    const config = JSON.parse(
      await readFile(path.join(repositoryRoot, "cloudflare/wrangler-static.jsonc"), "utf8"),
    );

    expect(config.name).toBe("siangstock-tools-static-assets");
    expect(config.workers_dev).toBe(true);
    expect(config.preview_urls).toBe(false);
    expect(config.routes).toBeUndefined();
    expect(config.main).toBeUndefined();
    expect(config.d1_databases).toBeUndefined();
    expect(config.kv_namespaces).toBeUndefined();
    expect(config.assets).toEqual({
      directory: "../dist/static-site",
      html_handling: "auto-trailing-slash",
      not_found_handling: "404-page",
    });
  });

  test("全站規則不會與工具專屬 CSP 或彈出視窗政策重疊", async () => {
    const headers = await readFile(path.join(repositoryRoot, "_headers"), "utf8");
    const blocks = headers.split(/\n\s*\n/);
    const pervasive = blocks.find((block) => block.startsWith("/*\n"));

    expect(pervasive).toBeDefined();
    expect(pervasive).not.toContain("Content-Security-Policy:");
    expect(pervasive).not.toContain("Cross-Origin-Opener-Policy:");
    expect(headers).toContain("Content-Security-Policy:");
    expect(headers).toContain("Cross-Origin-Opener-Policy: same-origin-allow-popups");
  });

  test("首頁精確套用 CSP，且目前版本化資產使用一年 immutable", async () => {
    const [headers, homepage] = await Promise.all([
      readFile(path.join(repositoryRoot, "_headers"), "utf8"),
      readFile(path.join(repositoryRoot, "index.html"), "utf8"),
    ]);
    const blocks = headers.split(/\n\s*\n/);
    const findBlock = (pathname) =>
      blocks.find((block) => block.split("\n", 1)[0] === pathname);

    for (const pathname of ["/", "/index.html"]) {
      const block = findBlock(pathname);
      expect(block, pathname).toBeDefined();
      expect(block).toContain(
        "Content-Security-Policy: default-src 'self' data: blob:; connect-src 'self';",
      );
      expect(block).toContain("Cache-Control: no-store, max-age=0, must-revalidate");
    }

    const versionedAssets = [
      ...homepage.matchAll(/(?:href|src)="(\/homepage\/[^"?]+\.(?:css|js))"/g),
    ].map((match) => match[1]);

    expect(versionedAssets).toHaveLength(2);
    for (const assetPath of versionedAssets) {
      expect(assetPath).toMatch(/^\/homepage\/\d{8}-[a-z0-9-]+-r\d+\.(?:css|js)$/);
      const block = findBlock(assetPath);
      expect(block, assetPath).toBeDefined();
      expect(block).toContain("Cache-Control: public, max-age=31536000, immutable");
    }
  });

  test("只包含允許的正式站檔案", () => {
    const files = collectStaticFiles();

    expect(files).toContain("_headers");
    expect(files).toContain("index.html");
    expect(files).toContain("homepage/version.json");
    expect(files).toContain("store-orders/guest/version.json");
    expect(files.some((file) => file.startsWith("cloudflare/worker/"))).toBe(false);
    expect(files).not.toContain("AGENTS.md");
    expect(files).not.toContain("README.md");
  });

  test("封裝後每個位元組與 Git 追蹤來源一致", async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "siangstock-static-"));
    const outputDirectory = path.join(temporaryRoot, "site");
    const manifestPath = path.join(temporaryRoot, "manifest.json");

    try {
      const result = await buildStaticSite({ outputDirectory, manifestPath });
      expect(result.fileCount).toBe(collectStaticFiles().length);

      for (const entry of result.files) {
        const [source, output] = await Promise.all([
          readFile(path.join(repositoryRoot, entry.path)),
          readFile(path.join(outputDirectory, entry.path)),
        ]);
        expect(output.equals(source), entry.path).toBe(true);
      }
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 30_000);
});
