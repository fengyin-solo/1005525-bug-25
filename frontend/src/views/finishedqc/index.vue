<template>
  <section class="page" data-module="finishedqc">
    <header class="page-head">
      <div>
        <h2>成品检验管理</h2>
        <p class="page-desc">检验结果、标准规定与判定结论同源：结论一律由标准与实测推导，零值、负值、标准缺失单独拦下，不合格可发起复检。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记成品检验报告</button>
        <button class="btn" type="button" @click="toggleCatalog">检验项目目录</button>
        <button class="btn" type="button" @click="exportRows">导出成品检验清单</button>
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
      <span class="legend-item warn">待补齐/重填：{{ blockedCount }}</span>
    </p>

    <div class="batch-bar">
      <button class="btn primary" type="button" @click="runBatch">
        {{ hasCheckpoint ? '从断点继续批量判定' : '批量判定检验中记录' }}
      </button>
      <span v-if="hasCheckpoint" class="error-text">上次批量判定在断点处中断，已保留进度，点击可从断点续跑</span>
    </div>
    <div v-if="batchReport" class="batch-report card">
      <header class="card-head">
        <strong>批量判定结果</strong>
        <button class="link" type="button" @click="batchReport = null">收起</button>
      </header>
      <p v-if="batchReport.empty" class="empty-state">当前没有处于「检验中」、可判定的记录</p>
      <ul v-else class="batch-list">
        <li v-for="item in batchReport.items" :key="item.id" :class="item.skipped ? 'muted' : item.ok ? 'ok' : 'bad'">
          <span>{{ item.检验编号 }}</span>
          <span v-if="item.skipped">跳过：{{ item.message }}</span>
          <span v-else-if="item.ok">判定{{ item.verdict }}，已同步留样清单</span>
          <span v-else>{{ item.message }}</span>
          <button v-if="!item.ok && !item.skipped" class="link" type="button" @click="openEdit(item.id)">
            补齐/重填
          </button>
        </li>
      </ul>
      <p v-if="!batchReport.empty" class="batch-summary">
        合格 {{ batchReport.passed }} 条 · 不合格 {{ batchReport.rejected }} 条 ·
        拦下 {{ batchReport.blocked }} 条 · 跳过 {{ batchReport.skipped }} 条
        <template v-if="batchReport.hasCheckpoint"> · 已从断点续跑，剩余记录请补齐后重试</template>
      </p>
    </div>

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
          <th>详情</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            {{ row[column] ?? '—' }}
            <em v-if="column === '检验结果' && issueOf(row)" class="cell-warn">{{ issueLabel(row) }}</em>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button
              v-if="needsSupplement(row)"
              class="link warn-link"
              type="button"
              @click="openEdit(Number(row.id))"
            >
              补齐/重填
            </button>
          </td>
          <td><button class="link" type="button" @click="openDetail(Number(row.id))">查看</button></td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无成品检验数据，可先登记成品检验报告</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条成品检验记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 详情侧栏：与列表、写库同源读取，点开再返回不走样 -->
    <aside v-if="detailRow" class="drawer">
      <header class="drawer-head">
        <strong>报告详情 · {{ detailRow.检验编号 }}</strong>
        <button class="link" type="button" @click="detailRow = null">返回列表</button>
      </header>
      <dl class="detail-list">
        <template v-for="field in columns" :key="field">
          <dt>{{ field }}</dt>
          <dd>{{ detailRow[field] || '—' }}</dd>
        </template>
        <dt>当前状态</dt>
        <dd>{{ detailRow.status }}</dd>
        <dt v-if="detailRow.复检来源编号">复检来源</dt>
        <dd v-if="detailRow.复检来源编号">{{ detailRow.复检来源编号 }}</dd>
        <dt>同源判定校验</dt>
        <dd :class="detailIssue ? 'error-text' : 'ok-text'">
          {{ detailIssue || `按标准规定与实测结果判定：${detailVerdict}` }}
        </dd>
      </dl>
      <div class="drawer-actions">
        <button v-if="canEdit(detailRow)" class="btn" type="button" @click="openEdit(Number(detailRow.id))">
          补齐/重填
        </button>
        <button
          class="btn primary"
          type="button"
          @click="detailRow = null"
        >
          返回列表
        </button>
      </div>
    </aside>

    <!-- 登记 / 补齐重填表单 -->
    <div v-if="formOpen" class="modal-mask" @click.self="formOpen = false">
      <form class="modal card" @submit.prevent="submitForm">
        <header class="card-head">
          <strong>{{ editingId === null ? '登记成品检验报告' : `补齐/重填 · ${editingCode}` }}</strong>
          <button class="link" type="button" @click="formOpen = false">关闭</button>
        </header>
        <label class="form-item">
          <span>产品批号 *</span>
          <input v-model="form.产品批号" placeholder="如 PJ20260901" />
        </label>
        <label class="form-item">
          <span>检验项目 *</span>
          <select v-model="form.检验项目">
            <option value="" disabled>请选择检验项目</option>
            <option v-for="item in inspectionItems" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
        <label class="form-item">
          <span>标准规定 *（区间 95.0~105.0% / 限度 ≤1.0% / 定性 应澄清）</span>
          <input v-model="form.标准规定" placeholder="必填，缺失会被单独拦下" />
        </label>
        <label class="form-item">
          <span>检验结果（待检验可暂空；零值、负值、非数值将被打回重填）</span>
          <input v-model="form.检验结果" placeholder="如 98.6 / 0.4 / 澄清" />
        </label>
        <label class="form-item">
          <span>检验人 *</span>
          <input v-model="form.检验人" />
        </label>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <footer class="form-actions">
          <button class="btn" type="button" @click="formOpen = false">取消</button>
          <button class="btn primary" type="submit">保存</button>
        </footer>
      </form>
    </div>

    <!-- 检验项目目录：成品检验、稳定性考察等入口共用同一套 -->
    <div v-if="catalogOpen" class="modal-mask" @click.self="catalogOpen = false">
      <div class="modal card">
        <header class="card-head">
          <strong>检验项目目录（各入口共用同一套）</strong>
          <button class="link" type="button" @click="catalogOpen = false">关闭</button>
        </header>
        <ul class="catalog-list">
          <li v-for="item in inspectionItems" :key="item">{{ item }}</li>
        </ul>
        <form class="inline-form" @submit.prevent="addItem">
          <input v-model="newItem" placeholder="新增检验项目名称" />
          <button class="btn primary" type="submit">新增</button>
        </form>
        <p v-if="catalogMessage" class="muted">{{ catalogMessage }}</p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  addInspectionItem,
  batchJudgeQc,
  blockedRows,
  createQcEntry,
  downloadEntries,
  filterRows,
  getQcRow,
  hasQcCheckpoint,
  listInspectionItems,
  listQcRows,
  moduleMeta,
  runQcAction,
  saveQcEntry,
} from '@/api/local-service'
import { evaluateQc, issueMessage } from '@/api/qc-engine'
import type { BatchJudgeReport, EntryRow, QcRowCheck } from '@/data/types'

