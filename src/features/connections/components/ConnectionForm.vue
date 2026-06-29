<script setup>
import { computed } from 'vue'

// 收集 SSH 配置参数，并把用户操作意图抛给所属页面处理。
const props = defineProps({
  // 服务器表单对象，对应 useWorkspaceSession.js 里的 form。
  modelValue: {
    type: Object,
    required: true,
  },
  // 连接测试或命令执行中，用于禁用表单按钮。
  busy: {
    type: Boolean,
    default: false,
  },
  // 保存服务器配置中，用于显示保存按钮状态。
  saving: {
    type: Boolean,
    default: false,
  },
  // 当前表单所处模式：create 表示新建服务器，edit 表示编辑已保存服务器。
  mode: {
    type: String,
    default: 'create',
  },
})

const emit = defineEmits(['update:modelValue', 'test', 'selectKey', 'save', 'create'])

const isCreating = computed(() => props.mode === 'create')

/**
 * 更新表单中的单个字段，并通过 v-model 把完整表单回传给父组件。
 */
function updateField(field, value) {
  emit('update:modelValue', {
    ...props.modelValue,
    [field]: value,
  })
}
</script>

<template>
  <form class="connection-form" @submit.prevent="emit('test')">
    <div class="panel-header">
      <h3>{{ isCreating ? '新建服务器' : '服务器信息' }}</h3>
      <div class="panel-actions">
        <button
          class="secondary-button"
          type="button"
          :disabled="busy || saving"
          @click="emit('create')"
        >
          新建
        </button>
        <button
          class="secondary-button"
          type="button"
          :disabled="busy || saving"
          @click="emit('save')"
        >
          {{ saving ? '保存中...' : isCreating ? '保存新服务器' : '保存修改' }}
        </button>
        <button class="primary-button" type="submit" :disabled="busy || saving">
          {{ busy ? '测试中...' : '测试连接' }}
        </button>
      </div>
    </div>

    <div class="form-group">
      <p class="form-group-title">连接目标</p>

      <label class="field">
        <span>名称</span>
        <input
          :value="modelValue.name"
          type="text"
          placeholder="生产服务器"
          @input="updateField('name', $event.target.value)"
        />
      </label>

      <div class="field-row">
        <label class="field fill">
          <span>Host</span>
          <input
            :value="modelValue.host"
            type="text"
            placeholder="192.168.1.10 或 example.com"
            autocomplete="off"
            @input="updateField('host', $event.target.value)"
          />
        </label>

        <label class="field port">
          <span>Port</span>
          <input
            :value="modelValue.port"
            type="number"
            min="1"
            max="65535"
            @input="updateField('port', Number($event.target.value))"
          />
        </label>
      </div>

      <label class="field">
        <span>Username</span>
        <input
          :value="modelValue.username"
          type="text"
          autocomplete="username"
          @input="updateField('username', $event.target.value)"
        />
      </label>
    </div>

    <div class="form-group">
      <p class="form-group-title">认证方式</p>

      <div
        class="segmented"
        :class="{ 'is-private-key': modelValue.authType === 'privateKey' }"
        role="group"
        aria-label="认证方式"
      >
        <span class="segment-thumb" aria-hidden="true"></span>
        <button
          type="button"
          :class="{ selected: modelValue.authType === 'password' }"
          @click="updateField('authType', 'password')"
        >
          密码
        </button>
        <button
          type="button"
          :class="{ selected: modelValue.authType === 'privateKey' }"
          @click="updateField('authType', 'privateKey')"
        >
          PEM / 私钥
        </button>
      </div>

      <div class="auth-fields" :class="{ 'is-private-key': modelValue.authType === 'privateKey' }">
        <label v-if="modelValue.authType === 'password'" class="field">
          <span>Password</span>
          <input
            :value="modelValue.password"
            type="password"
            autocomplete="current-password"
            placeholder="不会写入日志"
            @input="updateField('password', $event.target.value)"
          />
          <label class="checkbox-field">
            <input
              :checked="modelValue.rememberPassword"
              type="checkbox"
              @change="updateField('rememberPassword', $event.target.checked)"
            />
            <span>记住密码</span>
          </label>
        </label>

        <template v-else>
          <div class="field">
            <span>PEM / Private Key File</span>
            <div class="file-input-row">
              <input
                :value="modelValue.privateKeyPath"
                type="text"
                placeholder="C:\Users\you\.ssh\id_rsa 或 server.pem"
                @input="updateField('privateKeyPath', $event.target.value)"
              />
              <button type="button" class="secondary-button" @click="emit('selectKey')">
                选择文件
              </button>
            </div>
          </div>

          <label class="field">
            <span>Passphrase</span>
            <input
              :value="modelValue.passphrase"
              type="password"
              placeholder="可选"
              @input="updateField('passphrase', $event.target.value)"
            />
          </label>
        </template>
      </div>
    </div>

    <div class="form-group">
      <p class="form-group-title">高级</p>

      <label class="field">
        <span>Timeout</span>
        <input
          :value="modelValue.timeoutMs"
          type="number"
          min="3000"
          step="1000"
          @input="updateField('timeoutMs', Number($event.target.value))"
        />
      </label>
    </div>
  </form>
</template>
