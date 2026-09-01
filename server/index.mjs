import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import express from "express";
import multer from "multer";

const execFileAsync = promisify(execFile);
const PORT = Number.parseInt(process.env.PORT || "8787", 10);
const SESSION_TTL_MS =
  Number.parseInt(process.env.SESSION_TTL_HOURS || "8", 10) * 60 * 60 * 1000;
const MAX_FILE_SIZE_MB = Number.parseInt(
  process.env.MAX_FILE_SIZE_MB || "100",
  10,
);
const MAX_FILES = Number.parseInt(process.env.MAX_FILES || "50", 10);
const PRINT_WORKERS = Math.max(
  1,
  Number.parseInt(process.env.PRINT_WORKERS || "2", 10),
);
const HISTORY_LIMIT = Math.max(
  1,
  Number.parseInt(process.env.HISTORY_LIMIT || "100", 10),
);
const TEMP_ROOT = path.resolve(
  process.env.PRINT_TEMP_ROOT ||
    path.join(os.tmpdir(), "print-assistant-ephemeral"),
);
const SUPPORTED_FILE = /\.(doc|docx|pdf|jpe?g|png)$/i;
const sessions = new Map();
const pendingJobs = [];
let activeWorkers = 0;
let printerCache = { expiresAt: 0, printers: [], defaultPrinter: "" };

function assertSafeTempRoot(value) {
  const parsed = path.parse(value);
  const basename = path.basename(value).toLowerCase();
  if (
    value === parsed.root ||
    value === path.resolve(os.tmpdir()) ||
    !basename.includes("print-assistant")
  ) {
    throw new Error(
      "PRINT_TEMP_ROOT must point to a dedicated directory containing “print-assistant”.",
    );
  }
}

assertSafeTempRoot(TEMP_ROOT);
await fs.rm(TEMP_ROOT, { recursive: true, force: true });
await fs.mkdir(TEMP_ROOT, { recursive: true, mode: 0o700 });

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const separator = item.indexOf("=");
        return separator === -1
          ? [item, ""]
          : [
              decodeURIComponent(item.slice(0, separator)),
              decodeURIComponent(item.slice(separator + 1)),
            ];
      }),
  );
}

function createSessionId() {
  return crypto.randomBytes(18).toString("hex");
}

function getSession(sessionId) {
  let session = sessions.get(sessionId);
  if (!session) {
    session = {
      id: sessionId,
      createdAt: Date.now(),
      lastSeen: Date.now(),
      jobs: new Map(),
      history: [],
    };
    sessions.set(sessionId, session);
  }
  session.lastSeen = Date.now();
  return session;
}

function publicFile(file) {
  return {
    name: file.name,
    size: file.size,
    status: file.status,
  };
}

function publicJob(job) {
  return {
    id: job.id,
    createdAt: job.createdAt,
    printer: job.printer,
    colorMode: job.colorMode,
    copies: job.copies,
    progress: job.progress,
    status: job.status,
    files: job.files.map(publicFile),
    ...(job.error ? { error: job.error } : {}),
  };
}

function publicHistory(job) {
  return {
    id: job.id,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
    printer: job.printer,
    colorMode: job.colorMode,
    copies: job.copies,
    status: job.status,
    files: job.files.map(publicFile),
    ...(job.error ? { error: job.error } : {}),
  };
}

async function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    timeout: options.timeout ?? 10_000,
    maxBuffer: 1024 * 1024,
    env: process.env,
    ...options,
  });
}

function printerLocations() {
  try {
    return JSON.parse(process.env.PRINTER_LOCATIONS_JSON || "{}");
  } catch {
    return {};
  }
}

async function printerSupportsColor(name) {
  try {
    const { stdout } = await run("lpoptions", ["-p", name, "-l"], {
      timeout: 3500,
    });
    return /(ColorModel|ColorMode|print-color-mode)/i.test(stdout);
  } catch {
    return null;
  }
}

