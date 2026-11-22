// Module worker for extension pages: answers the SDK PowWorker protocol.
// The extension starts it from its own origin because a blob: worker on an
// extension page cannot import pow.js.
import { servePowRequests } from 'znn-typescript-sdk'

servePowRequests({ basePath: '/' })
