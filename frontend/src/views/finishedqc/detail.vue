<template>
  <section class="page" data-module="finishedqc-detail">
    <header class="page-head">
      <div>
        <h2>成品检验报告详情</h2>
        <p class="page-desc">详情与列表读取同一份数据：这里看到的检验结果、标准规定、判定结论返回列表后不会走样。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="goBack">← 返回列表</button>
      </div>
    </header>

    <div v-if="!row" class="batch-panel">
      <span>未找到该报告，可能已被重置。</span>
      <button class="btn primary" type="button" @click="goBack">返回列表</button>
    </div>

    <template v-else>
      <div class="batch-panel">
        <span>检验编号：<strong>{{ field('检验编号') }}</strong></span>
        <span>当前状态：
          <span v-if="row.status === '已合格'" class="tag ok">已合格</span>
          <span v-else-if="row.status === '不合格'" class="tag bad">不合格</span>
          <span v-else class="tag warn">{{ row.status }}</span>
        </span>
        <span>判定结论：
          <span v-if="field('判定结论') === '合格'" class="tag ok">合格</span>
          <span v-else-if="field('判定结论') === '不合格'" class="tag bad">不合格</span>
          <span v-else class="tag muted">待判定</span>
        </span>
        <span v-if="issue.code" class="error-text">拦截：{{ issue.message }}</span>
      </div>

      <dl class="detail-grid">
        <template v-for="item in detailItems" :key="item.key">
          <dt>{{ item.label }}</dt>
          <dd>{{ field(item.key) || '—' }}</dd>
        </template>
        <dt>留样联动</dt>
        <dd>
          <template v-if="retainLink">
            留样编号 {{ retainLink.留样编号 }} 已同步
            <span :class="retainLink.检验结论 === '不合格' ? 'tag bad' : 'tag ok'">{{ retainLink.检验结论 }}</span>
          </template>
          <span v-else class="page-desc">留样清单中暂无同批号留样记录</span>
        </dd>
      </dl>

      <div class="recheck-box">
        <strong>复检记录（{{ rechecks.length }}）</strong>
        <p v-if="!rechecks.length" class="page-desc">暂无复检记录。同一份报告重复复核只算一次。</p>
        <table v-else class="data-table" style="margin-top: 8px;">
          <thead>
            <tr><th>轮次</th><th>复检结果</th><th>判定结论</th><th>判定说明</th><th>复检人</th><th>日期</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in rechecks" :key="item.id">
              <td>第 {{ item.round }} 轮</td>
              <td>{{ item.result }}</td>
              <td><span :class="item.verdict === '不合格' ? 'tag bad' : 'tag ok'">{{ item.verdict }}</span></td>
              <td>{{ item.reason }}</td>
              <td>{{ item.reviewer }}</td>
              <td>{{ item.reviewedAt }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="page-actions" style="margin-top: 14px;">
        <button v-if="row.status === '待检验'" class="btn primary" type="button" @click="apply(submitQc(idNum))">提交检验</button>
        <button v-if="row.status === '检验中' && !issue.code" class="btn primary" type="button" @click="apply(judgeQc(idNum))">系统判定</button>
        <button v-if="row.status === '检验中' && issue.code === 'SPEC_MISSING'" class="btn" type="button" @click="openDialog('spec')">补齐标准</button>
        <button v-if="row.status === '检验中' && refillable" class="btn" type="button" @click="openDialog('refill')">重填结果</button>
        <button v-if="row.status === '检验中'" class="btn" type="button" @click="openDialog('recheck')">登记复检</button>
        <button v-if="(row.status === '已合格' || row.status === '不合格') && !row.复核人" class="btn" type="button" @click="openDialog('review')">提交复核</button>
      </div>

      <p v-if="feedback" :class="feedbackOk ? '' : 'error-text'" style="margin-top: 10px;">{{ feedback }}</p>
    </template>

    <div v-if="dialogKind" class="modal-mask" @click.self="dialogKind = null">
      <div class="modal-card">
        <h3>{{ dialogTitle }}</h3>
        <template v-if="dialogKind === 'spec'">
          <div class="modal-field">
            <label>标准规定</label>
            <input v-model="specValue" placeholder=">=95 / <=1.0 / 5.0~7.0 / 符合规定" />
          </div>
        </template>
        <template v-else-if="dialogKind === 'refill'">
          <div class="modal-field"><label>检验结果（重填）</label><input v-model="resultValue" /></div>
          <div class="modal-field"><label>检验人</label><input v-model="inspectorValue" /></div>
        </template>
        <template v-else-if="dialogKind === 'recheck'">
          <div class="modal-field"><label>复检结果</label><input v-model="resultValue" /></div>
          <div class="modal-field"><label>复检人</label><input v-model="reviewerValue" /></div>
        </template>
        <template v-else-if="dialogKind === 'review'">
          <div class="modal-field"><label>复核人</label><input v-model="reviewerValue" /></div>
        </template>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="dialogKind = null">取消</button>
          <button class="btn primary" type="button" @click="confirmDialog">确定</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  createRecheck,
  detectIssue,
  fillSpec,
  getQcRow,
  judgeQc,
  refillResult,
  reviewQc,
  submitQc,
} from '@/api/finishedqc-service'
import { listRows } from '@/data/local-store'
import type { ActionResult, EntryRow, RecheckRecord } from '@/data/types'

