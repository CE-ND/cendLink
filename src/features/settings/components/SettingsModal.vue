<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Moon, Sun, X } from '@lucide/vue'
import { useWorkspaceSession } from '../../workspace/composables/useWorkspaceSession.js'
import { useTheme } from '../../../composables/useTheme.js'
import { useFocusTrap } from '../../../composables/useFocusTrap.js'

// 设置以模态框形式展示，由左下角入口触发，不再占用独立路由页面。
const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['close'])

const {
  workspaceSettings,
  settingsResult,
  isSavingSettings,
  hasStorageBridge,
  hasElectronBridge,
  storageInfo,
  updateWorkspaceSettings,
  saveWorkspaceSettings,
} = useWorkspaceSession()

// 主题在此即时切换并持久化，与命令超时（需点保存）不同，无需走保存按钮。
const { theme, setTheme } = useTheme()

// 弹层焦点管理：打开移焦入面板、Tab 循环、关闭归还焦点。
const modalRef = ref(null)
useFocusTrap(() => props.open, () => modalRef.value)

const THEME_OPTIONS = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]

// 在系统文件管理器中打开本地数据目录。
async function openStorageDir() {
  const bridge = globalThis.window?.cendlink?.data

  if (!bridge?.openStorageDir) {
    return
  }

  await bridge.openStorageDir()
}

function handleKeydown(event) {
  if (event.key === 'Escape' && props.open) {
    emit('close')
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <teleport to="body">
    <transition name="settings-modal">
      <div v-if="open" class="settings-modal-backdrop" @click="emit('close')">
        <section
          ref="modalRef"
          class="settings-modal"
          role="dialog"
          aria-modal="true"
          aria-label="设置"
          @click.stop
        >
          <header class="settings-modal-header">
            <div>
              <h3>设置</h3>
              <p>工作区偏好与本地运行信息，保存后写入本地。</p>
            </div>
            <button class="settings-modal-close" type="button" aria-label="关闭" @click="emit('close')">
              <X :size="18" />
            </button>
          </header>

          <div class="settings-modal-body">
            <section class="settings-group">
              <div class="settings-group-head">
                <strong>外观</strong>
                <span>{{ theme === 'dark' ? '深色' : '浅色' }}</span>
              </div>

              <div class="settings-row">
                <span class="settings-row-copy">
                  <strong>主题</strong>
                  <small>切换应用整体的浅色 / 深色外观，选择后立即生效并保存到本地。</small>
                </span>

                <div
                  class="theme-segment"
                  :class="{ 'is-dark': theme === 'dark' }"
                  role="radiogroup"
                  aria-label="主题"
                >
                  <span class="theme-segment-thumb" aria-hidden="true"></span>
                  <button
                    v-for="option in THEME_OPTIONS"
                    :key="option.value"
                    type="button"
                    class="theme-segment-item"
                    :class="{ active: theme === option.value }"
                    role="radio"
                    :aria-checked="theme === option.value"
                    @click="setTheme(option.value)"
                  >
                    <Sun v-if="option.value === 'light'" :size="15" aria-hidden="true" />
                    <Moon v-else :size="15" aria-hidden="true" />
                    <span>{{ option.label }}</span>
                  </button>
                </div>
              </div>
            </section>

            <section class="settings-group">
              <div class="settings-group-head">
                <strong>远程命令</strong>
                <span>{{ hasStorageBridge ? '已连接本地设置' : '预览模式' }}</span>
              </div>

              <label class="settings-row">
                <span class="settings-row-copy">
                  <strong>命令超时</strong>
                  <small>超过该时间后自动中断本次 SSH 命令，避免 Docker 查询或日志命令长期无响应。</small>
                </span>

                <span class="settings-input-unit">
                  <input
                    :value="workspaceSettings.commandTimeoutSeconds"
                    type="number"
                    min="5"
                    max="600"
                    step="5"
                    @input="updateWorkspaceSettings({ commandTimeoutSeconds: $event.target.value })"
                  />
                  <b>秒</b>
                </span>
              </label>
            </section>

            <section class="settings-group">
              <div class="settings-group-head">
                <strong>本地存储</strong>
                <span>~/.cendLink</span>
              </div>

              <div class="settings-row settings-path-row">
                <span class="settings-row-copy">
                  <strong>数据目录</strong>
                  <small class="settings-path" :title="storageInfo?.dataDir">
                    {{ storageInfo?.dataDir || '—' }}
                  </small>
                </span>
                <button
                  type="button"
                  class="secondary-button compact-button"
                  :disabled="!storageInfo?.dataDir"
                  @click="openStorageDir"
                >
                  打开
                </button>
              </div>

              <div class="settings-row settings-path-row">
                <span class="settings-row-copy">
                  <strong>数据库文件</strong>
                  <small class="settings-path" :title="storageInfo?.dbPath">
                    {{ storageInfo?.dbPath || '—' }}
                  </small>
                </span>
              </div>

              <div class="settings-row settings-path-row">
                <span class="settings-row-copy">
                  <strong>日志目录</strong>
                  <small class="settings-path" :title="storageInfo?.logsDir">
                    {{ storageInfo?.logsDir || '—' }}
                  </small>
                </span>
              </div>
            </section>

            <section class="settings-group">
              <div class="settings-group-head">
                <strong>关于</strong>
                <span>CendLink</span>
              </div>

              <div class="settings-row">
                <span class="settings-row-copy"><strong>应用</strong></span>
                <span class="settings-value">CendLink 远程部署工具</span>
              </div>

              <div class="settings-row">
                <span class="settings-row-copy"><strong>版本</strong></span>
                <span class="settings-value mono">v{{ storageInfo?.appVersion || '1.0.0' }}</span>
              </div>

              <div class="settings-row">
                <span class="settings-row-copy"><strong>运行模式</strong></span>
                <span class="settings-value" :class="{ ok: hasElectronBridge }">
                  {{ hasElectronBridge ? 'Electron 桌面' : '浏览器预览' }}
                </span>
              </div>
            </section>
          </div>

          <footer class="settings-modal-footer">
            <p
              v-if="settingsResult"
              class="result-message settings-message"
              :class="{ ok: settingsResult.ok }"
            >
              {{ settingsResult.message }}
            </p>
            <span v-else class="settings-footer-hint">修改命令超时后需保存生效</span>

            <button
              class="primary-button"
              type="button"
              :disabled="isSavingSettings || !hasStorageBridge"
              @click="saveWorkspaceSettings"
            >
              {{ isSavingSettings ? '保存中...' : '保存设置' }}
            </button>
          </footer>
        </section>
      </div>
    </transition>
  </teleport>
</template>
