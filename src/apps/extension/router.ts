import { createWebHashHistory } from 'vue-router'
import { tagPanelDocument } from '@/core/panel-token'
import { createExtensionRouter } from './routes'
import { surface } from './surface'

// The hash history takes its base, query included, when it is created, so the
// side panel's identity token must already be in the URL.
if (surface === 'sidepanel') tagPanelDocument()

// Extension pages are packaged files under chrome-extension://, so deep paths
// must be hash-routed.
export const router = createExtensionRouter(createWebHashHistory())
