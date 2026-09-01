"use client";

import {
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  FileImage,
  FileText,
  FileType2,
  History,
  LockKeyhole,
  Minus,
  Network,
  Palette,
  Plus,
  Printer,
  RotateCw,
  ShieldCheck,
  Star,
  Trash2,
  UploadCloud,
  Wifi,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type PrinterInfo = {
  name: string;
  location: string;
  isDefault?: boolean;
  color?: boolean | null;
  status: "online" | "offline";
};

type SelectedFile = {
  id: string;
  file: File;
};

type JobFile = {
  name: string;
  size: number;
  status: "waiting" | "converting" | "printing" | "completed" | "failed";
};

type PrintJob = {
  id: string;
  createdAt: string;
  printer: string;
  colorMode: "color" | "monochrome";
  copies: number;
  progress: number;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  files: JobFile[];
  error?: string;
};

type HistoryJob = Omit<PrintJob, "progress"> & {
  finishedAt: string;
};

const ACCEPTED_EXTENSIONS = /\.(doc|docx|pdf|jpe?g|png)$/i;
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_FILES = 50;

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes > 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function fileIcon(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension === "pdf") {
    return <FileText aria-hidden="true" />;
  }
  if (extension === "jpg" || extension === "jpeg" || extension === "png") {
    return <FileImage aria-hidden="true" />;
  }
  return <FileType2 aria-hidden="true" />;
}

