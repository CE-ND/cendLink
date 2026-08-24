<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useWorkspaceSession } from "../../workspace/composables/useWorkspaceSession.js";
import AppSelect from "../../../components/ui/AppSelect.vue";
import {
  Search,
  RotateCw,
  Play,
  Square,
  ArrowDownToLine,
  Terminal,
  Copy,
  Check,
} from "@lucide/vue";
import { usePageEntrance } from "../../../composables/usePageEntrance.js";

const CONTAINER_LIST_COMMAND =
  "docker ps -a --format '{{.ID}}|||{{.Names}}|||{{.Image}}|||{{.Status}}|||{{.Ports}}|||{{.CreatedAt}}'";
// 内存占用。{{.ID}} 与 docker ps 的 {{.ID}} 同为 12 位短 ID，可以直接当键对上。
// 不加 -a：docker stats 默认只报运行中的容器，已停止的本来就不占内存。
const CONTAINER_STATS_FORMAT = "'{{.ID}}|||{{.MemUsage}}|||{{.MemPerc}}'";
const CONTAINER_STATS_STREAM_COMMAND = `docker stats --format ${CONTAINER_STATS_FORMAT}`;
const CONTAINER_STATS_SNAPSHOT_COMMAND = `docker stats --no-stream --format ${CONTAINER_STATS_FORMAT}`;
const MAX_LOG_LINES = 5000;
const logTailOptions = [
  { value: 100, label: "100" },
  { value: 300, label: "300" },
  { value: 1000, label: "1000" },
];

const { form, result, needsRetest, hasElectronBridge, workspaceSettings } =
  useWorkspaceSession();

const containers = ref([]);
const selectedContainerId = ref("");
const searchText = ref("");
const logTail = ref(300);
const logOutput = ref("");
const listError = ref("");
const logError = ref("");
const streamStatus = ref("");
const isLoadingContainers = ref(false);
const isLoadingLogs = ref(false);
const isFollowing = ref(false);
const isAutoScrollPaused = ref(false);
const followSessionId = ref("");
const openActionMenuId = ref("");
const actionMenuStyle = ref({});
const actionPendingId = ref("");
const logBodyRef = ref(null);
const router = useRouter();
const pageRef = ref(null);
usePageEntrance(pageRef);

let unsubscribeStream = null;

// 每个容器的内存占用，键为 docker 短 ID。常驻一条 docker stats 流持续写入，
// 每秒一拍；流式不可用时退回一次性快照。
const statsById = ref(new Map());
const statsSessionId = ref("");
let unsubscribeStats = null;
// docker stats 按行吐，chunk 可能从半行处切断，未闭合的尾巴留到下一次拼。
let statsLineBuffer = "";
// 防止 await 期间被重复触发，开出两条后端会话。
let statsStarting = false;
// 组件是否仍挂载。用于处理「开流的 await 期间用户切走页面」的竞态。
let viewActive = true;

// 复制当前日志到剪贴板，短暂闪“已复制”。
const copiedLogs = ref(false);
let copiedLogsTimer = null;

async function copyLogs() {
  if (!logOutput.value) {
    return;
  }

  try {
    await navigator.clipboard.writeText(String(logOutput.value));
    copiedLogs.value = true;
    clearTimeout(copiedLogsTimer);
    copiedLogsTimer = setTimeout(() => {
      copiedLogs.value = false;
    }, 1400);
  } catch {
    // 剪贴板不可用时静默忽略。
  }
}

const canQueryDocker = computed(() => {
  return Boolean(
    hasElectronBridge.value && result.value?.ok && !needsRetest.value
  );
});

const connectionHint = computed(() => {
  if (!hasElectronBridge.value) {
    return "请通过 Electron 模式启动应用后再查看容器。";
  }

  if (!result.value?.ok) {
    return "请先在服务器页完成连接测试。";
  }

  if (needsRetest.value) {
    return "服务器连接信息已变更，请重新测试连接。";
  }

  return "";
});