async function discoverPrinters({ fresh = false } = {}) {
  if (!fresh && printerCache.expiresAt > Date.now()) return printerCache;

  const locations = printerLocations();
  try {
    const { stdout } = await run("lpstat", ["-p", "-d"], { timeout: 5000 });
    const lines = stdout.split(/\r?\n/);
    const defaultLine = lines.find((line) =>
      line.startsWith("system default destination:"),
    );
    const defaultPrinter =
      process.env.DEFAULT_PRINTER ||
      defaultLine?.split(":").slice(1).join(":").trim() ||
      "";
    const queueRows = lines
      .map((line) => line.match(/^printer\s+(\S+)\s+(.+)$/i))
      .filter(Boolean);
    const printers = await Promise.all(
      queueRows.map(async (match) => {
        const name = match[1];
        const detail = match[2];
        return {
          name,
          location: locations[name] || "",
          isDefault: name === defaultPrinter,
          color: await printerSupportsColor(name),
          status: /disabled|not accepting|offline/i.test(detail)
            ? "offline"
            : "online",
        };
      }),
    );
    printerCache = {
      printers,
      defaultPrinter: defaultPrinter || printers[0]?.name || "",
      expiresAt: Date.now() + 15_000,
    };
    return printerCache;
  } catch {
    printerCache = {
      printers: [],
      defaultPrinter: "",
      expiresAt: Date.now() + 5000,
    };
    return printerCache;
  }
}

function normalizeOriginalName(name) {
  const trimmed = path.basename(name).replace(/[\u0000-\u001f]/g, "").trim();
  if (!trimmed) return "未命名文件";
  try {
    const decoded = Buffer.from(trimmed, "latin1").toString("utf8");
    return decoded.includes("\uFFFD") ? trimmed : decoded;
  } catch {
    return trimmed;
  }
}

async function removeDirectory(directory) {
  if (!directory || !path.resolve(directory).startsWith(`${TEMP_ROOT}${path.sep}`)) {
    return;
  }
  await fs.rm(directory, { recursive: true, force: true });
}

