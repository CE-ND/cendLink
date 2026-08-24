<script setup>
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  Clipboard,
  Download,
  File as FileIcon,
  FileCode2,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  LoaderCircle,
  MessageSquareText,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Upload,
  UploadCloud,
  X,
} from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import InlineDeleteConfirm from '../../../components/ui/InlineDeleteConfirm.vue'
import { usePageEntrance } from '../../../composables/usePageEntrance.js'
import { useWorkspaceSession } from '../../workspace/composables/useWorkspaceSession.js'

const ARCHIVE_PATTERN = /\.(?:zip|rar|7z|tar|gz|tgz|bz2|xz)$/i
const IMAGE_PATTERN = /\.(?:png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i
const CODE_PATTERN = /\.(?:js|mjs|cjs|ts|tsx|jsx|vue|css|scss|less|html?|json|ya?ml|xml|sh|py|java|go|rs|sql|conf|ini|env)$/i
const TEXT_PATTERN = /\.(?:txt|md|log|csv|properties|toml)$/i

const router = useRouter()
const {
  form,
  result,
  needsRetest,
  hasElectronBridge,
  savedServers,
  activeServerId,
} = useWorkspaceSession()

const pageRef = ref(null)
const tableScrollRef = ref(null)
const pathInputRef = ref(null)
const renameInputRef = ref(null)
const newFolderInputRef = ref(null)
usePageEntrance(pageRef)

const currentPath = ref('/')
const pathInput = ref('/')
const isPathEditing = ref(false)
const entries = ref([])
const isLoading = ref(false)
const loadError = ref('')
const filterText = ref('')
const sortKey = ref('name')
const sortDirection = ref('asc')
const selectedPaths = ref(new Set())
const lastSelectedPath = ref('')
const historyPaths = ref(['/'])
const historyIndex = ref(0)
const dragDepth = ref(0)
const isDragActive = ref(false)
const isUploading = ref(false)
const uploadItems = ref([])
const uploadConflict = ref(null)
const pendingDeleteEntries = ref([])
const isDeleting = ref(false)
const renameTargetPath = ref('')
const renameName = ref('')
const renameError = ref('')
const isRenaming = ref(false)
const isNewFolderOpen = ref(false)
const newFolderName = ref('')
const newFolderError = ref('')
const isCreatingFolder = ref(false)
const annotationsByPath = ref({})
const annotationDraft = ref('')
const annotationError = ref('')
const isSavingAnnotation = ref(false)
const operationNotice = ref(null)
const contextMenu = ref(null)
let loadRequestId = 0

const remoteFilesBridge = computed(() => {
  return typeof window === 'undefined' ? null : window.cendlink?.remoteFiles || null
})

const hasRemoteFileBridge = computed(() => {
  const bridge = remoteFilesBridge.value
  return Boolean(
    bridge?.list &&
      bridge?.selectUploadFiles &&
      bridge?.upload &&
      bridge?.createDirectory &&
      bridge?.rename &&
      bridge?.delete &&
      bridge?.download &&
      bridge?.listAnnotations &&
      bridge?.saveAnnotation,
  )
})

const canBrowse = computed(() => {
  return Boolean(
    hasElectronBridge.value &&
      hasRemoteFileBridge.value &&
      result.value?.ok &&
      !needsRetest.value,
  )
})

const selectedServer = computed(() => {
  return savedServers.value.find((server) => server.id === activeServerId.value) || null
})

const annotationServerKey = computed(() => {
  if (selectedServer.value?.id) {
    return `server:${selectedServer.value.id}`
  }

  const host = String(form.host || '').trim().toLocaleLowerCase('en-US')
  const username = String(form.username || '').trim()
  const port = Number(form.port || 22)
  return host && username ? `connection:${username}@${host}:${port}` : ''
})

const connectionLabel = computed(() => {
  if (!selectedServer.value) {
    return form.host ? `${form.username}@${form.host}:${form.port}` : '未选择服务器'
  }

  return `${selectedServer.value.name} · ${selectedServer.value.host}:${selectedServer.value.port}`
})

const connectionHint = computed(() => {
  if (!hasRemoteFileBridge.value) {
    return '文件管理模块尚未加载，请完全关闭并重新启动 CendLink。'
  }

  if (!hasElectronBridge.value) {
    return '请通过 Electron 桌面应用打开文件管理。'
  }

  if (!result.value?.ok) {
    return '请先在服务器页完成连接测试。'
  }

  if (needsRetest.value) {
    return '服务器连接信息已变更，请重新测试连接。'
  }

  return ''
})

const breadcrumbItems = computed(() => {
  const parts = currentPath.value.split('/').filter(Boolean)
  const items = [{ name: '/', path: '/' }]
  let value = ''

  for (const part of parts) {
    value += `/${part}`
    items.push({ name: part, path: value })
  }

  return items
})

const selectedEntries = computed(() => {
  return entries.value.filter((entry) => selectedPaths.value.has(entry.path))
})

const visibleEntries = computed(() => {
  const query = filterText.value.trim().toLocaleLowerCase('zh-CN')
  const filtered = query
    ? entries.value.filter((entry) => entry.name.toLocaleLowerCase('zh-CN').includes(query))
    : [...entries.value]

  return filtered.sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) {
      return left.isDirectory ? -1 : 1
    }

    const direction = sortDirection.value === 'asc' ? 1 : -1
    let comparison = 0

    if (sortKey.value === 'size') {
      comparison = Number(left.size || 0) - Number(right.size || 0)
    } else if (sortKey.value === 'modifiedAt') {
      comparison = Date.parse(left.modifiedAt || 0) - Date.parse(right.modifiedAt || 0)
    } else if (sortKey.value === 'type') {
      comparison = entryTypeLabel(left).localeCompare(entryTypeLabel(right), 'zh-CN')
    } else {
      comparison = left.name.localeCompare(right.name, 'zh-CN', {
        numeric: true,
        sensitivity: 'base',
      })
    }

    return comparison * direction
  })
})

