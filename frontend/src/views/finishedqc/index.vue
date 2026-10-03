<template>
  <section class="page" data-module="finishedqc">
    <header class="page-head">
      <div>
        <h2>成品检验管理</h2>
        <p class="page-desc">检验结果、标准规定与判定结论同源：结论只能按标准比对实测值产生，零值不天然放行，缺标准的记录单独拦下补齐。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记成品检验报告</button>
        <button class="btn" type="button" @click="runBatch">批量判定</button>
        <button class="btn ghost" type="button" @click="clearPoint" v-if="checkpoint.running">清除断点</button>
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
    </p>

    <div v-if="checkpoint.running" class="batch-panel">
      <strong>批量判定存在未完成断点：</strong>
      <span>已处理 {{ checkpoint.done }} / {{ checkpoint.total }}</span>
      <button class="btn primary" type="button" @click="runBatch">从断点续跑</button>
      <span class="page-desc">已判定的记录不会重复处理</span>
    </div>

    <p class="catalog-strip">
      <span class="page-desc">统一检验项目目录：</span>
      <span v-for="name in itemNames" :key="name" class="catalog-chip">{{ name }}</span>
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
          <th>拦截原因</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '检验编号'">
              <button class="link" type="button" @click="openDetail(row)">{{ row[column] }}</button>
            </template>
            <template v-else-if="column === '判定结论'">
              <span v-if="row[column] === '合格'" class="tag ok">合格</span>
              <span v-else-if="row[column] === '不合格'" class="tag bad">不合格</span>
              <span v-else class="tag muted">待判定</span>
            </template>
            <template v-else>{{ row[column] === '' || row[column] === undefined ? '—' : row[column] }}</template>
          </td>
          <td class="issue-cell">{{ issueOf(row).message || '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button v-if="row.status === '待检验'" class="link" type="button" @click="doSubmit(row)">提交检验</button>
            <button
              v-if="row.status === '检验中' && !issueOf(row).code"
              class="link"
              type="button"
              @click="doJudge(row)"
            >系统判定</button>
            <button
              v-if="row.status === '检验中' && issueOf(row).code === 'SPEC_MISSING'"
              class="link"
              type="button"
              @click="openFillSpec(row)"
            >补齐标准</button>
            <button
              v-if="row.status === '检验中' && (issueOf(row).code === 'RESULT_INVALID' || issueOf(row).code === 'TYPE_MISMATCH' || issueOf(row).code === 'SPEC_UNRECOGNIZED')"
              class="link"
              type="button"
              @click="openRefill(row)"
            >重填结果</button>
            <button v-if="row.status === '检验中'" class="link" type="button" @click="openRecheck(row)">登记复检</button>
            <button
              v-if="(row.status === '已合格' || row.status === '不合格') && !row.复核人"
              class="link"
              type="button"
              @click="openReview(row)"
            >提交复核</button>
            <button class="link" type="button" @click="openDetail(row)">详情</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">
            {{ emptyHint || '暂无符合筛选条件的成品检验记录，可先登记成品检验报告' }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条成品检验记录</span>
      <span v-if="message" :class="lastOk ? '' : 'error-text'">{{ message }}</span>
    </footer>

    <div v-if="dialog" class="modal-mask" @click.self="closeDialog">
      <div class="modal-card">
        <h3>{{ dialog.title }}</h3>

        <template v-if="dialog.kind === 'create'">
          <div class="modal-field">
            <label>检验编号</label>
            <input v-model="form.no" placeholder="如 FINI-0101" />
          </div>
          <div class="modal-field">
            <label>产品批号</label>
            <input v-model="form.batch" placeholder="如 PI-261001" />
          </div>
          <div class="modal-field">
            <label>检验项目（统一目录）</label>
            <select v-model="form.item" @change="onPickItem">
              <option value="" disabled>请选择检验项目</option>
              <option v-for="name in itemNames" :key="name" :value="name">{{ name }}</option>
            </select>
          </div>
          <div class="modal-field">
            <label>标准规定（随目录带出，可核对修改）</label>
            <input v-model="form.spec" placeholder=">=95 / <=1.0 / 5.0~7.0 / 符合规定" />
          </div>
          <div class="modal-field">
            <label>检验人</label>
            <input v-model="form.inspector" />
          </div>
        </template>

        <template v-else-if="dialog.kind === 'spec'">
          <p class="page-desc">该记录缺少标准规定，已被单独拦下。补齐后才能判定。</p>
          <div class="modal-field">
            <label>标准规定</label>
            <input v-model="form.spec" placeholder=">=95 / <=1.0 / 5.0~7.0 / 符合规定" />
          </div>
        </template>

        <template v-else-if="dialog.kind === 'refill'">
          <p class="page-desc">原结果为非法值（如负数）或与标准类型不符，请重填合法实测值。</p>
          <div class="modal-field">
            <label>检验结果（重填）</label>
            <input v-model="form.result" placeholder="非负数值，或 符合规定 / 不符合规定" />
          </div>
          <div class="modal-field">
            <label>检验人</label>
            <input v-model="form.inspector" />
          </div>
        </template>

        <template v-else-if="dialog.kind === 'recheck'">
          <p class="page-desc">复检按同一标准重新比对实测值；标准规定为空时复检报告一并锁死。</p>
          <div class="modal-field">
            <label>复检结果</label>
            <input v-model="form.result" placeholder="非负数值，或 符合规定 / 不符合规定" />
          </div>
          <div class="modal-field">
            <label>复检人</label>
            <input v-model="form.reviewer" />
          </div>
        </template>

        <template v-else-if="dialog.kind === 'review'">
          <p class="page-desc">同一份报告重复复核只算一次。</p>
          <div class="modal-field">
            <label>复核人</label>
            <input v-model="form.reviewer" />
          </div>
        </template>

        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="button" @click="confirmDialog">确定</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  batchCheckpointInfo,
  clearBatchCheckpoint,
  createQcReport,
  createRecheck,
  detectIssue,
  fillSpec,
  judgeQc,
  refillResult,
  reviewQc,
  submitQc,
  batchEvaluate,
} from '@/api/finishedqc-service'
import { downloadEntries, filterRows, listEntries, moduleMeta } from '@/api/local-service'
import { inspectionItemNames, defaultSpecOf } from '@/domain/inspection-items'
import type { EntryRow } from '@/data/types'

const router = useRouter()
const meta = moduleMeta('finishedqc')
const columns = ["检验编号", "产品批号", "检验项目", "标准规定", "检验结果", "判定结论", "判定说明", "检验人", "复核人", "复核日期"]
const filterFields = ["检验编号", "产品批号", "检验项目"]
const itemNames = inspectionItemNames()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const message = ref('')
const lastOk = ref(true)
const filters = ref<Record<string, string>>({})
const checkpoint = ref(batchCheckpointInfo())

const dialog = ref<null | { kind: 'create' | 'spec' | 'refill' | 'recheck' | 'review'; title: string; row?: EntryRow }>(null)
const form = reactive({ no: '', batch: '', item: '', spec: '', result: '', inspector: '', reviewer: '' })

const allRowsView = computed(() => listEntries(meta.key).items)
const statusSummary = computed(() =>
  meta.statuses.map((status: string) => ({
    status,
    count: allRowsView.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  { label: '待检验批次', value: allRowsView.value.filter((row) => row.status === '待检验').length },
  { label: '检验中批次', value: allRowsView.value.filter((row) => row.status === '检验中').length },
  {
    label: '缺标准/非法值拦截',
    value: allRowsView.value.filter((row) => row.status === '检验中' && detectIssue(row).code !== null).length,
  },
  { label: '不合格批次数', value: allRowsView.value.filter((row) => row.status === '不合格').length },
])

const emptyHint = computed(() => {
  if (rows.value.length > 0) return ''
  const hasFilter = Object.values(filters.value).some((value) => value.trim() !== '')
  if (hasFilter) return ''
  if (allRowsView.value.length === 0) return '暂无成品检验记录，可先登记成品检验报告'
  const blocked = allRowsView.value.filter((row) => row.status === '检验中' && detectIssue(row).code !== null).length
  if (allRowsView.value.every((row) => row.status === '已合格' || row.status === '不合格')) {
    return '没有可判定的记录：全部报告均已出结论'
  }
  return `没有可直接判定的记录：${blocked} 条在检记录因标准规定缺失或结果非法被拦下，请先补齐、重填`
})

function issueOf(row: EntryRow) {
  return detectIssue(row)
}

function notify(result: { ok: boolean; message: string }) {
  message.value = result.message
  lastOk.value = result.ok
}

function reload() {
  const matched = filterRows(allRowsView.value, filters.value)
  rows.value = matched
  total.value = matched.length
  checkpoint.value = batchCheckpointInfo()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openDetail(row: EntryRow) {
  router.push({ name: 'finishedqc-detail', params: { id: String(row.id) } })
}

function doSubmit(row: EntryRow) {
  notify(submitQc(Number(row.id)))
  reload()
}

function doJudge(row: EntryRow) {
  notify(judgeQc(Number(row.id)))
  reload()
}

function runBatch() {
  const result = batchEvaluate()
  message.value = result.empty
    ? result.message
    : `${result.message}（合格 ${result.passed} / 不合格 ${result.failed} / 拦截 ${result.blocked}）`
  lastOk.value = result.blocked === 0 || result.processed > 0
  if (result.blockedRows.length) {
    message.value += `；被拦截：${result.blockedRows.map((item) => `${item.检验编号}（${item.message}）`).join('、')}`
  }
  reload()
}

function clearPoint() {
  clearBatchCheckpoint()
  checkpoint.value = batchCheckpointInfo()
  message.value = '已清除批量断点（已落库的判定不回滚）'
  lastOk.value = true
}

function resetForm() {
  form.no = ''
  form.batch = ''
  form.item = ''
  form.spec = ''
  form.result = ''
  form.inspector = ''
  form.reviewer = ''
}

function openCreate() {
  resetForm()
  dialog.value = { kind: 'create', title: '登记成品检验报告' }
}

function openFillSpec(row: EntryRow) {
  resetForm()
  form.spec = String(row.标准规定 ?? '')
  dialog.value = { kind: 'spec', title: `补齐标准规定 · ${row.检验编号}`, row }
}

function openRefill(row: EntryRow) {
  resetForm()
  form.result = ''
  form.inspector = String(row.检验人 ?? '')
  dialog.value = { kind: 'refill', title: `重填检验结果 · ${row.检验编号}`, row }
}

function openRecheck(row: EntryRow) {
  resetForm()
  dialog.value = { kind: 'recheck', title: `登记复检 · ${row.检验编号}`, row }
}

function openReview(row: EntryRow) {
  resetForm()
  dialog.value = { kind: 'review', title: `提交复核 · ${row.检验编号}`, row }
}

function onPickItem() {
  // 选中目录项目即带出默认标准规定，保证「项目—标准」同源；用户可在此基础上核对修改。
  form.spec = defaultSpecOf(form.item)
}

function closeDialog() {
  dialog.value = null
}

function confirmDialog() {
  if (!dialog.value) return
  const row = dialog.value.row
  let result: ReturnType<typeof createQcReport> = { ok: false, message: '未处理的操作' }
  switch (dialog.value.kind) {
    case 'create':
      result = createQcReport({
        检验编号: form.no,
        产品批号: form.batch,
        检验项目: form.item,
        标准规定: form.spec,
        检验人: form.inspector,
      })
      break
    case 'spec':
      result = fillSpec(Number(row?.id), form.spec)
      break
    case 'refill':
      result = refillResult(Number(row?.id), form.result, form.inspector)
      break
    case 'recheck':
      result = createRecheck(Number(row?.id), form.result, form.reviewer)
      break
    case 'review':
      result = reviewQc(Number(row?.id), form.reviewer)
      break
  }
  notify(result)
  if (result.ok) {
    dialog.value = null
  }
  reload()
}

onMounted(reload)
</script>