const filteredContainers = computed(() => {
  const keyword = searchText.value.trim().toLowerCase();

  if (!keyword) {
    return containers.value;
  }

  return containers.value.filter((container) => {
    return [
      container.id,
      container.name,
      container.image,
      container.status,
      container.ports,
    ]
      .join(" ")
      .toLowerCase()
      .includes(keyword);
  });
});

const selectedContainer = computed(() => {
  return (
    containers.value.find(
      (container) => container.id === selectedContainerId.value
    ) || null
  );
});

// 日志面板头部的副文：镜像 · 端口 · 内存，取不到内存就自然少一段。
const selectedContainerMeta = computed(() => {
  const container = selectedContainer.value;

  if (!container) {
    return "选择左侧容器后查看日志";
  }

  const stats = statsById.value.get(container.id);

  return [
    container.image,
    container.ports || "未暴露端口",
    stats?.memory ? `内存 ${stats.memory}` : "",
    stats?.percent ? `占服务器 ${stats.percent}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
});

const runningCount = computed(() => {
  return containers.value.filter((container) => isRunning(container.status))
    .length;
});

const logPlaceholder = computed(() => {
  if (!selectedContainer.value) {
    return "选择一个容器查看日志";
  }

  if (isLoadingLogs.value) {
    return "正在读取日志...";
  }

  if (isFollowing.value && !logOutput.value) {
    return "正在等待新日志…";
  }

  if (!logOutput.value && !logError.value) {
    return "该容器暂无日志输出";
  }

  return "";
});

const hasLogContent = computed(() => Boolean(logOutput.value));

const displayLogLines = computed(() => {
  return String(logOutput.value || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line, index) => formatLogLine(line, index));
});

onMounted(() => {
  void refreshContainers();
  void startStatsStream();
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("scroll", closeActionMenu, true);
  window.addEventListener("resize", closeActionMenu);
  window.addEventListener("click", closeActionMenu);
});

onBeforeUnmount(() => {
  viewActive = false;
  void stopFollowing({ silent: true });
  void stopStatsStream();
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  clearTimeout(copiedLogsTimer);
  window.removeEventListener("scroll", closeActionMenu, true);
  window.removeEventListener("resize", closeActionMenu);
  window.removeEventListener("click", closeActionMenu);
});

// 连接可用性变化时联动内存流：接上就开，断开就停并清掉旧数字。
watch(canQueryDocker, (usable) => {
  if (usable) {
    void startStatsStream();
    return;
  }

  void stopStatsStream();
  statsById.value.clear();
});

// 窗口切到后台时停掉常驻流，别让一条 SSH 连接在看不见的地方一直挂着。
function handleVisibilityChange() {
  if (document.hidden) {
    void stopStatsStream();
    return;
  }

  void startStatsStream();
}

async function refreshContainers() {
  if (!canQueryDocker.value) {
    listError.value = connectionHint.value;
    return;
  }

  isLoadingContainers.value = true;
  listError.value = "";

  try {
    const response = await executeDockerCommand(CONTAINER_LIST_COMMAND);

    if (!response.ok) {
      throw new Error(
        response.message || response.stderr || "读取容器列表失败"
      );
    }

    containers.value = parseContainerRows(response.stdout);

    // docker stats 不会再报已删除的容器，跟着列表把残留项清掉。
    const liveIds = new Set(containers.value.map((item) => item.id));
    statsById.value.forEach((_value, id) => {
      if (!liveIds.has(id)) {
        statsById.value.delete(id);
      }
    });

    if (
      selectedContainerId.value &&
      !containers.value.some((item) => item.id === selectedContainerId.value)
    ) {
      selectedContainerId.value = "";
      logOutput.value = "";
    }

    if (
      openActionMenuId.value &&
      !containers.value.some((item) => item.id === openActionMenuId.value)
    ) {
      openActionMenuId.value = "";
    }
  } catch (error) {
    listError.value = error?.message || String(error);
  } finally {
    isLoadingContainers.value = false;
  }
}

async function selectContainer(container) {
  openActionMenuId.value = "";
  selectedContainerId.value = container.id;
  isAutoScrollPaused.value = false;
  await loadContainerLogs(container);
}

function toggleContainerActionMenu(containerId, event) {
  if (openActionMenuId.value === containerId) {
    openActionMenuId.value = "";
    return;
  }

  // 菜单通过 Teleport 渲染到 body，按触发按钮的位置以 fixed 定位，
  // 避免被容器列表的 overflow 裁剪。
  const rect = event.currentTarget.getBoundingClientRect();
  actionMenuStyle.value = {
    position: "fixed",
    top: `${rect.bottom + 4}px`,
    right: `${Math.max(8, window.innerWidth - rect.right)}px`,
  };
  openActionMenuId.value = containerId;
}

function closeActionMenu() {
  if (openActionMenuId.value) {
    openActionMenuId.value = "";
  }
}

async function openNginxConfig(container) {
  if (!isNginxContainer(container)) {
    return;
  }

  await stopFollowing({ silent: true });
  openActionMenuId.value = "";
  selectedContainerId.value = container.id;
  isAutoScrollPaused.value = false;

  router.push({
    name: "nginx-config",
    params: {
      containerId: container.id,
    },
    query: {
      name: container.name,
      image: container.image,
      status: container.status,
      ports: container.ports,
    },
  });
}

function startContainer(container) {
  return runContainerLifecycle(container, "start");
}

function stopContainer(container) {
  return runContainerLifecycle(container, "stop");
}

// 启停容器:执行 docker start/stop，成功后刷新列表反映最新状态。
async function runContainerLifecycle(container, action) {
  openActionMenuId.value = "";

  if (!canQueryDocker.value) {
    listError.value = connectionHint.value;
    return;
  }

  // 停止正在跟随的容器前先断开日志流，避免容器退出后流报错。
  if (action === "stop" && selectedContainerId.value === container.id) {
    await stopFollowing({ silent: true });
  }

  actionPendingId.value = container.id;
  listError.value = "";

  try {
    const response = await executeDockerCommand(
      `docker ${action} ${shellQuote(container.id)}`
    );

    if (!response.ok) {
      throw new Error(
        response.message || response.stderr || `docker ${action} 执行失败`
      );
    }

    await refreshContainers();

    // 操作的是当前选中的容器且未在跟随时，刷新日志反映最新状态。
    if (selectedContainerId.value === container.id && !isFollowing.value) {
      await loadContainerLogs();
    }
  } catch (error) {
    listError.value = error?.message || String(error);
  } finally {
    actionPendingId.value = "";
  }
}

async function loadContainerLogs(container = selectedContainer.value) {
  if (!container || !canQueryDocker.value) {
    logError.value = connectionHint.value;
    return;
  }

  await stopFollowing({ silent: true });
  isLoadingLogs.value = true;
  logError.value = "";
  streamStatus.value = "";
  logOutput.value = "";
  isAutoScrollPaused.value = false;

  try {
    const response = await executeDockerCommand(
      buildDockerLogsCommand(container, false)
    );

    if (selectedContainerId.value !== container.id) {
      return;
    }

    logOutput.value = mergeCommandOutput(response);

    if (!response.ok) {
      logError.value = response.message || "读取日志失败";
    }

    await scrollLogToBottom();
  } catch (error) {
    logError.value = error?.message || String(error);
  } finally {
    isLoadingLogs.value = false;
  }
}

async function toggleFollowing() {
  if (isFollowing.value) {
    await stopFollowing();
    return;
  }

  await startFollowing();
}

async function startFollowing() {
  const container = selectedContainer.value;
  const ssh = getSshBridge();

  if (!container || !canQueryDocker.value) {
    logError.value = connectionHint.value;
    return;
  }

  if (!hasLogStreamBridge(ssh)) {
    logError.value =
      "当前 Electron 主进程还没有流式日志能力，请重启桌面窗口后再试。";
    return;
  }

  await stopFollowing({ silent: true });
  logError.value = "";
  streamStatus.value = "正在启动日志跟随...";
  logOutput.value = "";
  isAutoScrollPaused.value = false;
  isFollowing.value = true;

  unsubscribeStream = ssh.onCommandStreamEvent(handleStreamEvent);

  try {
    const response = await ssh.startCommandStream(
      { ...form },
      buildDockerLogsCommand(container, true)
    );

    if (!response.ok) {
      throw new Error(response.message || "启动日志跟随失败");
    }

    followSessionId.value = response.id;
  } catch (error) {
    cleanupStreamListener();
    isFollowing.value = false;
    followSessionId.value = "";
    streamStatus.value = "";
    logError.value = formatStreamError(error);
  }
}

async function stopFollowing(options = {}) {
  const sessionId = followSessionId.value;
  const ssh = getSshBridge();

  cleanupStreamListener();
  followSessionId.value = "";

  if (!sessionId) {
    isFollowing.value = false;
    return;
  }

  try {
    await ssh?.stopCommandStream?.(sessionId);
  } catch {
    // 停止失败时仍然清理前端状态，避免界面卡在跟随中。
  }

  isFollowing.value = false;

  if (!options.silent) {
    streamStatus.value = "已停止跟随日志";
  }
}

function handleStreamEvent(event) {
  if (!event?.id || event.id !== followSessionId.value) {
    return;
  }

  if (event.type === "stdout" || event.type === "stderr") {
    appendLogChunk(event.chunk);
    return;
  }

  if (event.type === "connecting" || event.type === "started") {
    streamStatus.value = event.message || "";
    return;
  }

  if (event.type === "error") {
    logError.value = event.message || "日志跟随失败";
    isFollowing.value = false;
    followSessionId.value = "";
    cleanupStreamListener();
    return;
  }

  if (event.type === "close" || event.type === "stopped") {
    streamStatus.value = event.message || "日志跟随已结束";
    isFollowing.value = false;
    followSessionId.value = "";
    cleanupStreamListener();
  }
}

// 内存占用优先走流式：一条 SSH 连接常驻，数字每秒自己跳，不像一次性命令
// 那样每取一次就要重新握手认证一遍（executeSshCommand 每次都新建连接）。
async function startStatsStream() {
  const ssh = getSshBridge();

  if (
    !canQueryDocker.value ||
    statsStarting ||
    statsSessionId.value ||
    document.hidden
  ) {
    return;
  }

  if (!hasLogStreamBridge(ssh)) {
    await loadStatsSnapshot();
    return;
  }

  statsStarting = true;
  cleanupStatsListener();
  statsLineBuffer = "";
  unsubscribeStats = ssh.onCommandStreamEvent(handleStatsEvent);

  try {
    const response = await ssh.startCommandStream(
      { ...form },
      CONTAINER_STATS_STREAM_COMMAND
    );

    if (!response?.ok) {
      throw new Error(response?.message || "启动内存监控失败");
    }

    // await 期间可能已经离开页面或断开连接：后端会话已建立，必须主动收回。
    if (!viewActive || !canQueryDocker.value || document.hidden) {
      void ssh.stopCommandStream?.(response.id);
      cleanupStatsListener();
      return;
    }

    statsSessionId.value = response.id;
  } catch {
    // 内存只是辅助信息，流起不来就退回快照，不占列表的错误提示位。
    cleanupStatsListener();
    await loadStatsSnapshot();
  } finally {
    statsStarting = false;
  }
}

async function stopStatsStream() {
  const sessionId = statsSessionId.value;
  const ssh = getSshBridge();

  cleanupStatsListener();
  statsSessionId.value = "";
  statsLineBuffer = "";

  if (!sessionId) {
    return;
  }

  try {
    await ssh?.stopCommandStream?.(sessionId);
  } catch {
    // 前端状态已经清干净，停不掉也不影响界面。
  }
}

function cleanupStatsListener() {
  if (unsubscribeStats) {
    unsubscribeStats();
    unsubscribeStats = null;
  }
}

// 日志跟随与内存流共用同一条事件通道，各自按 session id 认领自己的事件。
function handleStatsEvent(event) {
  if (!event?.id || event.id !== statsSessionId.value) {
    return;
  }

  if (event.type === "stdout") {
    appendStatsChunk(event.chunk);
    return;
  }

  if (["error", "close", "stopped"].includes(event.type)) {
    cleanupStatsListener();
    statsSessionId.value = "";
  }
}

function appendStatsChunk(chunk) {
  // 非 TTY 下 docker 是按行追加的，但个别版本仍会掺进光标控制码，先剥干净再切行。
  statsLineBuffer += String(chunk || "").replace(
    /\u001b\[[0-9;?]*[A-Za-z]/g,
    ""
  );

  const lines = statsLineBuffer.replace(/\r/g, "\n").split("\n");
  statsLineBuffer = lines.pop() || "";
  lines.forEach(applyStatsLine);
}

// 流式不可用时的兜底。--no-stream 要等 docker 采样，容器多时 1~2 秒才返回，
// 所以它永远不挡在列表渲染前面，取到了再把数字补上。
async function loadStatsSnapshot() {
  if (!canQueryDocker.value) {
    return;
  }

  try {
    const response = await executeDockerCommand(
      CONTAINER_STATS_SNAPSHOT_COMMAND
    );

    if (response?.ok) {
      String(response.stdout || "")
        .split("\n")
        .forEach(applyStatsLine);
    }
  } catch {
    // 取不到就让内存那一格留空。
  }
}

// 每行都自带 ID，逐行 upsert 即可，不需要识别 docker 的帧边界。
function applyStatsLine(line) {
  const [id = "", memUsage = "", memPercent = ""] = String(line)
    .trim()
    .split("|||");

  if (!id || !memUsage) {
    return;
  }

  // MemUsage 形如 "123.4MiB / 7.775GiB"，斜杠前是已用，后面是上限。
  const used = memUsage.split("/")[0].trim();

  if (!used || used === "--") {
    return;
  }

  statsById.value.set(id, {
    memory: formatMemoryValue(used),
    percent: memPercent.trim() === "--" ? "" : memPercent.trim(),
    usage: memUsage.trim(),
  });
}

// docker 给的是 "123.4MiB" 这种紧凑写法，补个空格并统一到 1 位小数。
function formatMemoryValue(value) {
  const match = String(value).match(/^([\d.]+)([A-Za-z]+)$/);

  if (!match) {
    return String(value);
  }

  const amount = Number(match[1]);

  return Number.isFinite(amount)
    ? `${amount.toFixed(1)} ${match[2]}`
    : String(value);
}

function containerMemory(container) {
  return statsById.value.get(container?.id)?.memory || "";
}

// 悬浮提示给出完整的 已用 / 上限 与占宿主机比例。
// 两点注意：docker 报的用量含 page cache，会比 top 里的 RSS 偏大；
// 未设 limit 的容器，MemPerc 的分母是宿主机总内存。
function containerMemoryTitle(container) {
  const stats = statsById.value.get(container?.id);

  if (!stats) {
    return "";
  }

  return stats.percent
    ? `内存 ${stats.usage} · 占服务器 ${stats.percent}`
    : `内存 ${stats.usage}`;
}

function parseContainerRows(output) {
  return String(output || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [
        id = "",
        name = "",
        image = "",
        status = "",
        ports = "",
        createdAt = "",
      ] = line.split("|||");

      return {
        id,
        name,
        image,
        status,
        ports,
        createdAt,
      };
    })
    .filter((container) => container.id && container.name)
    .sort(compareContainers);
}

async function executeDockerCommand(command) {
  const ssh = getSshBridge();

  if (!ssh?.executeCommand) {
    throw new Error("当前是浏览器预览模式，无法执行远程 Docker 命令");
  }

  return ssh.executeCommand(
    {
      ...form,
      commandTimeoutMs:
        normalizeTimeoutSeconds(workspaceSettings.commandTimeoutSeconds) * 1000,
    },
    command
  );
}

function buildDockerLogsCommand(container, follow) {
  const followFlag = follow ? " -f" : "";

  return `docker logs${followFlag} --tail ${Number(
    logTail.value || 300
  )} --timestamps ${shellQuote(container.id)}`;
}

function mergeCommandOutput(response) {
  return [response.stdout, response.stderr]
    .map((value) => String(value || "").trimEnd())
    .filter(Boolean)
    .join("\n");
}

function appendLogChunk(chunk) {
  if (!chunk) {
    return;
  }

  logOutput.value += chunk;

  const lines = logOutput.value.replace(/\r\n/g, "\n").split("\n");

  if (lines.length > MAX_LOG_LINES) {
    logOutput.value = lines.slice(-MAX_LOG_LINES).join("\n");
  }

  if (!isAutoScrollPaused.value) {
    void scrollLogToBottom();
  }
}

async function scrollLogToBottom() {
  await nextTick();

  if (logBodyRef.value) {
    logBodyRef.value.scrollTop = logBodyRef.value.scrollHeight;
  }
}

async function goLogBottom() {
  isAutoScrollPaused.value = false;
  await scrollLogToBottom();
}

function handleLogScroll() {
  const target = logBodyRef.value;

  if (!target || !isFollowing.value) {
    return;
  }

  const distanceToBottom =
    target.scrollHeight - target.scrollTop - target.clientHeight;
  isAutoScrollPaused.value = distanceToBottom > 80;
}

function cleanupStreamListener() {
  if (unsubscribeStream) {
    unsubscribeStream();
    unsubscribeStream = null;
  }
}

function statusClass(status) {
  if (isRunning(status)) {
    return "running";
  }

  if (String(status || "").startsWith("Exited")) {
    return "exited";
  }

  return "neutral";
}

function statusLabel(status) {
  if (isRunning(status)) {
    return "运行中";
  }

  if (String(status || "").startsWith("Exited")) {
    return "已退出";
  }

  return status || "未知";
}

function formatLogLine(line, index) {
  const rawLine = String(line || "");
  const match = rawLine.match(/^(\d{4}-\d{2}-\d{2}T[^\s]+)\s+([\s\S]*)$/);
  const fullTime = match ? match[1] : "";
  const text = match ? match[2] : rawLine;

  return {
    id: `${index}-${rawLine.slice(0, 18)}`,
    time: compactLogTime(fullTime),
    fullTime,
    text,
    level: getLogLineLevel(text),
  };
}

// docker --timestamps 输出 RFC3339Nano，压缩成 "MM-DD HH:MM:SS"，
// 纳秒与时区移到悬浮提示，减少时间列噪音。
function compactLogTime(isoTime) {
  const match = String(isoTime || "").match(
    /^\d{4}-(\d{2})-(\d{2})T(\d{2}:\d{2}:\d{2})/
  );

  return match ? `${match[1]}-${match[2]} ${match[3]}` : isoTime;
}

function getLogLineLevel(line) {
  const text = String(line || "");

  // 优先识别结构化日志级别字段（如 Spring Boot 的 " ERROR " / " WARN "）。
  if (/(^|\s)(ERROR|FATAL|SEVERE)(\s|:|\])/.test(text)) {
    return "error";
  }

  if (/(^|\s)(WARN|WARNING)(\s|:|\])/.test(text)) {
    return "warn";
  }

  // 其次匹配明确的异常关键字；排除 "failed=0" 这类计数器字段，避免整屏误红。
  if (/\b(exception|traceback|panic)\b/i.test(text)) {
    return "error";
  }

  if (/\bfailed\b(?!\s*=)/i.test(text)) {
    return "error";
  }

  // MyBatis / SQL 调试行，保守匹配特征标记，避免误伤普通文本。
  if (/(Preparing:|Parameters:|==>|<==)/.test(text)) {
    return "sql";
  }

  return "normal";
}

// 从 docker 状态串提取可读时长，如 "Up 2 weeks" → "2 weeks"。
function uptimeText(status) {
  const text = String(status || "").trim();
  const up = text.match(/^Up\s+(.*)$/i);

  if (up) {
    return up[1];
  }

  const exited = text.match(/^Exited\s*\([^)]*\)\s*(.*)$/i);

  if (exited) {
    return exited[1];
  }

  return "";
}

async function handleTailChange(value) {
  logTail.value = Number(value || 300);

  if (selectedContainer.value && !isFollowing.value) {
    await loadContainerLogs();
  }
}

function compareContainers(left, right) {
  const leftRunning = isRunning(left.status);
  const rightRunning = isRunning(right.status);

  if (leftRunning !== rightRunning) {
    return leftRunning ? -1 : 1;
  }

  return left.name.localeCompare(right.name);
}

function isRunning(status) {
  return String(status || "").startsWith("Up");
}

function isNginxContainer(container) {
  const identity = [container?.image, container?.name]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");

  return (
    /(^|[/:@._-])(nginx|openresty)([/:@._-]|$)/i.test(identity) ||
    identity.includes("nginxinc") ||
    identity.includes("nginx-proxy")
  );
}

function normalizeTimeoutSeconds(value) {
  const seconds = Number(value || 60);

  if (!Number.isFinite(seconds)) {
    return 60;
  }

  return Math.min(Math.max(Math.round(seconds), 5), 600);
}

function shellQuote(value) {
  return `'${String(value || "").replace(/'/g, `'\"'\"'`)}'`;
}