const selectedSize = computed(() => {
  return selectedEntries.value.reduce((total, entry) => {
    return entry.isDirectory ? total : total + Number(entry.size || 0)
  }, 0)
})

const selectedDetail = computed(() => {
  return selectedEntries.value.length === 1 ? selectedEntries.value[0] : null
})

const selectedAnnotation = computed(() => {
  const remotePath = selectedDetail.value?.path
  return remotePath ? annotationsByPath.value[remotePath]?.annotation || '' : ''
})

const isAnnotationDirty = computed(() => {
  return Boolean(selectedDetail.value) && annotationDraft.value.trim() !== selectedAnnotation.value
})

const uploadSummary = computed(() => {
  if (!uploadItems.value.length) {
    return null
  }

  const succeeded = uploadItems.value.filter((item) => item.status === 'success').length
  const failed = uploadItems.value.filter((item) => item.status === 'failed').length
  const running = uploadItems.value.filter((item) => item.status === 'uploading').length

  return {
    total: uploadItems.value.length,
    succeeded,
    failed,
    running,
    completed: succeeded + failed,
  }
})

const deleteTitle = computed(() => {
  const count = pendingDeleteEntries.value.length
  return count > 1 ? `永久删除 ${count} 个项目？` : `永久删除“${pendingDeleteEntries.value[0]?.name || ''}”？`
})

const deleteMessage = computed(() => {
  const directoryCount = pendingDeleteEntries.value.filter((entry) => entry.isDirectory).length
  const suffix = directoryCount ? '所选目录中的全部内容也会被删除。' : ''
  return `此操作不会进入回收站，删除后无法恢复。${suffix}`
})

const canGoBack = computed(() => historyIndex.value > 0 && !isLoading.value)
const canGoForward = computed(() => historyIndex.value < historyPaths.value.length - 1 && !isLoading.value)
const canGoUp = computed(() => currentPath.value !== '/' && !isLoading.value)

function getConnectionPayload() {
  return { ...form }
}

async function loadDirectory(targetPath = currentPath.value, options = {}) {
  const bridge = remoteFilesBridge.value

  if (!canBrowse.value || !bridge?.list) {
    return false
  }

  const requestId = ++loadRequestId
  isLoading.value = true
  loadError.value = ''
  closeContextMenu()

  try {
    const response = await bridge.list(getConnectionPayload(), targetPath)

    if (requestId !== loadRequestId) {
      return false
    }

    if (!response?.ok) {
      loadError.value = response?.message || `无法读取目录 ${targetPath}`
      return false
    }

    currentPath.value = response.path || targetPath
    pathInput.value = currentPath.value
    entries.value = Array.isArray(response.entries) ? response.entries : []
    await loadEntryAnnotations(entries.value, requestId)
    clearSelection()
    cancelRename()
    cancelNewFolder()

    if (options.pushHistory !== false) {
      pushHistory(currentPath.value)
    }

    await nextTick()
    tableScrollRef.value?.scrollTo({ top: 0 })
    return true
  } catch (error) {
    if (requestId === loadRequestId) {
      loadError.value = error?.message || String(error)
    }
    return false
  } finally {
    if (requestId === loadRequestId) {
      isLoading.value = false
    }
  }
}

async function loadEntryAnnotations(directoryEntries, requestId = loadRequestId) {
  const bridge = remoteFilesBridge.value
  const serverKey = annotationServerKey.value
  const paths = directoryEntries.map((entry) => entry.path)

  annotationsByPath.value = {}
  if (!bridge?.listAnnotations || !serverKey || !paths.length) return

  try {
    const response = await bridge.listAnnotations(serverKey, paths)
    if (requestId !== loadRequestId || !response?.ok) return

    annotationsByPath.value = Object.fromEntries(
      (response.annotations || []).map((item) => [item.remotePath, item]),
    )
  } catch {
    // Annotation metadata must never prevent the remote directory itself from loading.
  }
}

function pushHistory(remotePath) {
  if (historyPaths.value[historyIndex.value] === remotePath) {
    return
  }

  historyPaths.value = [
    ...historyPaths.value.slice(0, historyIndex.value + 1),
    remotePath,
  ]
  historyIndex.value = historyPaths.value.length - 1
}

async function goBack() {
  if (!canGoBack.value) return
  const nextIndex = historyIndex.value - 1
  const succeeded = await loadDirectory(historyPaths.value[nextIndex], { pushHistory: false })
  if (succeeded) historyIndex.value = nextIndex
}

async function goForward() {
  if (!canGoForward.value) return
  const nextIndex = historyIndex.value + 1
  const succeeded = await loadDirectory(historyPaths.value[nextIndex], { pushHistory: false })
  if (succeeded) historyIndex.value = nextIndex
}

function goUp() {
  if (!canGoUp.value) return
  const parent = currentPath.value.split('/').slice(0, -1).join('/') || '/'
  void loadDirectory(parent)
}

function openPathEditor() {
  pathInput.value = currentPath.value
  isPathEditing.value = true
  void nextTick(() => {
    pathInputRef.value?.focus()
    pathInputRef.value?.select()
  })
}

function cancelPathEditor() {
  isPathEditing.value = false
  pathInput.value = currentPath.value
}

async function submitPath() {
  const succeeded = await loadDirectory(pathInput.value)
  if (succeeded) {
    isPathEditing.value = false
  }
}

function setSort(key) {
  if (sortKey.value === key) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
    return
  }

  sortKey.value = key
  sortDirection.value = 'asc'
}