const meta = moduleMeta('finishedqc')
const columns = meta.fields
const filterFields = ['检验编号', '产品批号', '检验项目']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const detailRow = ref<EntryRow | null>(null)
const batchReport = ref<BatchJudgeReport | null>(null)
const hasCheckpoint = ref(false)
const inspectionItems = ref<string[]>(listInspectionItems())

const catalogOpen = ref(false)
const newItem = ref('')
const catalogMessage = ref('')

const formOpen = ref(false)
const editingId = ref<number | null>(null)
const formError = ref('')
const emptyForm = (): { 检验编号?: string; 产品批号: string; 检验项目: string; 标准规定: string; 检验结果: string; 检验人: string } => ({
  产品批号: '',
  检验项目: '',
  标准规定: '',
  检验结果: '',
  检验人: '',
})
const form = ref(emptyForm())

const statuses = meta.statuses
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '待检验批次', value: rows.value.filter((row) => row.status === '待检验').length },
  { label: '检验中批次', value: rows.value.filter((row) => row.status === '检验中').length },
  { label: '已合格批次', value: rows.value.filter((row) => row.status === '已合格').length },
  { label: '不合格批次数', value: rows.value.filter((row) => row.status === '不合格').length },
])

const blockedCount = computed(() => blockedRows(rows.value).length)

