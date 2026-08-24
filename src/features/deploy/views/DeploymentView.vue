<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { gsap } from "gsap";
import {
  AlertCircle,
  AlertTriangle,
  CircleCheck,
  FileArchive,
  Trash2,
  Upload,
  UploadCloud,
} from "@lucide/vue";
import { useWorkspaceSession } from "../../workspace/composables/useWorkspaceSession.js";
import AppSelect from "../../../components/ui/AppSelect.vue";
import AppTooltip from "../../../components/ui/AppTooltip.vue";
import RunProgress from "../../workspace/components/RunProgress.vue";
import CopyButton from "../../../components/ui/CopyButton.vue";
import InlineDeleteConfirm from "../../../components/ui/InlineDeleteConfirm.vue";

// 远程部署页：选择镜像包、编辑部署参数、实时预览 docker run 并执行部署。
const {
  deployments,
  serviceTemplates,
  selectedServiceTemplate,
  selectedServiceTemplateId,
  deployForm,
  deployPreview,
  deployResult,
  isDeploying,
  isSavingServiceTemplate,
  serviceTemplateSaveError,
  canDeploy,
  deployHint,
  hasDeploymentBridge,
  hasServiceTemplateBridge,
  updateDeployForm,
  loadServiceTemplates,
  selectServiceTemplate,
  saveServiceTemplateFromDeploy,
  deleteServiceTemplate,
  selectDeployPackageFile,
  selectDroppedDeployPackageFile,
  refreshDeployPreview,
  runDeployment,
} = useWorkspaceSession();

const emit = defineEmits(["open-logs"]);

// 部署管线的锚定步骤（名称与 deploymentRunner 的 runStep 一致），运行中先按 pending 展示，
// 结束后由真实 steps[] 逐条标记 success/failed。
const DEPLOY_STAGES = [
  { key: "precheck", label: "远程预检查" },
  { key: "network", label: "检查 Docker 网络" },
  { key: "nginx", label: "检查 Nginx 代理" },
  { key: "port", label: "检查端口占用" },
  { key: "upload", label: "上传镜像包" },
  { key: "load", label: "导入镜像" },
  { key: "mkdir", label: "创建运行目录" },
  { key: "run", label: "启动容器" },
  { key: "inspect", label: "检查容器状态" },
  { key: "network-verify", label: "验证容器网络" },
];

const restartPolicyOptions = [
  { value: "unless-stopped", label: "unless-stopped" },
  { value: "always", label: "always" },
  { value: "on-failure", label: "on-failure" },
  { value: "no", label: "no" },
];

const containerConflictOptions = [
  { value: "auto", label: "自动替换" },
  { value: "abort", label: "发现冲突终止" },
];

const imageCleanupOptions = [
  { value: "auto", label: "自动清理" },
  { value: "keep", label: "保留旧镜像" },
];

const directoryPermissionOptions = [
  { value: "none", label: "不处理" },
  { value: "chmod777", label: "兼容模式 chmod 777" },
];

const environmentLines = computed(() => {
  return (
    deployPreview.value?.envVars?.map((item) => `${item.key}=${item.value}`) ||
    []
  );
});

const mountLines = computed(() => {
  return (
    deployPreview.value?.mounts?.map(
      (item) => `${item.hostPath} -> ${item.containerPath}`
    ) || []
  );
});

// 部署态胶囊：两张面板合并后，原本 panel-header 上的胶囊由页尾操作条统一持有。
const deployTone = computed(() => {
  if (isDeploying.value) return "running";
  if (!deployResult.value) return "";
  return deployResult.value.ok ? "success" : "failed";
});

const deployLabel = computed(() => {
  if (isDeploying.value) return "Deploying";
  return deployResult.value?.status || "Idle";
});

const deployFormCard = ref(null);
const isAdvancedOpen = ref(false);
const isPackageHistoryOpen = ref(false);
const isServiceTemplateCopyOpen = ref(false);
const serviceTemplateCopyName = ref("");
const serviceTemplateCopyError = ref("");
const serviceTemplateCopyInputRef = ref(null);
const serviceTemplateSaveNotice = ref(null);
const pendingServiceTemplateDelete = ref(null);
const isDeletingServiceTemplate = ref(false);
const isPackageDragActive = ref(false);
const packageDropError = ref("");
let packageDragDepth = 0;
let deployGsapContext = null;

const packageHistory = computed(() => {
  return deployments.value.filter((item) => item.status === "package_success");
});

const recentPackages = computed(() => {
  return packageHistory.value.slice(0, 5);
});

const selectedPackageRecord = computed(() => {
  return (
    packageHistory.value.find(
      (item) => item.deployPath === deployForm.localPackagePath
    ) || null
  );
});

const displayedHistoryPackage = computed(() => {
  return selectedPackageRecord.value || recentPackages.value[0] || null;
});