function selectEntry(entry, event, index) {
  const current = new Set(selectedPaths.value)
  const toggle = event?.ctrlKey || event?.metaKey

  if (event?.shiftKey && lastSelectedPath.value) {
    const anchorIndex = visibleEntries.value.findIndex((item) => item.path === lastSelectedPath.value)
    if (anchorIndex >= 0) {
      const start = Math.min(anchorIndex, index)
      const end = Math.max(anchorIndex, index)
      if (!toggle) current.clear()
      visibleEntries.value.slice(start, end + 1).forEach((item) => current.add(item.path))
    }
  } else if (toggle) {
    current.has(entry.path) ? current.delete(entry.path) : current.add(entry.path)
  } else {
    current.clear()
    current.add(entry.path)
  }

  selectedPaths.value = current
  lastSelectedPath.value = entry.path
  closeContextMenu()
}

function clearSelection() {
  selectedPaths.value = new Set()
  lastSelectedPath.value = ''
}

function openEntry(entry) {
  if (entry.isDirectory) {
    void loadDirectory(entry.path)
    return
  }

  selectedPaths.value = new Set([entry.path])
  lastSelectedPath.value = entry.path
}

function showContextMenu(event, entry) {
  event.preventDefault()
  if (!selectedPaths.value.has(entry.path)) {
    selectedPaths.value = new Set([entry.path])
    lastSelectedPath.value = entry.path
  }

  contextMenu.value = {
    entry,
    x: Math.min(event.clientX, window.innerWidth - 196),
    y: Math.min(event.clientY, window.innerHeight - 260),
  }
}

function closeContextMenu() {
  contextMenu.value = null
}

function handleDocumentPointerDown(event) {
  if (!contextMenu.value) return
  if (event.target?.closest?.('.remote-file-context-menu')) return
  closeContextMenu()
}

function startRename(entry = selectedDetail.value) {
  if (!entry || isDeleting.value || isUploading.value) return
  renameTargetPath.value = entry.path
  renameName.value = entry.name
  renameError.value = ''
  closeContextMenu()
  void nextTick(() => {
    renameInputRef.value?.focus()
    renameInputRef.value?.select()
  })
}

function cancelRename() {
  if (isRenaming.value) return
  renameTargetPath.value = ''
  renameName.value = ''
  renameError.value = ''
}

async function saveRename() {
  const bridge = remoteFilesBridge.value
  const target = entries.value.find((entry) => entry.path === renameTargetPath.value)
  const name = renameName.value.trim()

  if (!target || !bridge?.rename) return
  if (!name) {
    renameError.value = '名称不能为空'
    return
  }

  isRenaming.value = true
  renameError.value = ''

  try {
    const response = await bridge.rename(getConnectionPayload(), {
      path: target.path,
      newName: name,
      serverKey: annotationServerKey.value,
    })

    if (!response?.ok) {
      renameError.value = response?.message || '重命名失败'
      return
    }

    setNotice(
      response.annotationWarning ? 'error' : 'success',
      response.annotationWarning
        ? `文件已重命名，但注解同步失败：${response.annotationWarning}`
        : `已重命名为“${name}”`,
    )
    renameTargetPath.value = ''
    await loadDirectory(currentPath.value, { pushHistory: false })
  } catch (error) {
    renameError.value = error?.message || String(error)
  } finally {
    isRenaming.value = false
  }
}

function openNewFolder() {
  isNewFolderOpen.value = true
  newFolderName.value = '新建文件夹'
  newFolderError.value = ''
  void nextTick(() => {
    newFolderInputRef.value?.focus()
    newFolderInputRef.value?.select()
  })
}

function cancelNewFolder() {
  if (isCreatingFolder.value) return
  isNewFolderOpen.value = false
  newFolderName.value = ''
  newFolderError.value = ''
}

async function createFolder() {
  const bridge = remoteFilesBridge.value
  const name = newFolderName.value.trim()

  if (!bridge?.createDirectory) return
  if (!name) {
    newFolderError.value = '文件夹名称不能为空'
    return
  }

  isCreatingFolder.value = true
  newFolderError.value = ''

  try {
    const response = await bridge.createDirectory(getConnectionPayload(), {
      parentPath: currentPath.value,
      name,
    })

    if (!response?.ok) {
      newFolderError.value = response?.message || '新建文件夹失败'
      return
    }

    setNotice('success', `已创建文件夹“${name}”`)
    isNewFolderOpen.value = false
    await loadDirectory(currentPath.value, { pushHistory: false })
  } catch (error) {
    newFolderError.value = error?.message || String(error)
  } finally {
    isCreatingFolder.value = false
  }
}

function requestDelete(targets = selectedEntries.value) {
  const normalized = Array.isArray(targets) ? targets : [targets]
  if (!normalized.length || normalized.some((entry) => entry.path === '/')) return
  pendingDeleteEntries.value = normalized
  closeContextMenu()
}

function cancelDelete() {
  if (!isDeleting.value) pendingDeleteEntries.value = []
}

async function confirmDelete() {
  const bridge = remoteFilesBridge.value
  if (!bridge?.delete || !pendingDeleteEntries.value.length || isDeleting.value) return

  isDeleting.value = true
  const targets = [...pendingDeleteEntries.value]

  try {
    const response = await bridge.delete(
      getConnectionPayload(),
      targets.map((entry) => entry.path),
      annotationServerKey.value,
    )

    if (!response?.ok) {
      setNotice('error', response?.message || '永久删除失败')
      return
    }

    setNotice(
      response.annotationWarning ? 'error' : 'success',
      response.annotationWarning
        ? `项目已删除，但注解清理失败：${response.annotationWarning}`
        : `已永久删除 ${targets.length} 个项目`,
    )
    pendingDeleteEntries.value = []
    await loadDirectory(currentPath.value, { pushHistory: false })
  } catch (error) {
    setNotice('error', error?.message || String(error))
  } finally {
    isDeleting.value = false
  }
}

async function chooseUploadFiles() {
  const bridge = remoteFilesBridge.value
  if (!bridge?.selectUploadFiles || isUploading.value) return

  const result = await bridge.selectUploadFiles()
  if (result?.canceled || !result?.filePaths?.length) return
  await queueUploadPaths(result.filePaths)
}

