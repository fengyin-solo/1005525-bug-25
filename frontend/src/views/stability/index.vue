<template>
  <section class="page" data-module="stability">
    <header class="page-head">
      <div>
        <h2>稳定性考察管理</h2>
        <p class="page-desc">维护稳定性考察记录，围绕考察编号、考察批号、考察条件、考察时间点做登记、筛选与状态流转。检验项目与成品检验共用同一套目录。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记稳定性考察记录</button>
        <button class="btn" type="button" @click="exportRows">导出稳定性考察清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无稳定性考察数据，可先登记稳定性考察记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条稳定性考察记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="formOpen" class="modal-mask" @click.self="formOpen = false">
      <form class="modal card" @submit.prevent="submitForm">
        <header class="card-head">
          <strong>登记稳定性考察记录</strong>
          <button class="link" type="button" @click="formOpen = false">关闭</button>
        </header>
        <label class="form-item">
          <span>考察批号 *</span>
          <input v-model="form.考察批号" />
        </label>
        <label class="form-item">
          <span>考察条件 *</span>
          <input v-model="form.考察条件" placeholder="如 40℃/75%RH" />
        </label>
        <label class="form-item">
          <span>检验项目 *（与成品检验共用目录）</span>
          <select v-model="form.检验项目">
            <option value="" disabled>请选择检验项目</option>
            <option v-for="item in inspectionItems" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
        <label class="form-item">
          <span>考察时间点 *</span>
          <input v-model="form.考察时间点" placeholder="如 2026-12-01 / 6个月" />
        </label>
        <label class="form-item">
          <span>考察人 *</span>
          <input v-model="form.考察人" />
        </label>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <footer class="form-actions">
          <button class="btn" type="button" @click="formOpen = false">取消</button>
          <button class="btn primary" type="submit">保存</button>
        </footer>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  createEntry,
  downloadEntries,
  listEntries,
  listInspectionItems,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('stability')
const columns = meta.fields
const actions = ['提交考察', '确认完成', '终止考察']
const statuses = ['待考察', '考察中', '已完成', '已终止']
const inspectionItems = listInspectionItems()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const formOpen = ref(false)
const formError = ref('')
const emptyForm = () => ({ 考察编号: '', 考察批号: '', 考察条件: '', 考察时间点: '', 检验项目: '', 考察结果: '', 考察人: '', 考察状态: '' })
const form = ref(emptyForm())

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  { label: '待考察批次', value: rows.value.filter((row) => row.status === '待考察').length },
  { label: '考察中批次', value: rows.value.filter((row) => row.status === '考察中').length },
  { label: '已完成考察数', value: rows.value.filter((row) => row.status === '已完成').length },
])

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  form.value = emptyForm()
  formError.value = ''
  formOpen.value = true
}

function submitForm() {
  const draft = { ...form.value }
  // 考察编号自动生成；其余必填交给通用登记校验。
  const count = rows.value.length + 1
  draft.考察编号 = `STAB-${String(count).padStart(4, '0')}`
  draft.考察结果 = draft.考察结果 || '待考察'
  const result = createEntry(meta.key, draft)
  if (!result.ok) {
    formError.value = result.message
    return
  }
  formOpen.value = false
  errorMessage.value = result.message
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '稳定性考察列表读取失败'
  }
}

onMounted(reload)
</script>