const currentPackageSource = computed(() => {
  if (!deployForm.localPackagePath) {
    return "等待选择";
  }

  return selectedPackageRecord.value ? "来自打包记录" : "手动选择";
});

const currentPackageFileName = computed(() => {
  return getFileName(deployForm.localPackagePath);
});

const hasDeployPackage = computed(() => Boolean(deployForm.localPackagePath));

const selectedServiceTemplateSummary = computed(() => {
  if (!hasServiceTemplateBridge.value) {
    return "服务模板能力需要重启桌面窗口后生效";
  }

  if (!selectedServiceTemplate.value) {
    return "保存后可在打包和部署页复用该服务配置";
  }

  const template = selectedServiceTemplate.value;
  const config = template.deployConfig || {};
  const serviceName = config.serviceName || template.serviceName || template.name;
  const hostPort = Number(config.hostPort || 0);
  const containerPort = Number(config.containerPort || 0);
  const updatedAt = formatRecordTime(template.updatedAt);
  const summary = [`服务 ${serviceName}`];

  if (hostPort && containerPort) {
    summary.push(`端口 ${hostPort} -> ${containerPort}`);
  }

  if (config.networkName) {
    summary.push(`网络 ${config.networkName}`);
  }

  summary.push(updatedAt ? `更新 ${updatedAt}` : "尚未更新");
  return summary.join(" · ");
});

const serviceTemplateSelectOptions = computed(() => {
  return [
    { value: "", label: "未选择服务模板" },
    ...serviceTemplates.value.map((template) => ({
      value: template.id,
      label: template.name,
    })),
  ];
});

function applyHistoryPackage(item) {
  const metadata = item.metadata || {};
  const imageRef = String(metadata.imageRef || item.projectId || "");
  const [imageName = deployForm.imageName, imageTag = deployForm.imageTag] =
    imageRef.split(":");
  const serviceName = String(
    metadata.serviceName || imageName || deployForm.serviceName
  ).replace(/[^a-zA-Z0-9._-]+/g, "_");

  updateDeployForm({
    packageSourceType: "history",
    localPackagePath: item.deployPath || "",
    serviceName,
    serviceVersion: String(
      metadata.serviceVersion || imageTag || deployForm.serviceVersion
    ),
    imageName: imageName || deployForm.imageName,
    imageTag: imageTag || deployForm.imageTag,
    containerName: serviceName || deployForm.containerName,
    containerPort: Number(
      metadata.servicePort || deployForm.containerPort || 8080
    ),
  });
  isPackageHistoryOpen.value = false;
}

function togglePackageHistoryOpen() {
  isPackageHistoryOpen.value = !isPackageHistoryOpen.value;
}

async function saveCurrentServiceTemplate() {
  serviceTemplateSaveNotice.value = null;
  const isUpdating = Boolean(selectedServiceTemplate.value);
  const saved = await saveServiceTemplateFromDeploy();

  if (!saved) {
    serviceTemplateSaveNotice.value = {
      type: "error",
      message: serviceTemplateSaveError.value || "服务配置保存失败，请稍后重试",
    };
    return;
  }

  const savedServiceName =
    saved.deployConfig?.serviceName || saved.serviceName || saved.name;
  serviceTemplateSaveNotice.value = {
    type: "success",
    message: isUpdating
      ? `已更新“${saved.name}”的部署配置，服务名为 ${savedServiceName}`
      : `已保存服务“${saved.name}”`,
  };
}

function changeServiceTemplate(templateId) {
  serviceTemplateSaveNotice.value = null;
  pendingServiceTemplateDelete.value = null;
  isServiceTemplateCopyOpen.value = false;
  serviceTemplateCopyError.value = "";
  selectServiceTemplate(templateId, "deploy");
}

function openServiceTemplateCopy() {
  serviceTemplateSaveNotice.value = null;
  pendingServiceTemplateDelete.value = null;
  serviceTemplateCopyName.value = String(
    deployForm.serviceName || selectedServiceTemplate.value?.name || ""
  ).trim();
  serviceTemplateCopyError.value = "";
  isServiceTemplateCopyOpen.value = true;

  void nextTick(() => {
    serviceTemplateCopyInputRef.value?.focus();
    serviceTemplateCopyInputRef.value?.select();
  });
}

function closeServiceTemplateCopy() {
  if (isSavingServiceTemplate.value) {
    return;
  }

  isServiceTemplateCopyOpen.value = false;
  serviceTemplateCopyError.value = "";
}

async function saveServiceTemplateCopy() {
  const name = serviceTemplateCopyName.value.trim();

  if (!name) {
    serviceTemplateCopyError.value = "请输入服务模板名称";
    serviceTemplateCopyInputRef.value?.focus();
    return;
  }

  const saved = await saveServiceTemplateFromDeploy({
    createNew: true,
    name,
  });

  if (saved) {
    isServiceTemplateCopyOpen.value = false;
    serviceTemplateCopyError.value = "";
    serviceTemplateSaveNotice.value = {
      type: "success",
      message: `已另存服务“${saved.name}”`,
    };
    return;
  }

  serviceTemplateCopyError.value =
    serviceTemplateSaveError.value || "保存失败，请稍后重试";
}