async function queueUploadPaths(paths) {
  const uniquePaths = [...new Set(paths.map((item) => String(item || '').trim()).filter(Boolean))]
  if (!uniquePaths.length) {
    setNotice('error', '没有读取到可上传的本地文件')
    return
  }

  const currentNames = new Set(entries.value.map((entry) => entry.name))
  const conflicts = uniquePaths
    .map((localPath) => fileNameFromLocalPath(localPath))
    .filter((name) => currentNames.has(name))

  if (conflicts.length) {
    uploadConflict.value = {
      paths: uniquePaths,
      names: [...new Set(conflicts)],
    }
    return
  }

  await uploadPaths(uniquePaths, false)
}

async function resolveUploadConflict(overwrite) {
  const conflict = uploadConflict.value
  uploadConflict.value = null
  if (!conflict) return

  if (overwrite) {
    await uploadPaths(conflict.paths, true)
    return
  }

  const conflictNames = new Set(conflict.names)
  const remaining = conflict.paths.filter((localPath) => !conflictNames.has(fileNameFromLocalPath(localPath)))
  if (remaining.length) {
    await uploadPaths(remaining, false)
  }
}

async function uploadPaths(paths, overwrite) {
  const bridge = remoteFilesBridge.value
  if (!bridge?.upload || isUploading.value) return

  isUploading.value = true
  uploadItems.value = paths.map((localPath) => ({
    localPath,
    name: fileNameFromLocalPath(localPath),
    status: 'pending',
    message: '',
  }))

  for (let index = 0; index < uploadItems.value.length; index += 1) {
    uploadItems.value[index] = { ...uploadItems.value[index], status: 'uploading' }
    const item = uploadItems.value[index]

    try {
      const response = await bridge.upload(getConnectionPayload(), {
        localPath: item.localPath,
        remoteDir: currentPath.value,
        overwrite,
      })

      uploadItems.value[index] = {
        ...item,
        status: response?.ok ? 'success' : 'failed',
        message: response?.ok
          ? response.overwritten ? '已覆盖' : '已上传'
          : response?.message || '上传失败',
      }
    } catch (error) {
      uploadItems.value[index] = {
        ...item,
        status: 'failed',
        message: error?.message || String(error),
      }
    }
  }

  isUploading.value = false
  const failed = uploadItems.value.filter((item) => item.status === 'failed').length
  setNotice(
    failed ? 'error' : 'success',
    failed
      ? `上传完成，${failed} 个文件失败，可在传输队列中查看原因。`
      : `已上传 ${uploadItems.value.length} 个文件到 ${currentPath.value}`,
  )
  await loadDirectory(currentPath.value, { pushHistory: false })
}

async function handleDrop(event) {
  dragDepth.value = 0
  isDragActive.value = false
  if (!canBrowse.value || isUploading.value) return

  const files = Array.from(event.dataTransfer?.files || [])
  const paths = []

  for (const file of files) {
    try {
      const localPath = String(window.cendlink?.files?.getPathForFile?.(file) || file.path || '').trim()
      if (localPath) paths.push(localPath)
    } catch {
      // 单个文件路径解析失败时继续处理其他文件。
    }
  }

  await queueUploadPaths(paths)
}

function handleDragEnter(event) {
  if (!canBrowse.value || isUploading.value) return
  dragDepth.value += 1
  isDragActive.value = true
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function handleDragOver(event) {
  if (canBrowse.value && !isUploading.value && event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
}

function handleDragLeave() {
  dragDepth.value = Math.max(0, dragDepth.value - 1)
  if (dragDepth.value === 0) isDragActive.value = false
}

function preventWindowFileDrop(event) {
  event.preventDefault()
}

async function downloadEntry(entry = selectedDetail.value) {
  const bridge = remoteFilesBridge.value
  if (!entry || entry.isDirectory || !bridge?.download) return
  closeContextMenu()

  try {
    const response = await bridge.download(getConnectionPayload(), entry.path)
    if (response?.canceled) return
    if (!response?.ok) {
      setNotice('error', response?.message || '下载失败')
      return
    }
    setNotice('success', `“${entry.name}”已保存到本地`)
  } catch (error) {
    setNotice('error', error?.message || String(error))
  }
}

async function copyEntryPath(entry = selectedDetail.value) {
  if (!entry?.path) return
  closeContextMenu()
  try {
    await navigator.clipboard.writeText(entry.path)
    setNotice('success', '远程路径已复制')
  } catch {
    setNotice('error', '无法复制路径，请检查剪贴板权限')
  }
}

async function saveSelectedAnnotation() {
  const bridge = remoteFilesBridge.value
  const entry = selectedDetail.value
  const serverKey = annotationServerKey.value

  if (!bridge?.saveAnnotation || !entry || !serverKey || isSavingAnnotation.value) return

  isSavingAnnotation.value = true
  annotationError.value = ''

  try {
    const response = await bridge.saveAnnotation(
      serverKey,
      entry.path,
      annotationDraft.value,
    )

    if (!response?.ok) {
      annotationError.value = response?.message || '保存注解失败'
      return
    }

    const nextAnnotations = { ...annotationsByPath.value }
    if (response.item?.annotation) {
      nextAnnotations[entry.path] = response.item
      annotationDraft.value = response.item.annotation
    } else {
      delete nextAnnotations[entry.path]
      annotationDraft.value = ''
    }
    annotationsByPath.value = nextAnnotations
    setNotice('success', response.item?.annotation ? '文件注解已保存' : '文件注解已清空')
  } catch (error) {
    annotationError.value = error?.message || String(error)
  } finally {
    isSavingAnnotation.value = false
  }
}

function clearSelectedAnnotation() {
  annotationDraft.value = ''
  void saveSelectedAnnotation()
}

function hasAnnotation(remotePath) {
  return Boolean(annotationsByPath.value[remotePath]?.annotation)
}

function setNotice(type, message) {
  operationNotice.value = { type, message, id: Date.now() }
}

function dismissNotice() {
  operationNotice.value = null
}

function handleGlobalKeydown(event) {
  const target = event.target
  const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) || target?.isContentEditable

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
    event.preventDefault()
    openPathEditor()
    return
  }

  if (isTyping) return

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') {
    event.preventDefault()
    void loadDirectory(currentPath.value, { pushHistory: false })
  } else if (event.key === 'F2' && selectedEntries.value.length === 1) {
    event.preventDefault()
    startRename()
  } else if (event.key === 'Delete' && selectedEntries.value.length) {
    event.preventDefault()
    requestDelete()
  } else if (event.key === 'Enter' && selectedEntries.value.length === 1) {
    openEntry(selectedEntries.value[0])
  } else if (event.key === 'Escape') {
    closeContextMenu()
    cancelRename()
    cancelNewFolder()
    uploadConflict.value = null
  }
}

