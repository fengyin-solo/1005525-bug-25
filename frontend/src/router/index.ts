import { createRouter, createWebHistory } from 'vue-router'

import Dashboard from '@/views/Dashboard.vue'
const Batchrecord = () => import('@/views/batchrecord/index.vue')
const Cleanroom = () => import('@/views/cleanroom/index.vue')
const Materialrelease = () => import('@/views/materialrelease/index.vue')
const Deviation = () => import('@/views/deviation/index.vue')
const Changecontrol = () => import('@/views/changecontrol/index.vue')
const Cleanvalidate = () => import('@/views/cleanvalidate/index.vue')
const Sterilize = () => import('@/views/sterilize/index.vue')
const Mediafill = () => import('@/views/mediafill/index.vue')
const Watermonitor = () => import('@/views/watermonitor/index.vue')
const Gowning = () => import('@/views/gowning/index.vue')
const Finishedqc = () => import('@/views/finishedqc/index.vue')
const FinishedqcDetail = () => import('@/views/finishedqc/detail.vue')
const Retainsample = () => import('@/views/retainsample/index.vue')
const Stability = () => import('@/views/stability/index.vue')
const Recall = () => import('@/views/recall/index.vue')
const Supplieraudit = () => import('@/views/supplieraudit/index.vue')
const Training = () => import('@/views/training/index.vue')
const Annualreview = () => import('@/views/annualreview/index.vue')
const Complaint = () => import('@/views/complaint/index.vue')

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: Dashboard },
    { path: '/batchrecord', name: 'batchrecord', component: Batchrecord },
    { path: '/cleanroom', name: 'cleanroom', component: Cleanroom },
    { path: '/materialrelease', name: 'materialrelease', component: Materialrelease },
    { path: '/deviation', name: 'deviation', component: Deviation },
    { path: '/changecontrol', name: 'changecontrol', component: Changecontrol },
    { path: '/cleanvalidate', name: 'cleanvalidate', component: Cleanvalidate },
    { path: '/sterilize', name: 'sterilize', component: Sterilize },
    { path: '/mediafill', name: 'mediafill', component: Mediafill },
    { path: '/watermonitor', name: 'watermonitor', component: Watermonitor },
    { path: '/gowning', name: 'gowning', component: Gowning },
    { path: '/finishedqc', name: 'finishedqc', component: Finishedqc },
    { path: '/finishedqc/:id(\\d+)', name: 'finishedqc-detail', component: FinishedqcDetail, props: true },
    { path: '/retainsample', name: 'retainsample', component: Retainsample },
    { path: '/stability', name: 'stability', component: Stability },
    { path: '/recall', name: 'recall', component: Recall },
    { path: '/supplieraudit', name: 'supplieraudit', component: Supplieraudit },
    { path: '/training', name: 'training', component: Training },
    { path: '/annualreview', name: 'annualreview', component: Annualreview },
    { path: '/complaint', name: 'complaint', component: Complaint },
  ],
})

export default router