const editingCode = computed(() => form.value.检验编号 ?? '')

function checkOf(row: EntryRow): QcRowCheck {
  // 与判定引擎完全同源；列表、详情、写库结论都按「标准规定 + 检验结果」重算。
  return evaluateQc(row.标准规定, row.检验结果)
}

function issueOf(row: EntryRow): boolean {
  return !checkOf(row).ok
}

function issueLabel(row: EntryRow): string {
  const check = checkOf(row)
  return check.ok ? '' : issueMessage(check.issue).split('，')[0]
}

function needsSupplement(row: EntryRow): boolean {
  if (String(row.status) === '检验中') {
    return !checkOf(row).ok
  }
  if (String(row.status) === '待检验' && !String(row.标准规定 ?? '').trim()) {
    return true
  }
  return false
}

function availableActions(row: EntryRow): string[] {
  switch (String(row.status)) {
    case '待检验':
      return ['提交检验']
    case '检验中':
      return ['判定合格', '判定不合格']
    case '不合格':
      return ['发起复检']
    default:
      return []
  }
}

function canEdit(row: EntryRow): boolean {
  return ['待检验', '检验中'].includes(String(row.status))
}

const detailIssue = computed(() => {
  if (!detailRow.value) {
    return ''
  }
  const check = checkOf(detailRow.value)
  if (!check.ok) {
    return issueMessage(check.issue)
  }
  return ''
})

const detailVerdict = computed(() => {
  if (!detailRow.value) {
    return ''
  }
  const check = checkOf(detailRow.value)
  return check.ok ? check.verdict : '—'
})

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function toggleCatalog() {
  catalogOpen.value = !catalogOpen.value
  catalogMessage.value = ''
}

function addItem() {
  const result = addInspectionItem(newItem.value)
  catalogMessage.value = result.message
  if (result.ok) {
    newItem.value = ''
    inspectionItems.value = listInspectionItems()
  }
}

function openCreate() {
  editingId.value = null
  form.value = emptyForm()
  formError.value = ''
  formOpen.value = true
}

function openEdit(id: number) {
  const row = getQcRow(id)
  if (!row) {
    errorMessage.value = `没有找到编号为 ${id} 的成品检验报告`
    return
  }
  editingId.value = id
  form.value = {
    产品批号: String(row.产品批号 ?? ''),
    检验项目: String(row.检验项目 ?? ''),
    标准规定: String(row.标准规定 ?? ''),
    检验结果: String(row.检验结果 ?? ''),
    检验人: String(row.检验人 ?? ''),
  }
  form.value.检验编号 = String(row.检验编号 ?? '')
  formError.value = ''
  formOpen.value = true
  detailRow.value = null
}

function submitForm() {
  const draft = {
    产品批号: form.value.产品批号,
    检验项目: form.value.检验项目,
    标准规定: form.value.标准规定,
    检验结果: form.value.检验结果,
    检验人: form.value.检验人,
  }
  const result = editingId.value === null ? createQcEntry(draft) : saveQcEntry(editingId.value, draft)
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
  const result = runQcAction(Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
  }
  reload()
  if (detailRow.value && Number(detailRow.value.id) === Number(row.id)) {
    openDetail(Number(row.id))
  }
}

function runBatch() {
  errorMessage.value = ''
  batchReport.value = batchJudgeQc()
  hasCheckpoint.value = hasQcCheckpoint()
  reload()
}

function openDetail(id: number) {
  // 详情每次点开都从同一份存储实时读取，与列表、写库完全同源。
  detailRow.value = getQcRow(id)
}

function reload() {
  errorMessage.value = ''
  try {
    const items = filterRows(listQcRows(), filters.value)
    rows.value = items
    total.value = items.length
    hasCheckpoint.value = hasQcCheckpoint()
    if (detailRow.value) {
      const latest = getQcRow(Number(detailRow.value.id))
      if (latest) {
        detailRow.value = latest
      }
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '成品检验列表读取失败'
  }
}

onMounted(reload)
</script>