function handleRowKeydown(event, entry) {
  if (event.key === 'Enter') {
    event.preventDefault()
    openEntry(entry)
  } else if (event.key === ' ') {
    event.preventDefault()
    selectEntry(entry, event, visibleEntries.value.indexOf(entry))
  }
}

function entryIcon(entry) {
  if (entry.isDirectory) return Folder
  if (IMAGE_PATTERN.test(entry.name)) return FileImage
  if (ARCHIVE_PATTERN.test(entry.name)) return Archive
  if (CODE_PATTERN.test(entry.name)) return FileCode2
  if (TEXT_PATTERN.test(entry.name)) return FileText
  return FileIcon
}

function entryTypeLabel(entry) {
  if (entry.isDirectory) return '文件夹'
  if (entry.isSymlink) return '符号链接'
  const extension = entry.name.includes('.') ? entry.name.split('.').pop().toUpperCase() : ''
  return extension ? `${extension} 文件` : '文件'
}

function formatFileSize(value, isDirectory = false) {
  if (isDirectory) return '—'
  const bytes = Number(value || 0)
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unitIndex = -1
  do {
    size /= 1024
    unitIndex += 1
  } while (size >= 1024 && unitIndex < units.length - 1)
  return `${size >= 100 ? size.toFixed(0) : size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[unitIndex]}`
}

