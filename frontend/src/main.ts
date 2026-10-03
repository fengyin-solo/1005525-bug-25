import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import './styles/global.css'
import { migrateV1ToV2 } from './data/migrations'
import { registerMigrators } from './data/local-store'

// 存量迁移必须在任何模块读取 localStorage 之前注册好。
registerMigrators([migrateV1ToV2])

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