function statusLabel(status: PrintJob["status"]) {
  return {
    queued: "等待中",
    processing: "打印中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  }[status];
}

export default function PrintAssistant() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState("");
  const [defaultPrinter, setDefaultPrinter] = useState("");
  const [colorMode, setColorMode] = useState<"color" | "monochrome">(
    "monochrome",
  );
  const [copies, setCopies] = useState(1);
  const [activeJobs, setActiveJobs] = useState<PrintJob[]>([]);
  const [history, setHistory] = useState<HistoryJob[]>([]);
  const [sessionId, setSessionId] = useState("······");
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [serviceConnected, setServiceConnected] = useState(false);
  const [serviceError, setServiceError] = useState(
    "正在连接本机打印服务…",
  );

  const totalSize = useMemo(
    () => files.reduce((sum, item) => sum + item.file.size, 0),
    [files],
  );

  const selectedPrinterInfo = printers.find(
    (printer) => printer.name === selectedPrinter,
  );

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const incomingFiles = Array.from(incoming);
    const rejected: string[] = [];

    setFiles((current) => {
      const seen = new Set(
        current.map(
          (item) =>
            `${item.file.name}-${item.file.size}-${item.file.lastModified}`,
        ),
      );
      const next = [...current];

      for (const file of incomingFiles) {
        const signature = `${file.name}-${file.size}-${file.lastModified}`;
        if (!ACCEPTED_EXTENSIONS.test(file.name)) {
          rejected.push(`${file.name}（格式不支持）`);
          continue;
        }
        if (file.size > MAX_FILE_SIZE) {
          rejected.push(`${file.name}（超过 100 MB）`);
          continue;
        }
        if (seen.has(signature)) continue;
        if (next.length >= MAX_FILES) {
          rejected.push("单次最多选择 50 个文件");
          break;
        }
        seen.add(signature);
        next.push({
          id: `${signature}-${crypto.randomUUID()}`,
          file,
        });
      }
      return next;
    });

    if (rejected.length) {
      setNotice(`未添加：${rejected.slice(0, 2).join("、")}`);
    } else {
      setNotice("");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    async function bootstrap() {
      try {
        const response = await fetch("/api/bootstrap", {
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error("API unavailable");
        const data = await response.json();
        if (!alive) return;
        const nextPrinters = (data.printers ?? []) as PrinterInfo[];
        const storedDefault = localStorage.getItem("print-assistant-default");
        const validStored = nextPrinters.some(
          (printer) => printer.name === storedDefault,
        );
        const initialPrinter =
          (validStored && storedDefault) ||
          data.defaultPrinter ||
          nextPrinters[0]?.name ||
          "";
        setPrinters(nextPrinters);
        setDefaultPrinter(validStored ? storedDefault! : initialPrinter);
        setSelectedPrinter((current) =>
          nextPrinters.some((printer) => printer.name === current)
            ? current
            : initialPrinter,
        );
        if (
          nextPrinters.find((printer) => printer.name === initialPrinter)
            ?.color === false
        ) {
          setColorMode("monochrome");
        }
        setSessionId(data.sessionId ?? "本次会话");
        setActiveJobs(data.activeJobs ?? []);
        setHistory(data.history ?? []);
        setServiceConnected(true);
        setServiceError(
          nextPrinters.length
            ? ""
            : "打印服务已连接，但 CUPS 未发现可用打印机",
        );
      } catch {
        if (!alive) return;
        setPrinters([]);
        setSelectedPrinter("");
        setDefaultPrinter("");
        setServiceConnected(false);
        setServiceError("打印服务未连接，正在自动重试");
      }
    }
    bootstrap();
    const retry = window.setInterval(bootstrap, 5000);
    return () => {
      alive = false;
      window.clearInterval(retry);
    };
  }, []);

  useEffect(() => {
    if (!serviceConnected) return;
    const poll = window.setInterval(async () => {
      try {
        const response = await fetch("/api/jobs", {
          credentials: "same-origin",
        });
        if (!response.ok) return;
        const data = await response.json();
        setActiveJobs(data.activeJobs ?? []);
        setHistory(data.history ?? []);
      } catch {
        setServiceConnected(false);
        setServiceError("打印服务连接中断，正在自动重试");
      }
    }, 1200);
    return () => window.clearInterval(poll);
  }, [serviceConnected]);

  function removeFile(id: string) {
    setFiles((current) => current.filter((item) => item.id !== id));
  }

  function chooseDefaultPrinter() {
    if (!selectedPrinter) return;
    localStorage.setItem("print-assistant-default", selectedPrinter);
    setDefaultPrinter(selectedPrinter);
    setNotice(`已将“${selectedPrinter}”设为本机默认打印机`);
  }

  async function submitPrintJob() {
    if (!files.length || !selectedPrinter || isSubmitting) return;
    setIsSubmitting(true);
    setNotice("");

    try {
      const form = new FormData();
      form.append(
        "settings",
        JSON.stringify({ printer: selectedPrinter, colorMode, copies }),
      );
      files.forEach(({ file }) => form.append("documents", file, file.name));
      const response = await fetch("/api/jobs", {
        method: "POST",
        body: form,
        credentials: "same-origin",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "提交失败，请稍后重试");
      }
      setActiveJobs((current) => [data.job, ...current]);
      setFiles([]);
      if (inputRef.current) inputRef.current.value = "";
      setNotice("打印任务已安全提交");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "提交失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function cancelJob(jobId: string) {
    try {
      const response = await fetch(`/api/jobs/${jobId}/cancel`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error();
      setNotice("已发送取消请求");
    } catch {
      setNotice("任务暂时无法取消，请检查打印机队列");
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Printer aria-hidden="true" />
          </span>
          <span>
            <strong>打印助手</strong>
            <small>PRINT DESK</small>
          </span>
        </div>

        <nav aria-label="页面导航">
          <button type="button" className="nav-active">
            打印工作台
          </button>
          <button
            type="button"
            onClick={() =>
              document
                .getElementById("history")
                ?.scrollIntoView({ behavior: "smooth" })
            }
          >
            本次记录
          </button>
        </nav>

        <div className="session-area">
          <span
            className={`service-status ${
              serviceConnected
                ? printers.length
                  ? ""
                  : "is-warning"
                : "is-offline"
            }`}
          >
            <i />
            {!serviceConnected
              ? "服务未连接"
              : printers.length
                ? "服务在线"
                : "未发现打印机"}
          </span>
          <span className="session-chip" title="不同会话之间数据隔离">
            <LockKeyhole aria-hidden="true" />
            会话 {sessionId.slice(-6)}
          </span>
        </div>
      </header>

      <div className="page-wrap">
        <section className="hero-row">
          <div>
            <span className="eyebrow">
              <ShieldCheck aria-hidden="true" />
              内网安全打印
            </span>
            <h1>今天要打印什么？</h1>
            <p>批量添加资料，确认打印设置后一次提交。</p>
          </div>
          <div className="privacy-note">
            <div className="privacy-icon">
              <ShieldCheck aria-hidden="true" />
            </div>
            <div>
              <strong>文件打印后即删除</strong>
              <span>仅保留本次会话的任务信息，不提供文件查看或下载</span>
            </div>
          </div>
        </section>

        <section className="work-grid" aria-label="创建打印任务">
          <article className="panel upload-panel">
            <div className="panel-heading">
              <div>
                <span className="step">01</span>
                <div>
                  <h2>添加打印文件</h2>
                  <p>支持 Word、PDF、JPEG、PNG</p>
                </div>
              </div>
              {files.length > 0 && (
                <button
                  className="text-button danger"
                  type="button"
                  onClick={() => setFiles([])}
                >
                  <Trash2 aria-hidden="true" />
                  清空
                </button>
              )}
            </div>

            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              multiple
              accept=".doc,.docx,.pdf,.jpg,.jpeg,.png"
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                event.target.value = "";
              }}
            />

            <button
              className={`drop-zone ${isDragging ? "is-dragging" : ""}`}
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                addFiles(event.dataTransfer.files);
              }}
            >
              <span className="upload-illustration">
                <UploadCloud aria-hidden="true" />
              </span>
              <span>
                <strong>拖拽文件到这里，或点击选择</strong>
                <small>单个文件最大 100 MB，单次最多 50 个</small>
              </span>
              <em>选择文件</em>
            </button>

            {files.length ? (
              <div className="file-list">
                <div className="file-list-summary">
                  <span>
                    已选择 <strong>{files.length}</strong> 个文件
                  </span>
                  <span>共 {formatBytes(totalSize)}</span>
                </div>
                <div className="file-scroll">
                  {files.map(({ id, file }) => (
                    <div className="file-row" key={id}>
                      <span
                        className={`file-icon file-${file.name
                          .split(".")
                          .pop()
                          ?.toLowerCase()}`}
                      >
                        {fileIcon(file.name)}
                      </span>
                      <span className="file-meta">
                        <strong title={file.name}>{file.name}</strong>
                        <small>{formatBytes(file.size)}</small>
                      </span>
                      <span className="ready-tag">
                        <Check aria-hidden="true" />
                        就绪
                      </span>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`移除 ${file.name}`}
                        onClick={() => removeFile(id)}
                      >
                        <X aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="empty-hint">
                <FileText aria-hidden="true" />
                <span>还没有选择文件</span>
              </div>
            )}
          </article>

          <aside className="panel settings-panel">
            <div className="panel-heading">
              <div>
                <span className="step">02</span>
                <div>
                  <h2>打印设置</h2>
                  <p>选择目标打印机和输出方式</p>
                </div>
              </div>
            </div>

            <div className="form-stack">
              <div className="field">
                <div className="field-label">
                  <label htmlFor="printer-select">网络打印机</label>
                  <span>
                    <Wifi aria-hidden="true" />
                    {printers.filter((item) => item.status === "online").length}{" "}
                    台可用
                  </span>
                </div>
                <div className="select-wrap">
                  <Network aria-hidden="true" />
                  <select
                    id="printer-select"
                    value={selectedPrinter}
                    onChange={(event) => {
                      const nextPrinter = printers.find(
                        (printer) => printer.name === event.target.value,
                      );
                      setSelectedPrinter(event.target.value);
                      if (nextPrinter?.color === false) {
                        setColorMode("monochrome");
                      }
                    }}
                  >
                    {printers.length === 0 && (
                      <option value="">未发现打印机</option>
                    )}
                    {printers.map((printer) => (
                      <option
                        key={printer.name}
                        value={printer.name}
                        disabled={printer.status === "offline"}
                      >
                        {printer.name}
                        {printer.status === "offline" ? "（离线）" : ""}
                      </option>
                    ))}
                  </select>
                  <ChevronDown aria-hidden="true" className="select-chevron" />
                </div>
                {serviceError && (
                  <div
                    className={`service-alert ${
                      serviceConnected ? "is-warning" : "is-error"
                    }`}
                    role="status"
                  >
                    <CircleAlert aria-hidden="true" />
                    <span>{serviceError}</span>
                  </div>
                )}
                {selectedPrinterInfo && (
                  <div className="printer-detail">
                    <span>
                      <i />
                      在线 · {selectedPrinterInfo.location || "位置未设置"}
                    </span>
                    <button
                      type="button"
                      className={
                        selectedPrinter === defaultPrinter
                          ? "default-button is-default"
                          : "default-button"
                      }
                      onClick={chooseDefaultPrinter}
                    >
                      <Star
                        aria-hidden="true"
                        fill={
                          selectedPrinter === defaultPrinter
                            ? "currentColor"
                            : "none"
                        }
                      />
                      {selectedPrinter === defaultPrinter
                        ? "本机默认"
                        : "设为默认"}
                    </button>
                  </div>
                )}
              </div>

              <div className="field">
                <div className="field-label">
                  <label>颜色</label>
                </div>
                <div className="segmented" role="group" aria-label="打印颜色">
                  <button
                    type="button"
                    className={colorMode === "monochrome" ? "active" : ""}
                    onClick={() => setColorMode("monochrome")}
                  >
                    <span className="mono-dot" />
                    黑白
                  </button>
                  <button
                    type="button"
                    className={colorMode === "color" ? "active" : ""}
                    onClick={() => setColorMode("color")}
                    disabled={
                      !selectedPrinterInfo ||
                      selectedPrinterInfo.color === false
                    }
                    title={
                      !selectedPrinterInfo
                        ? "请先选择打印机"
                        : selectedPrinterInfo.color === false
                        ? "当前打印机仅支持黑白"
                        : undefined
                    }
                  >
                    <Palette aria-hidden="true" />
                    彩色
                  </button>
                </div>
              </div>

              <div className="field copies-field">
                <div>
                  <label htmlFor="copies">打印份数</label>
                  <small>每个文件的输出份数</small>
                </div>
                <div className="stepper">
                  <button
                    type="button"
                    aria-label="减少份数"
                    onClick={() => setCopies((value) => Math.max(1, value - 1))}
                    disabled={copies <= 1}
                  >
                    <Minus aria-hidden="true" />
                  </button>
                  <input
                    id="copies"
                    value={copies}
                    inputMode="numeric"
                    aria-label="打印份数"
                    onChange={(event) => {
                      const next = Number.parseInt(event.target.value, 10);
                      setCopies(Number.isFinite(next) ? Math.min(99, next) : 1);
                    }}
                  />
                  <button
                    type="button"
                    aria-label="增加份数"
                    onClick={() => setCopies((value) => Math.min(99, value + 1))}
                    disabled={copies >= 99}
                  >
                    <Plus aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>

            <div className="submit-area">
              <div className="job-summary">
                <span>本次任务</span>
                <strong>
                  {files.length} 个文件 · {copies} 份 ·{" "}
                  {colorMode === "color" ? "彩色" : "黑白"}
                </strong>
              </div>
              <button
                type="button"
                className="submit-button"
                onClick={submitPrintJob}
                disabled={
                  !files.length ||
                  !selectedPrinter ||
                  !serviceConnected ||
                  selectedPrinterInfo?.status === "offline" ||
                  isSubmitting
                }
              >
                {isSubmitting ? (
                  <>
                    <RotateCw className="spin" aria-hidden="true" />
                    正在提交
                  </>
                ) : (
                  <>
                    <Printer aria-hidden="true" />
                    提交打印
                    {files.length > 0 && <span>{files.length}</span>}
                  </>
                )}
              </button>
              <p>
                <LockKeyhole aria-hidden="true" />
                文件通过内网传输，不会生成预览与下载链接
              </p>
            </div>
          </aside>
        </section>

        {notice && (
          <div className="toast" role="status">
            <CircleAlert aria-hidden="true" />
            <span>{notice}</span>
            <button
              type="button"
              aria-label="关闭提示"
              onClick={() => setNotice("")}
            >
              <X aria-hidden="true" />
            </button>
          </div>
        )}

        <section className="queue-section" aria-labelledby="queue-title">
          <div className="section-heading">
            <div>
              <span className="section-icon">
                <Clock3 aria-hidden="true" />
              </span>
              <div>
                <h2 id="queue-title">当前打印进度</h2>
                <p>任务会依次进入打印队列</p>
              </div>
            </div>
            {activeJobs.length > 0 && (
              <span className="queue-count">
                {activeJobs.length} 个任务处理中
              </span>
            )}
          </div>

          {activeJobs.length ? (
            <div className="job-list">
              {activeJobs.map((job) => (
                <article className="job-card" key={job.id}>
                  <div className="job-card-top">
                    <div className="job-title">
                      <span className="job-printer-icon">
                        <Printer aria-hidden="true" />
                      </span>
                      <div>
                        <strong>
                          {job.files.length} 个文件 · {job.printer}
                        </strong>
                        <small>
                          {formatTime(job.createdAt)} · {job.copies} 份 ·{" "}
                          {job.colorMode === "color" ? "彩色" : "黑白"}
                        </small>
                      </div>
                    </div>
                    <span className={`job-status status-${job.status}`}>
                      {job.status === "processing" && (
                        <RotateCw className="spin" aria-hidden="true" />
                      )}
                      {statusLabel(job.status)}
                    </span>
                  </div>
                  <div className="progress-row">
                    <div className="progress-track">
                      <span style={{ width: `${job.progress}%` }} />
                    </div>
                    <strong>{job.progress}%</strong>
                  </div>
                  <div className="job-files">
                    {job.files.slice(0, 3).map((file) => (
                      <span key={file.name} title={file.name}>
                        {file.status === "completed" ? (
                          <CheckCircle2 aria-hidden="true" />
                        ) : (
                          <FileText aria-hidden="true" />
                        )}
                        {file.name}
                      </span>
                    ))}
                    {job.files.length > 3 && (
                      <span>另有 {job.files.length - 3} 个文件</span>
                    )}
                  </div>
                  {(job.status === "queued" ||
                    job.status === "processing") && (
                    <button
                      type="button"
                      className="cancel-button"
                      onClick={() => cancelJob(job.id)}
                    >
                      取消任务
                    </button>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="queue-empty">
              <span>
                <Printer aria-hidden="true" />
              </span>
              <div>
                <strong>当前没有打印任务</strong>
                <small>提交后可在这里查看转换、排队和打印状态</small>
              </div>
            </div>
          )}
        </section>

        <section className="history-section" id="history">
          <div className="section-heading">
            <div>
              <span className="section-icon neutral">
                <History aria-hidden="true" />
              </span>
              <div>
                <h2>本次会话记录</h2>
                <p>关闭会话或超时后自动清除，仅显示任务信息</p>
              </div>
            </div>
            <span className="privacy-label">
              <ShieldCheck aria-hidden="true" />
              文件内容不可查看
            </span>
          </div>

          {history.length ? (
            <div className="history-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>提交时间</th>
                    <th>文件</th>
                    <th>打印机</th>
                    <th>设置</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((job) => (
                    <tr key={job.id}>
                      <td>{formatTime(job.createdAt)}</td>
                      <td>
                        <div className="history-file">
                          <span>{fileIcon(job.files[0]?.name ?? "")}</span>
                          <div>
                            <strong title={job.files[0]?.name}>
                              {job.files[0]?.name}
                            </strong>
                            <small>
                              {job.files.length > 1
                                ? `等 ${job.files.length} 个文件`
                                : formatBytes(job.files[0]?.size ?? 0)}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td>{job.printer}</td>
                      <td>
                        {job.colorMode === "color" ? "彩色" : "黑白"} ·{" "}
                        {job.copies} 份
                      </td>
                      <td>
                        <span className={`table-status status-${job.status}`}>
                          {job.status === "completed" && (
                            <CheckCircle2 aria-hidden="true" />
                          )}
                          {statusLabel(job.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="history-empty">本次会话还没有历史记录</div>
          )}
        </section>

        <footer>
          <span>
            <ShieldCheck aria-hidden="true" />
            内网独立部署 · 会话数据隔离
          </span>
          <span>打印助手 v1.0</span>
        </footer>
      </div>
    </main>
  );
}
