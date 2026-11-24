import { bootstrapApp } from '@/app-shell/bootstrap'
import ExtensionApp from './ExtensionApp.vue'
import { initExtensionDocument } from './init'
import { router } from './router'
import { surface } from './surface'

// An extension popup sizes itself to its content unless the document has an
// explicit width, which collapses narrow pages (e.g. /welcome) into a tall sliver.
// Mark the document so the popup-sizing CSS applies.
document.documentElement.classList.add('is-extension')
document.documentElement.dataset.surface = surface

void initExtensionDocument().then(() => bootstrapApp(ExtensionApp, router))