const props = defineProps<{ id: string }>()
const router = useRouter()
const idNum = Number(props.id)

// 详情页不缓存行数据：每次渲染都通过 getQcRow 从同一份 store 取，操作后立刻重读。
const tick = ref(0)
const row = computed<EntryRow | undefined>(() => {
  void tick.value
  return getQcRow(idNum)
})

const detailItems = [
  { key: '产品批号', label: '产品批号' },
  { key: '检验项目', label: '检验项目' },
  { key: '标准规定', label: '标准规定' },
  { key: '检验结果', label: '检验结果' },
  { key: '判定说明', label: '判定说明' },
  { key: '检验人', label: '检验人' },
  { key: '复核人', label: '复核人' },
  { key: '复核日期', label: '复核日期' },
]

const issue = computed(() => (row.value ? detectIssue(row.value) : { code: null, message: '' }))
const refillable = computed(() =>
  ['RESULT_INVALID', 'TYPE_MISMATCH', 'SPEC_UNRECOGNIZED'].includes(String(issue.value.code)),
)
const rechecks = computed<RecheckRecord[]>(
  () => (row.value && Array.isArray(row.value.复检记录) ? row.value.复检记录 : []) as RecheckRecord[],
)
const retainLink = computed(() => {
  void tick.value
  if (!row.value) return null
  return listRows('retainsample').find(
    (item) => String(item.对应批号) === String(row.value!.产品批号),
  ) ?? null
})

const feedback = ref('')
const feedbackOk = ref(true)

const dialogKind = ref<null | 'spec' | 'refill' | 'recheck' | 'review'>(null)
const dialogTitle = computed(() => {
  const map = { spec: '补齐标准规定', refill: '重填检验结果', recheck: '登记复检', review: '提交复核' }
  return dialogKind.value ? map[dialogKind.value] : ''
})
const specValue = ref('')
const resultValue = ref('')
const inspectorValue = ref('')
const reviewerValue = ref('')

function field(key: string): string {
  return row.value ? String(row.value[key] ?? '') : ''
}

function goBack() {
  router.push({ name: 'finishedqc' })
}

function apply(result: ActionResult) {
  feedback.value = result.message
  feedbackOk.value = result.ok
  tick.value += 1
}

function openDialog(kind: 'spec' | 'refill' | 'recheck' | 'review') {
  specValue.value = field('标准规定')
  resultValue.value = ''
  inspectorValue.value = field('检验人')
  reviewerValue.value = ''
  dialogKind.value = kind
}

function confirmDialog() {
  let result: ActionResult = { ok: false, message: '未处理的操作' }
  if (dialogKind.value === 'spec') result = fillSpec(idNum, specValue.value)
  if (dialogKind.value === 'refill') result = refillResult(idNum, resultValue.value, inspectorValue.value)
  if (dialogKind.value === 'recheck') result = createRecheck(idNum, resultValue.value, reviewerValue.value)
  if (dialogKind.value === 'review') result = reviewQc(idNum, reviewerValue.value)
  feedback.value = result.message
  feedbackOk.value = result.ok
  if (result.ok) dialogKind.value = null
  tick.value += 1
}
</script>
