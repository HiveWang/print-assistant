import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renders the print assistant workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>打印助手 · 内网安全打印<\/title>/i);
  assert.match(html, /今天要打印什么/);
  assert.match(html, /文件打印后即删除/);
  assert.match(html, /提交打印/);
  assert.match(html, /本次会话记录/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("ships real printer discovery without demo data", async () => {
  const [page, server, viteConfig, compose, deployScript, devScript] =
    await Promise.all([
      readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../server/index.mjs", import.meta.url), "utf8"),
      readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
      readFile(new URL("../docker-compose.yml", import.meta.url), "utf8"),
      readFile(new URL("../deploy.sh", import.meta.url), "utf8"),
      readFile(new URL("../server/dev.mjs", import.meta.url), "utf8"),
    ]);

  assert.match(page, /multiple/);
  assert.match(page, /accept="\.doc,\.docx,\.pdf,\.jpg,\.jpeg,\.png"/);
  assert.match(page, /print-assistant-default/);
  assert.doesNotMatch(page, /DEMO_|demoMode|simulateJob|预览模式/);
  assert.match(server, /HttpOnly; SameSite=Strict/);
  assert.match(server, /await removeDirectory\(job\.tempDir\)/);
  assert.doesNotMatch(
    server,
    /PRINT_ASSISTANT_DEMO|演示打印机|express\.static|res\.download|sendFile/,
  );
  assert.match(viteConfig, /target: process\.env\.PRINT_API_URL/);
  assert.match(devScript, /\["server\/index\.mjs"\]/);
  assert.match(compose, /tmpfs:/);
  assert.match(deployScript, /docker compose/);

  await assert.rejects(
    access(
      new URL(
        "../app/_sites-preview/SkeletonPreview.tsx",
        import.meta.url,
      ),
    ),
  );
  await access(new URL("Dockerfile", projectRoot));
});