function formatFileTime(value) {
  if (!value) return '—'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function fileNameFromLocalPath(localPath) {
  return String(localPath || '').split(/[\\/]/).filter(Boolean).pop() || String(localPath || '')
}

function resetForServer() {
  currentPath.value = '/'
  pathInput.value = '/'
  historyPaths.value = ['/']
  historyIndex.value = 0
  entries.value = []
  annotationsByPath.value = {}
  annotationDraft.value = ''
  annotationError.value = ''
  clearSelection()
  uploadItems.value = []
  operationNotice.value = null
  if (canBrowse.value) void loadDirectory('/', { pushHistory: false })
}

onMounted(() => {
  window.addEventListener('dragover', preventWindowFileDrop)
  window.addEventListener('drop', preventWindowFileDrop)
  window.addEventListener('keydown', handleGlobalKeydown)
  document.addEventListener('pointerdown', handleDocumentPointerDown, true)
  if (canBrowse.value) void loadDirectory('/', { pushHistory: false })
})

onBeforeUnmount(() => {
  window.removeEventListener('dragover', preventWindowFileDrop)
  window.removeEventListener('drop', preventWindowFileDrop)
  window.removeEventListener('keydown', handleGlobalKeydown)
  document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
})

watch(activeServerId, resetForServer)
watch(
  () => selectedDetail.value?.path,
  () => {
    annotationDraft.value = selectedAnnotation.value
    annotationError.value = ''
  },
)
watch(
  () => [result.value?.ok, needsRetest.value, hasRemoteFileBridge.value],
  ([connected, retest, bridgeReady], previous = []) => {
    if (connected && !retest && bridgeReady && (!previous[0] || previous[1] || !previous[2])) {
      void loadDirectory(currentPath.value, { pushHistory: false })
    }
  },
)
</script>

<template>
  <div ref="pageRef" class="remote-file-manager-view">
    <section class="remote-file-shell">
      <header class="remote-file-toolbar">
        <div class="remote-file-history-actions" aria-label="目录导航">
          <button type="button" title="后退" aria-label="后退" :disabled="!canGoBack" @click="goBack">
            <ArrowLeft :size="17" aria-hidden="true" />
          </button>
          <button type="button" title="前进" aria-label="前进" :disabled="!canGoForward" @click="goForward">
            <ArrowRight :size="17" aria-hidden="true" />
          </button>
          <button type="button" title="上一级" aria-label="上一级" :disabled="!canGoUp" @click="goUp">
            <ArrowUp :size="17" aria-hidden="true" />
          </button>
          <button
            type="button"
            title="刷新当前目录"
            aria-label="刷新当前目录"
            :disabled="!canBrowse || isLoading"
            @click="loadDirectory(currentPath, { pushHistory: false })"
          >
            <RefreshCw :class="{ spinning: isLoading }" :size="16" aria-hidden="true" />
          </button>
        </div>

        <div class="remote-path-bar" :class="{ editing: isPathEditing }">
          <template v-if="!isPathEditing">
            <button
              v-for="(item, index) in breadcrumbItems"
              :key="item.path"
              type="button"
              class="remote-path-crumb"
              :title="item.path"
              @click="loadDirectory(item.path)"
            >
              <HardDrive v-if="index === 0" :size="14" aria-hidden="true" />
              <span>{{ item.name }}</span>
              <ChevronRight v-if="index < breadcrumbItems.length - 1" :size="13" aria-hidden="true" />
            </button>
            <button class="remote-path-edit-trigger" type="button" aria-label="编辑远程路径" @click="openPathEditor"></button>
          </template>
          <input
            v-else
            ref="pathInputRef"
            v-model="pathInput"
            type="text"
            autocomplete="off"
            spellcheck="false"
            aria-label="远程路径"
            @keydown.enter.prevent="submitPath"
            @keydown.esc.prevent="cancelPathEditor"
            @blur="cancelPathEditor"
          />
        </div>

        <label class="remote-file-filter">
          <Search :size="15" aria-hidden="true" />
          <input v-model="filterText" type="search" placeholder="筛选当前目录" aria-label="筛选当前目录" />
        </label>

        <div class="remote-file-primary-actions">
          <button
            type="button"
            class="remote-file-tool-button"
            :disabled="!canBrowse || isLoading || isCreatingFolder"
            @click="openNewFolder"
          >
            <FolderPlus :size="16" aria-hidden="true" />
            <span>新建文件夹</span>
          </button>
          <button
            type="button"
            class="primary-button remote-file-upload-button"
            :disabled="!canBrowse || isUploading"
            @click="chooseUploadFiles"
          >
            <LoaderCircle v-if="isUploading" class="spinning" :size="16" aria-hidden="true" />
            <Upload v-else :size="16" aria-hidden="true" />
            <span>{{ isUploading ? '上传中' : '上传文件' }}</span>
          </button>
        </div>
      </header>

      <div class="remote-file-context-bar">
        <div class="remote-file-server-context">
          <span class="container-status-dot" :class="{ running: canBrowse, neutral: !canBrowse }"></span>
          <strong>{{ connectionLabel }}</strong>
          <small>{{ canBrowse ? 'SFTP 已就绪' : '等待连接' }}</small>
        </div>

        <div v-if="selectedEntries.length" class="remote-file-selection-actions">
          <span>已选 {{ selectedEntries.length }} 项</span>
          <button type="button" :disabled="selectedEntries.length !== 1" @click="startRename()">
            <Pencil :size="14" aria-hidden="true" />重命名
          </button>
          <button type="button" :disabled="selectedEntries.length !== 1 || selectedDetail?.isDirectory" @click="downloadEntry()">
            <Download :size="14" aria-hidden="true" />下载
          </button>
          <button type="button" class="danger" @click="requestDelete()">
            <Trash2 :size="14" aria-hidden="true" />永久删除
          </button>
        </div>
      </div>

      <InlineDeleteConfirm
        v-if="pendingDeleteEntries.length"
        class="remote-file-inline-confirm"
        :title="deleteTitle"
        :message="deleteMessage"
        :confirm-label="`永久删除 ${pendingDeleteEntries.length} 项`"
        :busy="isDeleting"
        @cancel="cancelDelete"
        @confirm="confirmDelete"
      />

      <div v-if="uploadConflict" class="remote-file-conflict" role="alert">
        <div class="remote-file-conflict-copy">
          <UploadCloud :size="18" aria-hidden="true" />
          <div>
            <strong>{{ uploadConflict.names.length }} 个同名文件已经存在</strong>
            <p :title="uploadConflict.names.join('、')">{{ uploadConflict.names.join('、') }}</p>
          </div>
        </div>
        <div class="remote-file-conflict-actions">
          <button type="button" @click="resolveUploadConflict(false)">跳过同名文件</button>
          <button type="button" class="primary-button" @click="resolveUploadConflict(true)">覆盖并上传</button>
        </div>
      </div>

      <div class="remote-file-main">
        <div
          class="remote-file-list-stage"
          :class="{ 'is-dragging': isDragActive, disabled: !canBrowse }"
          @dragenter.prevent.stop="handleDragEnter"
          @dragover.prevent.stop="handleDragOver"
          @dragleave.prevent.stop="handleDragLeave"
          @drop.prevent.stop="handleDrop"
        >
          <div v-if="isDragActive" class="remote-file-drop-overlay" aria-hidden="true">
            <UploadCloud :size="28" />
            <strong>上传到 {{ currentPath }}</strong>
            <span>释放鼠标开始上传</span>
          </div>

          <div v-if="connectionHint" class="remote-file-empty-state">
            <HardDrive :size="28" aria-hidden="true" />
            <strong>还不能读取远程文件</strong>
            <p>{{ connectionHint }}</p>
            <button type="button" class="primary-button" @click="router.push({ name: 'servers' })">前往服务器</button>
          </div>

          <div v-else-if="loadError" class="remote-file-empty-state error">
            <HardDrive :size="28" aria-hidden="true" />
            <strong>无法打开 {{ currentPath }}</strong>
            <p>{{ loadError }}</p>
            <button type="button" class="secondary-button" @click="loadDirectory(currentPath, { pushHistory: false })">重新读取</button>
          </div>

          <div v-else ref="tableScrollRef" class="remote-file-table-scroll" @click.self="clearSelection">
            <table class="remote-file-table" aria-label="远程文件列表">
              <thead>
                <tr>
                  <th class="name-column" scope="col" :aria-sort="sortKey === 'name' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'">
                    <button type="button" @click="setSort('name')">
                      名称
                      <ArrowDown v-if="sortKey === 'name'" :class="{ desc: sortDirection === 'desc' }" :size="12" aria-hidden="true" />
                    </button>
                  </th>
                  <th class="type-column" scope="col" :aria-sort="sortKey === 'type' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'">
                    <button type="button" @click="setSort('type')">
                      类型
                      <ArrowDown v-if="sortKey === 'type'" :class="{ desc: sortDirection === 'desc' }" :size="12" aria-hidden="true" />
                    </button>
                  </th>
                  <th class="size-column" scope="col" :aria-sort="sortKey === 'size' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'">
                    <button type="button" @click="setSort('size')">
                      大小
                      <ArrowDown v-if="sortKey === 'size'" :class="{ desc: sortDirection === 'desc' }" :size="12" aria-hidden="true" />
                    </button>
                  </th>
                  <th class="modified-column" scope="col" :aria-sort="sortKey === 'modifiedAt' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'">
                    <button type="button" @click="setSort('modifiedAt')">
                      修改时间
                      <ArrowDown v-if="sortKey === 'modifiedAt'" :class="{ desc: sortDirection === 'desc' }" :size="12" aria-hidden="true" />
                    </button>
                  </th>
                  <th class="permissions-column" scope="col">权限</th>
                  <th class="owner-column" scope="col">所有者</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="isNewFolderOpen" class="remote-file-inline-row">
                  <td colspan="6">
                    <div class="remote-file-inline-editor">
                      <Folder :size="17" aria-hidden="true" />
                      <input
                        ref="newFolderInputRef"
                        v-model="newFolderName"
                        type="text"
                        autocomplete="off"
                        aria-label="新文件夹名称"
                        :aria-invalid="Boolean(newFolderError)"
                        @input="newFolderError = ''"
                        @keydown.enter.prevent="createFolder"
                        @keydown.esc.prevent="cancelNewFolder"
                      />
                      <span v-if="newFolderError" role="alert">{{ newFolderError }}</span>
                      <button type="button" :disabled="isCreatingFolder" @click="createFolder">创建</button>
                      <button type="button" :disabled="isCreatingFolder" @click="cancelNewFolder">取消</button>
                    </div>
                  </td>
                </tr>

                <template v-if="isLoading">
                  <tr v-for="index in 9" :key="`skeleton-${index}`" class="remote-file-skeleton-row" aria-hidden="true">
                    <td><span></span></td><td><span></span></td><td><span></span></td><td><span></span></td><td><span></span></td><td><span></span></td>
                  </tr>
                </template>

                <tr
                  v-for="(entry, index) in visibleEntries"
                  v-else
                  :key="entry.path"
                  tabindex="0"
                  :class="{
                    selected: selectedPaths.has(entry.path),
                    renaming: renameTargetPath === entry.path,
                  }"
                  @click="selectEntry(entry, $event, index)"
                  @dblclick="openEntry(entry)"
                  @contextmenu="showContextMenu($event, entry)"
                  @keydown="handleRowKeydown($event, entry)"
                >
                  <td class="name-column">
                    <div class="remote-file-name-cell">
                      <component :is="entryIcon(entry)" :class="{ folder: entry.isDirectory }" :size="17" aria-hidden="true" />
                      <input
                        v-if="renameTargetPath === entry.path"
                        ref="renameInputRef"
                        v-model="renameName"
                        class="remote-file-rename-input"
                        type="text"
                        autocomplete="off"
                        :aria-invalid="Boolean(renameError)"
                        @click.stop
                        @input="renameError = ''"
                        @keydown.enter.stop.prevent="saveRename"
                        @keydown.esc.stop.prevent="cancelRename"
                      />
                      <span v-else :title="entry.name">{{ entry.name }}</span>
                      <span
                        v-if="hasAnnotation(entry.path)"
                        class="remote-file-annotation-mark"
                        :title="annotationsByPath[entry.path].annotation"
                        aria-label="有注解"
                      >
                        <MessageSquareText :size="13" aria-hidden="true" />
                      </span>
                    </div>
                    <small v-if="renameTargetPath === entry.path && renameError" role="alert">{{ renameError }}</small>
                  </td>
                  <td class="type-column">{{ entryTypeLabel(entry) }}</td>
                  <td class="size-column">{{ formatFileSize(entry.size, entry.isDirectory) }}</td>
                  <td class="modified-column">{{ formatFileTime(entry.modifiedAt) }}</td>
                  <td class="permissions-column mono">{{ entry.permissions }}</td>
                  <td class="owner-column">{{ entry.uid ?? '—' }}:{{ entry.gid ?? '—' }}</td>
                </tr>
              </tbody>
            </table>

            <div v-if="!isLoading && !visibleEntries.length && !isNewFolderOpen" class="remote-file-empty-directory">
              <FolderOpen :size="28" aria-hidden="true" />
              <strong>{{ filterText ? '没有匹配的文件' : '这个目录是空的' }}</strong>
              <p>{{ filterText ? '更换筛选内容后重试。' : '拖入本地文件，或在这里新建文件夹。' }}</p>
              <button v-if="!filterText" type="button" class="primary-button" @click="chooseUploadFiles">上传文件</button>
            </div>
          </div>
        </div>

        <aside class="remote-file-inspector" aria-label="文件详细信息">
          <section v-if="uploadItems.length" class="remote-transfer-section">
            <div class="remote-file-inspector-head">
              <div>
                <strong>传输队列</strong>
                <small v-if="uploadSummary">{{ uploadSummary.completed }}/{{ uploadSummary.total }}</small>
              </div>
              <button v-if="!isUploading" type="button" aria-label="清空传输记录" title="清空传输记录" @click="uploadItems = []">
                <X :size="14" aria-hidden="true" />
              </button>
            </div>
            <div v-if="uploadSummary" class="remote-transfer-progress" aria-hidden="true">
              <span :style="{ transform: `scaleX(${uploadSummary.completed / uploadSummary.total})` }"></span>
            </div>
            <ul class="remote-transfer-list">
              <li v-for="item in uploadItems" :key="item.localPath" :class="item.status">
                <LoaderCircle v-if="item.status === 'uploading'" class="spinning" :size="14" aria-hidden="true" />
                <Upload v-else :size="14" aria-hidden="true" />
                <span><strong :title="item.name">{{ item.name }}</strong><small>{{ item.message || '等待上传' }}</small></span>
              </li>
            </ul>
          </section>

          <section class="remote-file-detail-section">
            <div class="remote-file-inspector-head">
              <div>
                <strong>{{ selectedDetail ? '属性' : selectedEntries.length ? '已选择项目' : '当前目录' }}</strong>
                <small>{{ selectedEntries.length ? `${selectedEntries.length} 项` : `${entries.length} 项` }}</small>
              </div>
            </div>

            <template v-if="selectedDetail">
              <div class="remote-file-detail-identity">
                <component :is="entryIcon(selectedDetail)" :class="{ folder: selectedDetail.isDirectory }" :size="24" aria-hidden="true" />
                <div><strong :title="selectedDetail.name">{{ selectedDetail.name }}</strong><small>{{ entryTypeLabel(selectedDetail) }}</small></div>
              </div>
              <dl class="remote-file-detail-list">
                <div><dt>路径</dt><dd class="mono" :title="selectedDetail.path">{{ selectedDetail.path }}</dd></div>
                <div><dt>大小</dt><dd>{{ formatFileSize(selectedDetail.size, selectedDetail.isDirectory) }}</dd></div>
                <div><dt>修改时间</dt><dd>{{ formatFileTime(selectedDetail.modifiedAt) }}</dd></div>
                <div><dt>访问时间</dt><dd>{{ formatFileTime(selectedDetail.accessedAt) }}</dd></div>
                <div><dt>权限</dt><dd class="mono">{{ selectedDetail.permissions }}</dd></div>
                <div><dt>UID / GID</dt><dd>{{ selectedDetail.uid ?? '—' }} / {{ selectedDetail.gid ?? '—' }}</dd></div>
              </dl>

              <form class="remote-file-annotation-editor" @submit.prevent="saveSelectedAnnotation">
                <div class="remote-file-annotation-head">
                  <label for="remote-file-annotation">注解</label>
                  <span>{{ annotationDraft.length }}/2000</span>
                </div>
                <textarea
                  id="remote-file-annotation"
                  v-model="annotationDraft"
                  maxlength="2000"
                  rows="5"
                  placeholder="记录用途、负责人或维护事项"
                  :aria-invalid="Boolean(annotationError)"
                  @input="annotationError = ''"
                  @keydown.ctrl.enter.prevent="saveSelectedAnnotation"
                  @keydown.meta.enter.prevent="saveSelectedAnnotation"
                ></textarea>
                <p v-if="annotationError" class="remote-file-annotation-error" role="alert">{{ annotationError }}</p>
                <p v-else class="remote-file-annotation-hint">仅保存在本机 CendLink，不修改远程文件。</p>
                <div class="remote-file-annotation-actions">
                  <button
                    type="button"
                    :disabled="isSavingAnnotation || (!selectedAnnotation && !annotationDraft)"
                    @click="clearSelectedAnnotation"
                  >
                    清空
                  </button>
                  <button
                    type="submit"
                    class="primary-button"
                    :disabled="isSavingAnnotation || !isAnnotationDirty"
                  >
                    <LoaderCircle v-if="isSavingAnnotation" class="spinning" :size="13" aria-hidden="true" />
                    <Save v-else :size="13" aria-hidden="true" />
                    {{ isSavingAnnotation ? '保存中' : '保存注解' }}
                  </button>
                </div>
              </form>
            </template>

            <template v-else-if="selectedEntries.length">
              <div class="remote-file-multi-summary">
                <FolderOpen :size="26" aria-hidden="true" />
                <strong>已选择 {{ selectedEntries.length }} 个项目</strong>
                <span>文件大小 {{ formatFileSize(selectedSize) }}</span>
              </div>
            </template>

            <template v-else>
              <div class="remote-file-detail-identity directory">
                <HardDrive :size="24" aria-hidden="true" />
                <div><strong :title="currentPath">{{ currentPath }}</strong><small>{{ connectionLabel }}</small></div>
              </div>
              <dl class="remote-file-detail-list">
                <div><dt>文件夹</dt><dd>{{ entries.filter((entry) => entry.isDirectory).length }}</dd></div>
                <div><dt>文件</dt><dd>{{ entries.filter((entry) => !entry.isDirectory).length }}</dd></div>
                <div><dt>当前筛选</dt><dd>{{ filterText || '无' }}</dd></div>
              </dl>
            </template>
          </section>
        </aside>
      </div>

      <footer class="remote-file-statusbar">
        <span>共 {{ entries.length }} 项</span>
        <span v-if="selectedEntries.length">已选择 {{ selectedEntries.length }} 项</span>
        <span v-if="selectedEntries.length">文件大小 {{ formatFileSize(selectedSize) }}</span>
        <p v-if="operationNotice" :class="operationNotice.type" role="status" aria-live="polite">
          {{ operationNotice.message }}
          <button type="button" aria-label="关闭状态消息" @click="dismissNotice"><X :size="12" aria-hidden="true" /></button>
        </p>
      </footer>
    </section>

    <Teleport to="body">
      <div
        v-if="contextMenu"
        class="remote-file-context-menu"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        role="menu"
      >
        <button v-if="contextMenu.entry.isDirectory" type="button" role="menuitem" @click="openEntry(contextMenu.entry); closeContextMenu()">
          <FolderOpen :size="15" aria-hidden="true" />打开
        </button>
        <button v-else type="button" role="menuitem" @click="downloadEntry(contextMenu.entry)">
          <Download :size="15" aria-hidden="true" />下载到本地
        </button>
        <button type="button" role="menuitem" @click="startRename(contextMenu.entry)">
          <Pencil :size="15" aria-hidden="true" />重命名
        </button>
        <button type="button" role="menuitem" @click="copyEntryPath(contextMenu.entry)">
          <Clipboard :size="15" aria-hidden="true" />复制路径
        </button>
        <span></span>
        <button type="button" class="danger" role="menuitem" @click="requestDelete(contextMenu.entry)">
          <Trash2 :size="15" aria-hidden="true" />永久删除
        </button>
      </div>
    </Teleport>
  </div>
</template>