function removeSelectedServiceTemplate() {
  if (!selectedServiceTemplate.value) {
    return;
  }

  isServiceTemplateCopyOpen.value = false;
  serviceTemplateCopyError.value = "";
  pendingServiceTemplateDelete.value = {
    id: selectedServiceTemplateId.value,
    name: selectedServiceTemplate.value.name,
  };
}

function closeServiceTemplateDelete() {
  if (!isDeletingServiceTemplate.value) {
    pendingServiceTemplateDelete.value = null;
  }
}

async function confirmServiceTemplateDelete() {
  const target = pendingServiceTemplateDelete.value;

  if (!target || isDeletingServiceTemplate.value) {
    return;
  }

  isDeletingServiceTemplate.value = true;

  try {
    await deleteServiceTemplate(target.id);
    pendingServiceTemplateDelete.value = null;
  } finally {
    isDeletingServiceTemplate.value = false;
  }
}

function canInteractWithPackageDropzone() {
  return hasDeploymentBridge.value && !isDeploying.value;
}

function handlePackageDragEnter(event) {
  if (!canInteractWithPackageDropzone()) {
    return;
  }

  packageDragDepth += 1;
  isPackageDragActive.value = true;

  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
}

function handlePackageDragOver(event) {
  if (canInteractWithPackageDropzone() && event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
}

function handlePackageDragLeave() {
  packageDragDepth = Math.max(0, packageDragDepth - 1);

  if (packageDragDepth === 0) {
    isPackageDragActive.value = false;
  }
}

async function handlePackageDrop(event) {
  packageDragDepth = 0;
  isPackageDragActive.value = false;
  packageDropError.value = "";

  if (!canInteractWithPackageDropzone()) {
    return;
  }

  const files = Array.from(event.dataTransfer?.files || []);

  if (files.length !== 1) {
    packageDropError.value =
      files.length > 1 ? "一次只能拖入一个镜像包" : "没有读取到拖入的文件";
    return;
  }

  const result = await selectDroppedDeployPackageFile(files[0]);

  if (!result?.ok) {
    packageDropError.value = result?.message || "无法使用这个文件";
  }
}

async function chooseDeployPackageFile() {
  packageDropError.value = "";
  const result = await selectDeployPackageFile();

  if (result && !result.ok && !result.canceled) {
    packageDropError.value = result.message || "无法使用这个文件";
  }
}

function preventWindowFileDrop(event) {
  event.preventDefault();
}

function getFileName(filePath) {
  const value = String(filePath || "").trim();

  if (!value) {
    return "";
  }

  return value.split(/[\\/]/).filter(Boolean).pop() || value;
}

function getPackageTitle(item) {
  const metadata = item?.metadata || {};
  return (
    metadata.imageRef ||
    item?.projectId ||
    metadata.serviceName ||
    item?.artifactName ||
    "镜像包"
  );
}

function getPackageSubtitle(item) {
  const metadata = item?.metadata || {};
  const version = metadata.serviceVersion
    ? `版本 ${metadata.serviceVersion}`
    : "未记录版本";
  const fileName = getFileName(item?.deployPath || "");

  return [version, fileName].filter(Boolean).join(" · ");
}

function formatRecordTime(value) {
  if (!value) {
    return "";
  }

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return String(value);
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function toggleAdvancedOpen() {
  isAdvancedOpen.value = !isAdvancedOpen.value;
}

function animateSummary() {
  const selector = deployGsapContext?.selector;

  if (!selector) {
    return;
  }

  gsap.fromTo(
    selector(".deploy-package-dropzone"),
    { autoAlpha: 0.82, y: 4 },
    { autoAlpha: 1, y: 0, duration: 0.2, ease: "power3.out", overwrite: "auto" }
  );
}

function animateActivePackage() {
  const activeItem = deployFormCard.value?.querySelector(
    ".deploy-history-item.active"
  );

  if (!activeItem) {
    return;
  }

  gsap.fromTo(
    activeItem,
    { scale: 0.985 },
    {
      scale: 1,
      duration: 0.18,
      ease: "power3.out",
      overwrite: "auto",
      clearProps: "transform",
    }
  );
}

onMounted(() => {
  window.addEventListener("dragover", preventWindowFileDrop);
  window.addEventListener("drop", preventWindowFileDrop);
  loadServiceTemplates();
  refreshDeployPreview();

  if (!deployFormCard.value) {
    return;
  }

  deployGsapContext = gsap.context(() => {
    gsap.from(".deploy-package-dropzone", {
      autoAlpha: 0,
      y: 8,
      duration: 0.24,
      ease: "power3.out",
    });

    gsap.from(".form-group", {
      autoAlpha: 0,
      y: 8,
      duration: 0.24,
      ease: "power3.out",
      stagger: 0.035,
      delay: 0.04,
    });
  }, deployFormCard.value);
});

onUnmounted(() => {
  window.removeEventListener("dragover", preventWindowFileDrop);
  window.removeEventListener("drop", preventWindowFileDrop);
  deployGsapContext?.revert();
});

watch(
  () => [
    deployForm.localPackagePath,
    deployForm.imageName,
    deployForm.imageTag,
    deployForm.hostPort,
    deployForm.containerPort,
    deployForm.containerName,
  ],
  async () => {
    await nextTick();
    animateSummary();
    animateActivePackage();
  },
  { flush: "post" }
);

watch(isAdvancedOpen, async (isOpen) => {
  await nextTick();

  if (!isOpen) {
    return;
  }

  const selector = deployGsapContext?.selector;

  if (!selector) {
    return;
  }

  gsap.fromTo(
    selector(".deploy-advanced-body .field, .deploy-advanced-body .field-row"),
    { autoAlpha: 0, y: 6 },
    {
      autoAlpha: 1,
      y: 0,
      duration: 0.2,
      ease: "power3.out",
      stagger: 0.025,
      overwrite: "auto",
    }
  );
});

watch(
  () => deployForm.localPackagePath,
  () => {
    packageDropError.value = "";
  }
);

watch(
  deployForm,
  () => {
    serviceTemplateSaveNotice.value = null;
  },
  { deep: true }
);
</script>

<template>
  <div class="deploy-view">
    <section class="deploy-console">
      <div class="deploy-body">
        <div ref="deployFormCard" class="deploy-fields-col">
          <div class="form-group">
            <p class="form-group-title">服务模板</p>

            <div class="template-picker-row service-template-row">
              <AppSelect
                :model-value="selectedServiceTemplateId"
                :options="serviceTemplateSelectOptions"
                :disabled="!hasServiceTemplateBridge || isDeletingServiceTemplate"
                @change="changeServiceTemplate"
              />
              <button
                type="button"
                class="secondary-button compact-button"
                :class="{ 'is-loading': isSavingServiceTemplate }"
                :aria-busy="isSavingServiceTemplate"
                :disabled="
                  !hasServiceTemplateBridge ||
                  isSavingServiceTemplate ||
                  isDeletingServiceTemplate
                "
                @click="saveCurrentServiceTemplate"
              >
                <span
                  v-if="isSavingServiceTemplate"
                  class="btn-spinner"
                  aria-hidden="true"
                ></span>
                {{
                  isSavingServiceTemplate
                    ? selectedServiceTemplate
                      ? "更新中..."
                      : "保存中..."
                    : selectedServiceTemplate
                    ? "更新服务"
                    : "保存服务"
                }}
              </button>
              <button
                type="button"
                class="secondary-button compact-button"
                :disabled="
                  !hasServiceTemplateBridge ||
                  isSavingServiceTemplate ||
                  isDeletingServiceTemplate
                "
                @click="openServiceTemplateCopy"
              >
                另存
              </button>
              <button
                v-if="selectedServiceTemplate"
                type="button"
                class="danger-button template-delete-trigger"
                title="删除当前服务模板"
                aria-label="删除当前服务模板"
                :disabled="isSavingServiceTemplate || isDeletingServiceTemplate"
                @click="removeSelectedServiceTemplate"
              >
                <Trash2 :size="14" aria-hidden="true" />
              </button>
            </div>

            <InlineDeleteConfirm
              v-if="pendingServiceTemplateDelete"
              title="删除服务模板？"
              :message="
                '服务模板「' +
                pendingServiceTemplateDelete.name +
                '」将被永久删除，已有部署记录不会受影响。'
              "
              :busy="isDeletingServiceTemplate"
              @cancel="closeServiceTemplateDelete"
              @confirm="confirmServiceTemplateDelete"
            />

            <div
              v-if="isServiceTemplateCopyOpen"
              class="service-template-copy-form"
            >
              <label class="field">
                <span>新服务模板名称</span>
                <input
                  ref="serviceTemplateCopyInputRef"
                  v-model="serviceTemplateCopyName"
                  type="text"
                  autocomplete="off"
                  placeholder="例如 aibox-s-prod"
                  @input="serviceTemplateCopyError = ''"
                  @keydown.esc.stop="closeServiceTemplateCopy"
                  @keydown.enter.prevent="saveServiceTemplateCopy"
                />
                <small
                  v-if="serviceTemplateCopyError"
                  class="service-template-copy-error"
                  role="alert"
                >
                  {{ serviceTemplateCopyError }}
                </small>
              </label>
              <div class="service-template-copy-actions">
                <button
                  type="button"
                  class="secondary-button compact-button"
                  :disabled="isSavingServiceTemplate"
                  @click="closeServiceTemplateCopy"
                >
                  取消
                </button>
                <button
                  type="button"
                  class="primary-button compact-button"
                  :disabled="isSavingServiceTemplate"
                  @click="saveServiceTemplateCopy"
                >
                  {{ isSavingServiceTemplate ? "保存中..." : "保存副本" }}
                </button>
              </div>
            </div>

            <small class="template-description">
              {{ selectedServiceTemplateSummary }}
            </small>
            <div
              v-if="serviceTemplateSaveNotice"
              class="service-template-save-notice"
              :class="serviceTemplateSaveNotice.type"
              :role="serviceTemplateSaveNotice.type === 'error' ? 'alert' : 'status'"
              aria-live="polite"
            >
              <CircleCheck
                v-if="serviceTemplateSaveNotice.type === 'success'"
                :size="14"
                aria-hidden="true"
              />
              <AlertCircle v-else :size="14" aria-hidden="true" />
              <span>{{ serviceTemplateSaveNotice.message }}</span>
            </div>
          </div>

          <div class="form-group">
            <div class="form-group-head">
              <p class="form-group-title">镜像包</p>
              <span class="deploy-source-pill">{{ currentPackageSource }}</span>
            </div>

            <button
              type="button"
              class="file-dropzone deploy-package-dropzone"
              :class="{
                'is-dragging': isPackageDragActive,
                'has-file': hasDeployPackage,
                'has-error': packageDropError,
              }"
              :disabled="!hasDeploymentBridge || isDeploying"
              :aria-label="
                hasDeployPackage
                  ? '更换镜像包：' + currentPackageFileName
                  : '选择或拖入镜像包'
              "
              @click="chooseDeployPackageFile"
              @dragenter.prevent.stop="handlePackageDragEnter"
              @dragover.prevent.stop="handlePackageDragOver"
              @dragleave.prevent.stop="handlePackageDragLeave"
              @drop.prevent.stop="handlePackageDrop"
            >
              <div class="file-dropzone-icon" aria-hidden="true">
                <UploadCloud v-if="isPackageDragActive" :size="19" />
                <FileArchive v-else :size="19" />
              </div>
              <div class="file-dropzone-copy">
                <strong>
                  {{
                    isPackageDragActive
                      ? "释放以使用这个镜像包"
                      : currentPackageFileName || "拖入镜像包"
                  }}
                </strong>
                <small :title="deployForm.localPackagePath">
                  {{
                    isPackageDragActive
                      ? "仅接收单个 tar.gz、tgz 或 tar 文件"
                      : deployForm.localPackagePath ||
                        "也可以点击此区域从本机选择"
                  }}
                </small>
              </div>
              <div class="file-dropzone-action" aria-hidden="true">
                <Upload :size="14" />
                <b>{{ hasDeployPackage ? "更换" : "选择" }}</b>
              </div>
            </button>
            <small
              v-if="packageDropError"
              class="file-dropzone-message error"
              role="alert"
            >
              {{ packageDropError }}
            </small>
            <small v-else class="file-dropzone-message">
              {{
                hasDeploymentBridge
                  ? "支持拖放或点击选择镜像包"
                  : "请通过 Electron 模式选择本地文件"
              }}
            </small>
          </div>

          <div
            v-if="recentPackages.length && displayedHistoryPackage"
            class="form-group deploy-history-picks"
            :class="{ expanded: isPackageHistoryOpen }"
          >
            <div class="form-group-head">
              <p class="form-group-title">最近镜像包</p>
              <span class="deploy-count-pill">{{ packageHistory.length }} 条</span>
            </div>

            <button
              type="button"
              class="deploy-history-trigger"
              :class="{
                active:
                  deployForm.localPackagePath ===
                  displayedHistoryPackage.deployPath,
              }"
              :aria-expanded="isPackageHistoryOpen"
              @click="togglePackageHistoryOpen"
            >
              <span class="deploy-history-copy">
                <strong>{{ getPackageTitle(displayedHistoryPackage) }}</strong>
                <small :title="displayedHistoryPackage.deployPath">
                  {{ getPackageSubtitle(displayedHistoryPackage) }}
                </small>
              </span>
              <span class="deploy-history-side">
                <small>{{
                  formatRecordTime(displayedHistoryPackage.createdAt)
                }}</small>
                <b>{{
                  isPackageHistoryOpen
                    ? "收起"
                    : recentPackages.length > 1
                    ? "更多"
                    : "选择"
                }}</b>
              </span>
            </button>

            <transition name="deploy-collapse">
              <div v-if="isPackageHistoryOpen" class="deploy-history-list">
                <button
                  v-for="item in recentPackages"
                  :key="item.id"
                  type="button"
                  class="deploy-history-item"
                  :class="{
                    active: deployForm.localPackagePath === item.deployPath,
                  }"
                  @click="applyHistoryPackage(item)"
                >
                  <span class="deploy-history-copy">
                    <strong>{{ getPackageTitle(item) }}</strong>
                    <small :title="item.deployPath">{{
                      getPackageSubtitle(item)
                    }}</small>
                  </span>
                  <span class="deploy-history-side">
                    <small>{{ formatRecordTime(item.createdAt) }}</small>
                    <b>{{
                      deployForm.localPackagePath === item.deployPath
                        ? "已选"
                        : "选择"
                    }}</b>
                  </span>
                </button>
              </div>
            </transition>
          </div>

          <div class="form-group">
            <p class="form-group-title">容器运行</p>

            <div class="field-row compact-row">
              <label class="field fill">
                <span>容器名</span>
                <input
                  :value="deployForm.containerName"
                  type="text"
                  @input="
                    updateDeployForm({ containerName: $event.target.value })
                  "
                />
              </label>
              <label class="field fill">
                <span>重启策略</span>
                <AppSelect
                  :model-value="deployForm.restartPolicy"
                  :options="restartPolicyOptions"
                  @change="updateDeployForm({ restartPolicy: $event })"
                />
              </label>
            </div>

            <div class="field-row compact-row">
              <label class="field fill">
                <AppTooltip
                  class="field-help-label"
                  content="服务器对外开放的端口。浏览器或其他外部客户端通过“服务器地址:宿主机端口”访问服务。"
                >宿主机端口</AppTooltip>
                <input
                  :value="deployForm.hostPort"
                  type="number"
                  min="1"
                  max="65535"
                  @input="
                    updateDeployForm({ hostPort: Number($event.target.value) })
                  "
                />
              </label>
              <label class="field fill">
                <AppTooltip
                  class="field-help-label"
                  content="应用在容器内部实际监听的端口。Docker 容器之间通信以及 Nginx 代理应使用这个端口。"
                >容器端口</AppTooltip>
                <input
                  :value="deployForm.containerPort"
                  type="number"
                  min="1"
                  max="65535"
                  @input="
                    updateDeployForm({
                      containerPort: Number($event.target.value),
                    })
                  "
                />
              </label>
            </div>

            <div class="field-row compact-row">
              <label class="field fill">
                <AppTooltip
                  class="field-help-label"
                  content="后端容器启动时加入的现有 Docker 网络。需要通过容器名互相访问的服务必须处于同一网络。"
                >Docker 网络</AppTooltip>
                <input
                  :value="deployForm.networkName"
                  type="text"
                  @input="updateDeployForm({ networkName: $event.target.value })"
                />
              </label>
              <div class="field fill">
                <AppTooltip
                  class="field-help-label"
                  content="开启后，CendLink 会检查 Nginx 容器、共享网络和 proxy_pass 目标；检查结果只警告，不自动修改配置。"
                >Nginx 代理检查</AppTooltip>
                <button
                  type="button"
                  class="deploy-check-switch"
                  :class="{ active: deployForm.nginxProxyCheckEnabled }"
                  role="switch"
                  :aria-checked="deployForm.nginxProxyCheckEnabled"
                  @click="
                    updateDeployForm({
                      nginxProxyCheckEnabled: !deployForm.nginxProxyCheckEnabled,
                    })
                  "
                >
                  <span>{{ deployForm.nginxProxyCheckEnabled ? "已启用" : "未启用" }}</span>
                  <span class="deploy-check-switch-track" aria-hidden="true"><i></i></span>
                </button>
              </div>
            </div>

            <label v-if="deployForm.nginxProxyCheckEnabled" class="field fill">
              <AppTooltip
                class="field-help-label"
                content="要检查的 Nginx Docker 容器名称，对应 docker ps 输出中的 NAMES，不是镜像名。"
              >Nginx 容器名</AppTooltip>
              <input
                :value="deployForm.nginxContainerName"
                type="text"
                @input="
                  updateDeployForm({ nginxContainerName: $event.target.value })
                "
              />
            </label>
          </div>

          <div class="form-group">
            <p class="form-group-title">基础信息</p>

            <div class="field-row compact-row">
              <label class="field fill">
                <span>服务名</span>
                <input
                  :value="deployForm.serviceName"
                  type="text"
                  @input="
                    updateDeployForm({ serviceName: $event.target.value })
                  "
                />
              </label>
              <label class="field fill">
                <span>版本</span>
                <input
                  :value="deployForm.serviceVersion"
                  type="text"
                  @input="
                    updateDeployForm({
                      serviceVersion: $event.target.value,
                      imageTag: $event.target.value,
                    })
                  "
                />
              </label>
            </div>

            <div class="field-row compact-row">
              <label class="field fill">
                <span>镜像名</span>
                <input
                  :value="deployForm.imageName"
                  type="text"
                  @input="updateDeployForm({ imageName: $event.target.value })"
                />
              </label>
              <label class="field fill">
                <span>镜像 Tag</span>
                <input
                  :value="deployForm.imageTag"
                  type="text"
                  @input="updateDeployForm({ imageTag: $event.target.value })"
                />
              </label>
            </div>
          </div>

          <div class="form-group">
            <p class="form-group-title">服务器目录</p>

            <div class="field-row compact-row">
              <label class="field fill">
                <span>发布根目录</span>
                <input
                  :value="deployForm.remoteBaseDir"
                  type="text"
                  @input="
                    updateDeployForm({ remoteBaseDir: $event.target.value })
                  "
                />
              </label>
              <label class="field fill">
                <span>上传目录</span>
                <input
                  :value="deployForm.remotePackageDir"
                  type="text"
                  @input="
                    updateDeployForm({ remotePackageDir: $event.target.value })
                  "
                />
              </label>
            </div>
          </div>

          <div
            class="form-group deploy-advanced-section"
            :class="{ expanded: isAdvancedOpen }"
          >
            <button
              type="button"
              class="form-group-head advanced-toggle"
              :aria-expanded="isAdvancedOpen"
              @click="toggleAdvancedOpen"
            >
              <span class="form-group-title">高级选项</span>
              <b>{{ isAdvancedOpen ? "收起" : "展开" }}</b>
            </button>

            <transition name="deploy-collapse">
              <div v-if="isAdvancedOpen" class="deploy-advanced-body">
                <div class="field-row compact-row">
                  <label class="field fill">
                    <span>旧容器策略</span>
                    <AppSelect
                      :model-value="deployForm.containerConflictStrategy"
                      :options="containerConflictOptions"
                      @change="
                        updateDeployForm({ containerConflictStrategy: $event })
                      "
                    />
                  </label>
                  <label class="field fill">
                    <span>旧镜像策略</span>
                    <AppSelect
                      :model-value="deployForm.imageCleanupStrategy"
                      :options="imageCleanupOptions"
                      @change="
                        updateDeployForm({ imageCleanupStrategy: $event })
                      "
                    />
                  </label>
                </div>

                <div class="field-row compact-row">
                  <label class="field fill">
                    <span>目录权限策略</span>
                    <AppSelect
                      :model-value="deployForm.directoryPermissionMode"
                      :options="directoryPermissionOptions"
                      @change="
                        updateDeployForm({ directoryPermissionMode: $event })
                      "
                    />
                  </label>
                  <label class="field fill">
                    <span>额外参数</span>
                    <input
                      :value="deployForm.extraArgs"
                      type="text"
                      placeholder="例如 --cpus 2 --memory 1g"
                      @input="
                        updateDeployForm({ extraArgs: $event.target.value })
                      "
                    />
                  </label>
                </div>

                <label class="field">
                  <span>环境变量</span>
                  <textarea
                    :value="deployForm.envText"
                    class="deploy-textarea"
                    rows="4"
                    placeholder="KEY=VALUE，每行一个"
                    @input="updateDeployForm({ envText: $event.target.value })"
                  ></textarea>
                </label>
              </div>
            </transition>
          </div>
        </div>

        <div class="deploy-preview-col">
          <div class="preview-identity" :class="{ empty: !deployPreview?.imageRef }">
            <div class="preview-identity-main">
              <span class="preview-identity-label">镜像引用</span>
              <strong :title="deployPreview?.imageRef">{{ deployPreview?.imageRef || "等待填写部署参数" }}</strong>
            </div>
            <CopyButton
              v-if="deployPreview?.imageRef"
              :value="deployPreview.imageRef"
              label="复制镜像引用"
            />
          </div>

          <div class="preview-groups">
            <section class="preview-group">
              <p class="preview-group-title">容器</p>
              <dl class="preview-list">
                <div class="preview-row">
                  <dt>容器名</dt>
                  <dd :title="deployPreview?.containerName">{{ deployPreview?.containerName || "-" }}</dd>
                </div>
                <div class="preview-row">
                  <dt>端口映射</dt>
                  <dd>{{ deployPreview?.hostPort || "-" }} → {{ deployPreview?.containerPort || "-" }}</dd>
                </div>
              </dl>
            </section>

            <section class="preview-group">
              <p class="preview-group-title">远程路径</p>
              <dl class="preview-list">
                <div class="preview-row">
                  <dt>远程包</dt>
                  <dd class="mono" :title="deployPreview?.remotePackagePath">{{ deployPreview?.remotePackagePath || "-" }}</dd>
                </div>
                <div class="preview-row">
                  <dt>发布目录</dt>
                  <dd class="mono" :title="deployPreview?.remoteReleaseDir">{{ deployPreview?.remoteReleaseDir || "-" }}</dd>
                </div>
              </dl>
            </section>
          </div>

          <div class="deploy-preview-scroll">
            <section class="preview-group">
              <p class="preview-group-title">运行配置</p>
              <dl class="preview-list">
                <div class="preview-row wide">
                  <dt>环境变量</dt>
                  <dd>{{ environmentLines.join(" | ") || "暂无" }}</dd>
                </div>
                <div class="preview-row wide">
                  <dt>挂载目录</dt>
                  <dd>{{ mountLines.join(" | ") || "暂无" }}</dd>
                </div>
                <div class="preview-row wide">
                  <dt>
                    <AppTooltip class="field-help-label" content="后端容器将加入的 Docker 网络。">
                      Docker 网络
                    </AppTooltip>
                  </dt>
                  <dd class="mono">{{ deployPreview?.networkName || "-" }}</dd>
                </div>
                <div v-if="deployForm.nginxProxyCheckEnabled" class="preview-row wide">
                  <dt>
                    <AppTooltip
                      class="field-help-label"
                      content="Nginx 在 Docker 网络内访问后端时应使用的容器名和容器端口。"
                    >Nginx 代理目标</AppTooltip>
                  </dt>
                  <dd class="mono" :title="deployPreview?.nginxProxyTarget">
                    {{ deployPreview?.nginxProxyTarget || "-" }}
                  </dd>
                </div>
                <div class="preview-row wide">
                  <dt>
                    <AppTooltip
                      class="field-help-label"
                      content="关闭后仍会部署后端并检查 Docker 网络，但不会读取或诊断 Nginx 配置。"
                    >Nginx 检查</AppTooltip>
                  </dt>
                  <dd>{{ deployForm.nginxProxyCheckEnabled ? "已启用" : "未启用" }}</dd>
                </div>
              </dl>
            </section>

            <section class="preview-commands">
              <div class="preview-command">
                <div class="preview-group-head">
                  <p class="preview-group-title">创建目录命令</p>
                  <CopyButton
                    v-if="deployPreview?.mkdirCommand"
                    :value="deployPreview.mkdirCommand"
                    label="复制命令"
                  />
                </div>
                <div class="command-panel">
                  <pre><code>{{ deployPreview?.mkdirCommand || '等待填写部署参数' }}</code></pre>
                </div>
              </div>

              <div class="preview-command">
                <div class="preview-group-head">
                  <p class="preview-group-title">挂载目录权限</p>
                  <CopyButton
                    v-if="deployPreview?.prepareDirectoriesCommand"
                    :value="deployPreview.prepareDirectoriesCommand"
                    label="复制命令"
                  />
                </div>
                <div class="command-panel">
                  <pre><code>{{ deployPreview?.prepareDirectoriesCommand || '等待填写部署参数' }}</code></pre>
                </div>
              </div>

              <div class="preview-command">
                <div class="preview-group-head">
                  <p class="preview-group-title">Docker Run</p>
                  <CopyButton
                    v-if="deployPreview?.runCommand"
                    :value="deployPreview.runCommand"
                    label="复制命令"
                  />
                </div>
                <div class="command-panel">
                  <pre><code>{{ deployPreview?.runCommand || '等待填写部署参数' }}</code></pre>
                </div>
              </div>
            </section>
          </div>

          <div v-if="isDeploying || deployResult" class="package-result-block">
            <RunProgress
              :active="isDeploying"
              :result="deployResult"
              :stages="DEPLOY_STAGES"
              running-text="正在部署镜像包…"
            />
            <div
              v-if="deployResult?.warnings?.length"
              class="deploy-warning-list"
              role="status"
            >
              <div class="deploy-warning-head">
                <AlertTriangle :size="16" aria-hidden="true" />
                <strong>Nginx 检查警告</strong>
              </div>
              <p v-for="warning in deployResult.warnings" :key="warning.code + warning.message">
                {{ warning.message }}
              </p>
            </div>
            <div v-if="deployResult && !isDeploying" class="command-meta">
              <span class="command-stat"
                >容器: {{ deployResult.containerName || "-" }}</span
              >
              <span class="command-stat"
                >镜像: {{ deployResult.imageRef || "-" }}</span
              >
            </div>
          </div>
        </div>
      </div>

      <footer class="console-foot">
        <div class="console-status">
          <span class="state-pill" :class="deployTone">{{ deployLabel }}</span>
          <p class="console-hint" :title="deployHint">{{ deployHint }}</p>
        </div>
        <div class="console-actions">
          <button
            class="secondary-button"
            type="button"
            :disabled="!hasDeploymentBridge"
            @click="refreshDeployPreview"
          >
            刷新预览
          </button>
          <button
            class="secondary-button"
            type="button"
            @click="emit('open-logs')"
          >
            查看日志
          </button>
          <button
            class="primary-button"
            type="button"
            :class="{ 'is-loading': isDeploying }"
            :aria-busy="isDeploying"
            :disabled="!canDeploy || isDeploying"
            @click="runDeployment"
          >
            <span v-if="isDeploying" class="btn-spinner" aria-hidden="true"></span>
            {{ isDeploying ? "部署中…" : "开始部署" }}
          </button>
        </div>
      </footer>
    </section>
  </div>
</template>