const storage = multer.diskStorage({
  destination(req, _file, callback) {
    const destination = path.join(
      TEMP_ROOT,
      req.printSession.id,
      req.uploadBatchId,
    );
    fs.mkdir(destination, { recursive: true, mode: 0o700 })
      .then(() => callback(null, destination))
      .catch(callback);
  },
  filename(_req, file, callback) {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `${crypto.randomUUID()}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE_MB * 1024 * 1024,
    files: MAX_FILES,
  },
  fileFilter(_req, file, callback) {
    if (!SUPPORTED_FILE.test(file.originalname)) {
      callback(new Error(`不支持的文件格式：${file.originalname}`));
      return;
    }
    callback(null, true);
  },
});

function prepareBatch(req, _res, next) {
  req.uploadBatchId = crypto.randomUUID();
  next();
}

function parseSettings(value) {
  let settings;
  try {
    settings = JSON.parse(value);
  } catch {
    throw new Error("打印设置格式不正确");
  }
  const printer = String(settings.printer || "").trim();
  const copies = Number.parseInt(settings.copies, 10);
  const colorMode =
    settings.colorMode === "color" ? "color" : "monochrome";
  if (!printer || printer.length > 255) throw new Error("请选择有效的打印机");
  if (!Number.isInteger(copies) || copies < 1 || copies > 99) {
    throw new Error("打印份数必须在 1–99 之间");
  }
  return { printer, copies, colorMode };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class CancelledError extends Error {}

async function convertToPrintable(file, job) {
  const extension = path.extname(file.storedPath).toLowerCase();
  if (extension !== ".doc" && extension !== ".docx") return file.storedPath;

  file.status = "converting";
  const convertedDirectory = path.join(job.tempDir, "converted");
  const profileDirectory = path.join(
    job.tempDir,
    `libreoffice-${crypto.randomUUID()}`,
  );
  await fs.mkdir(convertedDirectory, { recursive: true, mode: 0o700 });
  await fs.mkdir(profileDirectory, { recursive: true, mode: 0o700 });
  await run(
    "soffice",
    [
      "--headless",
      "--nologo",
      "--nofirststartwizard",
      `-env:UserInstallation=${pathToFileURL(profileDirectory).href}`,
      "--convert-to",
      "pdf",
      "--outdir",
      convertedDirectory,
      file.storedPath,
    ],
    { timeout: 120_000 },
  );
  const convertedPath = path.join(
    convertedDirectory,
    `${path.basename(file.storedPath, extension)}.pdf`,
  );
  await fs.access(convertedPath);
  return convertedPath;
}

function parseCupsJobId(output) {
  return output.match(/request id is\s+(\S+)/i)?.[1] || "";
}

async function waitForCups(job, cupsJobId) {
  if (!cupsJobId) {
    await sleep(500);
    return;
  }
  const maximumWait =
    Number.parseInt(process.env.CUPS_MONITOR_MINUTES || "30", 10) * 60 * 1000;
  const startedAt = Date.now();
  await sleep(900);

  while (Date.now() - startedAt < maximumWait) {
    if (job.cancelRequested) {
      await run("cancel", [cupsJobId], { timeout: 5000 }).catch(() => {});
      throw new CancelledError("任务已取消");
    }
    try {
      const { stdout } = await run("lpstat", ["-W", "not-completed", "-o"], {
        timeout: 5000,
      });
      if (!stdout.includes(cupsJobId)) return;
    } catch {
      return;
    }
    await sleep(1800);
  }
}

function friendlyPrintError(error) {
  const message = `${error?.stderr || ""} ${error?.message || ""}`;
  if (/soffice|libreoffice|convert/i.test(message)) {
    return "Word 文件转换失败，请确认文档未损坏";
  }
  if (/unknown destination|not found|no destinations/i.test(message)) {
    return "打印机不可用或队列名称已变更";
  }
  if (/cancel/i.test(message)) return "任务已取消";
  return "打印服务未能处理此任务，请联系管理员检查打印队列";
}

function scheduleFinalization(job) {
  setTimeout(() => {
    const session = sessions.get(job.sessionId);
    if (!session) return;
    session.jobs.delete(job.id);
    session.history.unshift(publicHistory(job));
    session.history = session.history.slice(0, HISTORY_LIMIT);
  }, 3500);
}

async function processJob(job) {
  job.status = "processing";
  job.progress = 3;
  try {
    for (let index = 0; index < job.files.length; index += 1) {
      if (job.cancelRequested) throw new CancelledError("任务已取消");
      const file = job.files[index];
      job.progress = Math.max(
        job.progress,
        Math.round((index / job.files.length) * 90 + 5),
      );
      const printablePath = await convertToPrintable(file, job);
      if (job.cancelRequested) throw new CancelledError("任务已取消");
      file.status = "printing";
      job.progress = Math.round(((index + 0.45) / job.files.length) * 90 + 5);

      const { stdout } = await run(
        "lp",
        [
          "-d",
          job.printer,
          "-n",
          String(job.copies),
          "-t",
          file.name.slice(0, 120),
          "-o",
          "job-sheets=none",
          "-o",
          `print-color-mode=${
            job.colorMode === "color" ? "color" : "monochrome"
          }`,
          printablePath,
        ],
        { timeout: 30_000 },
      );
      const cupsJobId = parseCupsJobId(stdout);
      if (cupsJobId) job.cupsJobIds.push(cupsJobId);
      await waitForCups(job, cupsJobId);
      file.status = "completed";
      job.progress = Math.round(((index + 1) / job.files.length) * 95);
    }
    job.progress = 100;
    job.status = "completed";
  } catch (error) {
    if (error instanceof CancelledError || job.cancelRequested) {
      job.status = "cancelled";
      job.error = "任务已取消";
    } else {
      job.status = "failed";
      job.error = friendlyPrintError(error);
      const currentFile = job.files.find((file) =>
        ["converting", "printing"].includes(file.status),
      );
      if (currentFile) currentFile.status = "failed";
    }
  } finally {
    job.finishedAt = new Date().toISOString();
    await removeDirectory(job.tempDir);
    scheduleFinalization(job);
  }
}

function pumpQueue() {
  while (activeWorkers < PRINT_WORKERS && pendingJobs.length > 0) {
    const job = pendingJobs.shift();
    activeWorkers += 1;
    processJob(job)
      .catch(() => {})
      .finally(() => {
        activeWorkers -= 1;
        pumpQueue();
      });
  }
}

function enqueue(job) {
  pendingJobs.push(job);
  pumpQueue();
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "64kb" }));
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), usb=()",
  );
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", queued: pendingJobs.length, workers: activeWorkers });
});

app.use((req, res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  const existing = cookies.pa_session;
  const sessionId = /^[a-f0-9]{36}$/.test(existing || "")
    ? existing
    : createSessionId();
  if (sessionId !== existing) {
    res.append(
      "Set-Cookie",
      `pa_session=${sessionId}; Path=/; HttpOnly; SameSite=Strict`,
    );
  }
  req.printSession = getSession(sessionId);
  next();
});

app.get("/api/bootstrap", async (req, res) => {
  const printerState = await discoverPrinters();
  res.json({
    sessionId: req.printSession.id.slice(-6).toUpperCase(),
    printers: printerState.printers,
    defaultPrinter: printerState.defaultPrinter,
    activeJobs: Array.from(req.printSession.jobs.values()).map(publicJob),
    history: req.printSession.history,
    limits: { maxFileSizeMb: MAX_FILE_SIZE_MB, maxFiles: MAX_FILES },
  });
});

app.get("/api/jobs", (req, res) => {
  res.json({
    activeJobs: Array.from(req.printSession.jobs.values()).map(publicJob),
    history: req.printSession.history,
  });
});

app.post(
  "/api/jobs",
  prepareBatch,
  (req, res, next) => {
    upload.array("documents", MAX_FILES)(req, res, (error) => {
      if (!error) {
        next();
        return;
      }
      removeDirectory(
        path.join(TEMP_ROOT, req.printSession.id, req.uploadBatchId),
      ).finally(() => {
        if (error instanceof multer.MulterError) {
          if (error.code === "LIMIT_FILE_SIZE") {
            res.status(413).json({
              error: `单个文件不能超过 ${MAX_FILE_SIZE_MB} MB`,
            });
            return;
          }
          if (error.code === "LIMIT_FILE_COUNT") {
            res.status(413).json({
              error: `单次最多提交 ${MAX_FILES} 个文件`,
            });
            return;
          }
        }
        res.status(400).json({ error: error.message || "文件上传失败" });
      });
    });
  },
  async (req, res) => {
    const tempDir = path.join(
      TEMP_ROOT,
      req.printSession.id,
      req.uploadBatchId,
    );
    try {
      if (!req.files?.length) throw new Error("请至少选择一个文件");
      const settings = parseSettings(req.body.settings);
      const printerState = await discoverPrinters({ fresh: true });
      const isKnownPrinter = printerState.printers.some(
        (printer) =>
          printer.name === settings.printer && printer.status === "online",
      );
      if (
        !isKnownPrinter &&
        process.env.ALLOW_UNLISTED_PRINTERS !== "true"
      ) {
        throw new Error(
          printerState.printers.length
            ? "所选打印机当前不可用，请刷新后重试"
            : "服务器未发现可用打印机，请联系管理员配置 CUPS",
        );
      }

      const job = {
        id: crypto.randomUUID(),
        sessionId: req.printSession.id,
        createdAt: new Date().toISOString(),
        finishedAt: null,
        printer: settings.printer,
        colorMode: settings.colorMode,
        copies: settings.copies,
        progress: 1,
        status: "queued",
        tempDir,
        cancelRequested: false,
        cupsJobIds: [],
        files: req.files.map((file) => ({
          name: normalizeOriginalName(file.originalname),
          size: file.size,
          status: "waiting",
          storedPath: file.path,
        })),
      };
      req.printSession.jobs.set(job.id, job);
      enqueue(job);
      res.status(202).json({ job: publicJob(job) });
    } catch (error) {
      await removeDirectory(tempDir);
      res.status(400).json({
        error:
          error instanceof Error ? error.message : "打印任务提交失败",
      });
    }
  },
);

app.post("/api/jobs/:jobId/cancel", async (req, res) => {
  const job = req.printSession.jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "未找到该会话中的任务" });
    return;
  }
  job.cancelRequested = true;
  await Promise.all(
    job.cupsJobIds.map((jobId) =>
      run("cancel", [jobId], { timeout: 5000 }).catch(() => {}),
    ),
  );
  res.status(202).json({ status: "cancelling" });
});

app.use((error, _req, res, _next) => {
  void _next;
  res.status(500).json({
    error:
      process.env.NODE_ENV === "development"
        ? error.message
        : "打印服务发生异常，请稍后重试",
  });
});

const sweep = setInterval(async () => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [sessionId, session] of sessions.entries()) {
    if (session.lastSeen >= cutoff || session.jobs.size > 0) continue;
    sessions.delete(sessionId);
    await removeDirectory(path.join(TEMP_ROOT, sessionId));
  }
}, 10 * 60 * 1000);
sweep.unref();

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Print Assistant API listening on ${PORT}`);
  });
}

export { app, discoverPrinters, publicJob };
