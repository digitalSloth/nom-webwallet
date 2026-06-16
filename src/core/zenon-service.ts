import {isPowWorkerSupported, Zenon} from 'znn-typescript-sdk'
import {DEFAULT_NODE_URL} from '@/config'
import {trackPow} from './pow-status'
import {sandboxPowProvider} from './extension-pow-provider'

/**
 * True when running inside the MV3 browser extension (popup / full page), as
 * opposed to the standalone web app. The extension CSP forbids both the SDK's
 * `blob:` PoW worker and the PoW module's `new Function` init on normal pages,
 * so PoW runs in a sandbox page instead (see {@link sandboxPowProvider}).
 */
function isExtensionContext(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.runtime !== 'undefined' &&
    Boolean(chrome.runtime?.id)
  )
}

/**
 * Manages the global Zenon connection
 * All other services should use this to access the Zenon instance
 */
export class ZenonService {
  private readonly zenon: Zenon
  private isInitialized = false
  private initializePromise: Promise<void> | null = null
  private static instance: ZenonService | null = null
  private static powConfigured = false
  private static powWorkerEnabled = false
  private static networkConfigured = false

  private constructor(
    private nodeUrl: string = DEFAULT_NODE_URL,
    private chainId: number = 1,
    private networkId: number = 1
  ) {
    // Configure network settings BEFORE getting the Zenon instance
    if (!ZenonService.networkConfigured) {
      Zenon.setChainID(this.chainId)
      Zenon.setNetworkID(this.networkId)
      ZenonService.networkConfigured = true
    }

    this.zenon = Zenon.getInstance()

    // Configure PoW base path once (before any operations that require PoW)
    if (!ZenonService.powConfigured) {
      Zenon.setPowBasePath('/')
      ZenonService.powConfigured = true
    }

    // Run PoW off the main page so it no longer blocks the UI or starves the
    // WebSocket heartbeat (which previously caused the connection to drop while
    // a block's nonce was being computed), and — in the extension — so its
    // eval-using emscripten init runs where the CSP allows it.
    if (!ZenonService.powWorkerEnabled) {
      if (isExtensionContext()) {
        // The SDK PoW module needs `new Function` at init, forbidden on MV3
        // extension pages. Delegate to the sandbox page, where the sandbox CSP
        // permits it. Only meaningful in a document context (popup / full page),
        // not the background service worker, which never generates PoW.
        if (typeof document !== 'undefined') {
          Zenon.setPowProvider(trackPow(sandboxPowProvider))
          ZenonService.powWorkerEnabled = true
        }
      } else if (isPowWorkerSupported()) {
        try {
          const worker = Zenon.usePowWorker()
          // Wrap the worker's generator so global isGeneratingPow tracks PoW.
          Zenon.setPowProvider(trackPow(worker.generate))
          ZenonService.powWorkerEnabled = true
        } catch (error) {
          // A blocked worker (e.g. strict CSP) must not break sending — the SDK
          // transparently falls back to main-thread PoW when no provider is set.
          console.warn('Off-thread PoW worker unavailable; using main-thread PoW.', error)
        }
      }
    }
  }

  /**
   * Returns the singleton ZenonService.
   *
   * Parameters are only applied on the FIRST call (when the instance is
   * created). On subsequent calls they are ignored; if they differ from the
   * active configuration a warning is logged. To change the connection after
   * initialization use {@link changeNode} or {@link updateNetworkConfig}.
   */
  static getInstance(
    nodeUrl?: string,
    chainId?: number,
    networkId?: number
  ): ZenonService {
    if (!ZenonService.instance) {
      ZenonService.instance = new ZenonService(
        nodeUrl ?? DEFAULT_NODE_URL,
        chainId ?? 1,
        networkId ?? 1
      )
    } else if (
      (nodeUrl !== undefined && nodeUrl !== ZenonService.instance.nodeUrl) ||
      (chainId !== undefined && chainId !== ZenonService.instance.chainId) ||
      (networkId !== undefined && networkId !== ZenonService.instance.networkId)
    ) {
      console.warn(
        'ZenonService.getInstance() called with parameters after initialization; ' +
          'they are ignored. Use changeNode() or updateNetworkConfig() to reconfigure.'
      )
    }
    return ZenonService.instance
  }

  /**
   * Update network configuration and reinitialize
   */
  static updateNetworkConfig(chainId: number, networkId: number): void {
    Zenon.setChainID(chainId)
    Zenon.setNetworkID(networkId)

    if (ZenonService.instance) {
      ZenonService.instance.chainId = chainId
      ZenonService.instance.networkId = networkId
    }
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return
    }

    // If already initializing, wait for that promise
    if (this.initializePromise) {
      return this.initializePromise
    }

    // Start initialization
    this.initializePromise = (async () => {
      await this.zenon.initialize(this.nodeUrl)
      this.isInitialized = true
    })()

    await this.initializePromise
  }

  async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize()
    }
  }

  getZenon(): Zenon {
    return this.zenon
  }

  isConnected(): boolean {
    return this.isInitialized
  }

  getNodeUrl(): string {
    return this.nodeUrl
  }

  // Disconnect from the node
  disconnect(): void {
    if (this.isInitialized) {
      this.zenon.clearConnection()
      this.isInitialized = false
      this.initializePromise = null
    }
  }

  // Change node URL and reconnect
  async changeNode(newNodeUrl: string): Promise<void> {
    this.disconnect()
    this.nodeUrl = newNodeUrl
    await this.initialize()
  }
}