function getSshBridge() {
  return globalThis.window?.cendlink?.ssh ?? null;
}

function hasLogStreamBridge(ssh) {
  return Boolean(
    ssh?.startCommandStream &&
      ssh?.stopCommandStream &&
      ssh?.onCommandStreamEvent
  );
}

function formatStreamError(error) {
  const message = error?.message || String(error);

  if (
    message.includes("No handler registered") ||
    message.includes("ssh:start-command-stream")
  ) {
    return "当前桌面主进程还没有注册日志跟随通道，请完全关闭 CendLink 后重新运行 npm run dev:electron。";
  }

  return message;
}
</script>

<template>
  <div ref="pageRef" class="container-logs-view">
    <section class="container-list-pane">
      <header class="container-pane-header">
        <div>
          <strong>容器</strong>
          <small>{{ containers.length }} 个 / {{ runningCount }} 运行中</small>
        </div>
        <button
          class="secondary-button"
          type="button"
          :disabled="isLoadingContainers"
          @click="refreshContainers"
        >
          {{ isLoadingContainers ? "刷新中..." : "刷新" }}
        </button>
      </header>

      <div class="container-search-row">
        <Search class="container-search-icon" :size="15" aria-hidden="true" />
        <input
          v-model="searchText"
          type="search"
          placeholder="搜索容器、镜像或端口"
        />
      </div>

      <p v-if="listError" class="container-state failed">{{ listError }}</p>
      <p v-else-if="isLoadingContainers" class="container-state">
        正在读取容器列表...
      </p>
      <p v-else-if="!filteredContainers.length" class="container-state">
        暂无匹配容器
      </p>

      <div class="container-list">
        <div
          v-for="container in filteredContainers"
          :key="container.id"
          class="container-row"
          :class="{
            active: selectedContainerId === container.id,
            nginx: isNginxContainer(container),
          }"
        >
          <button
            class="container-row-select"
            type="button"
            @click="selectContainer(container)"
          >
            <span class="container-row-main">
              <span
                class="container-status-dot"
                :class="statusClass(container.status)"
              ></span>
              <strong :title="container.name">{{ container.name }}</strong>
              <span
                v-if="isNginxContainer(container)"
                class="container-kind-badge"
                >Nginx</span
              >
            </span>
            <span class="container-row-image" :title="container.image">{{
              container.image
            }}</span>
            <small class="container-row-ports">{{
              container.ports || "未暴露端口"
            }}</small>
            <span class="container-row-status">
              <span class="container-row-status-label">{{
                statusLabel(container.status)
              }}</span>
              <span
                v-if="uptimeText(container.status)"
                class="container-row-uptime"
                >{{ uptimeText(container.status) }}</span
              >
              <span
                v-if="containerMemory(container)"
                class="container-row-memory"
                :title="containerMemoryTitle(container)"
                >{{ containerMemory(container) }}</span
              >
            </span>
          </button>

          <span class="container-row-actions">
            <button
              class="container-action-trigger"
              type="button"
              :class="{ open: openActionMenuId === container.id }"
              :disabled="actionPendingId === container.id"
              :aria-expanded="openActionMenuId === container.id"
              aria-label="容器操作"
              title="容器操作"
              @click.stop="toggleContainerActionMenu(container.id, $event)"
            >
              <span aria-hidden="true"></span>
              <span aria-hidden="true"></span>
              <span aria-hidden="true"></span>
            </button>

            <Teleport to="body">
              <Transition name="container-action-menu-transition">
                <span
                  v-if="openActionMenuId === container.id"
                  class="container-action-menu"
                  :style="actionMenuStyle"
                  @click.stop
                >
                  <button
                    v-if="isRunning(container.status)"
                    type="button"
                    class="danger"
                    @click="stopContainer(container)"
                  >
                    停止服务
                  </button>
                  <button
                    v-else
                    type="button"
                    @click="startContainer(container)"
                  >
                    启动服务
                  </button>
                  <button
                    v-if="isNginxContainer(container)"
                    type="button"
                    @click="openNginxConfig(container)"
                  >
                    更改配置
                  </button>
                </span>
              </Transition>
            </Teleport>
          </span>
        </div>
      </div>
    </section>

    <section class="container-log-pane">
      <header class="container-pane-header">
        <div>
          <strong>{{ selectedContainer?.name || "容器日志" }}</strong>
          <small>{{ selectedContainerMeta }}</small>
        </div>
        <span v-if="selectedContainer" class="container-log-status">
          <span
            class="container-status-dot"
            :class="[statusClass(selectedContainer.status), { live: isFollowing }]"
          ></span>
          {{
            isFollowing ? "实时跟随中" : statusLabel(selectedContainer.status)
          }}
        </span>
      </header>

      <div class="container-log-toolbar">
        <label class="log-tail-select">
          <span>行数</span>
          <AppSelect
            :model-value="logTail"
            :options="logTailOptions"
            :disabled="isFollowing"
            @change="handleTailChange"
          />
        </label>

        <button
          v-if="isAutoScrollPaused"
          class="secondary-button"
          type="button"
          @click="goLogBottom"
        >
          <ArrowDownToLine :size="15" aria-hidden="true" />
          回到底部
        </button>
        <button
          class="log-copy-button"
          type="button"
          :disabled="!hasLogContent"
          :title="copiedLogs ? '已复制' : '复制日志'"
          aria-label="复制日志"
          @click="copyLogs"
        >
          <Check v-if="copiedLogs" :size="15" aria-hidden="true" />
          <Copy v-else :size="15" aria-hidden="true" />
        </button>
        <button
          class="secondary-button"
          type="button"
          :disabled="!selectedContainer || isLoadingLogs || isFollowing"
          @click="loadContainerLogs()"
        >
          <RotateCw :size="15" aria-hidden="true" />
          刷新日志
        </button>
        <button
          class="primary-button"
          type="button"
          :class="{ danger: isFollowing }"
          :disabled="!selectedContainer || isLoadingLogs"
          @click="toggleFollowing"
        >
          <Square v-if="isFollowing" :size="15" aria-hidden="true" />
          <Play v-else :size="15" aria-hidden="true" />
          {{ isFollowing ? "停止" : "跟随" }}
        </button>
      </div>

      <p v-if="streamStatus" class="container-state">{{ streamStatus }}</p>
      <p v-if="logError" class="container-state failed">{{ logError }}</p>

      <div
        ref="logBodyRef"
        class="container-log-output"
        :class="{ empty: !hasLogContent }"
        @scroll="handleLogScroll"
      >
        <template v-if="hasLogContent">
          <div
            v-for="line in displayLogLines"
            :key="line.id"
            class="container-log-line"
            :class="[line.level, { 'no-time': !line.time }]"
          >
            <span class="container-log-time" :title="line.fullTime">{{
              line.time
            }}</span>
            <span class="container-log-text">{{ line.text || " " }}</span>
          </div>
        </template>
        <div v-else class="container-log-empty">
          <span
            v-if="isFollowing"
            class="container-status-dot live container-log-waiting-dot"
            aria-hidden="true"
          ></span>
          <Terminal v-else :size="36" :stroke-width="1.5" aria-hidden="true" />
          <p>{{ logPlaceholder }}</p>
        </div>
      </div>
    </section>
  </div>
</template>
