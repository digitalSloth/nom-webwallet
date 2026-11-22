import { bootstrapApp } from '@/app-shell/bootstrap'
import WebApp from './WebApp.vue'
import { initWebDocument } from './init'
import { router } from './router'

void initWebDocument().then(() => bootstrapApp(WebApp, router))
