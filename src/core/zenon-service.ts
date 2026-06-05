import {isPowWorkerSupported, Zenon} from 'znn-typescript-sdk'
import {DEFAULT_NODE_URL, STORAGE_KEY_CHAIN_ID, STORAGE_KEY_NETWORK_ID, STORAGE_KEY_SELECTED_NODE,} from '@/config'
import {storageService} from './storage/storage-service'
import {trackPow} from './pow-status'

/**
 * True when running inside the MV3 browser extension (popup / service worker),
 * as opposed to the standalone web app. The extension's default CSP
 * (`script-src 'self'`) forbids `blob:` workers, so the SDK's blob-based
 * `usePowWorker()` cannot be used there — we fall back to main-thread PoW.
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
  // Whether the persisted node/network config has been adopted for the first
  // connection. Set once on boot (or eagerly by an explicit changeNode()).
  private static bootConfigResolved = false

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

    // Run PoW off the main thread so it no longer blocks the UI or starves the
    // WebSocket heartbeat (which previously caused the connection to drop while
    // a block's nonce was being computed). The SDK's built-in worker is spawned
    // from a blob: URL, which the MV3 extension CSP forbids — so we only enable
    // it in the standalone web app and let the extension fall back to the
    // (synchronous) main-thread generator.
    if (!ZenonService.powWorkerEnabled && !isExtensionContext() && isPowWorkerSupported()) {
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
      // Before the very first connection, adopt the persisted node + network
      // config from storage so the initial connect targets the user's saved
      // node directly — no brief default-node round-trip. Skipped once a target
      // has been set explicitly via changeNode().
      if (!ZenonService.bootConfigResolved) {
        await this.applyPersistedConfig()
        ZenonService.bootConfigResolved = true
      }
      await this.zenon.initialize(this.nodeUrl)
      this.isInitialized = true
    })()

    await this.initializePromise
  }

  /**
   * Load the persisted node + network configuration from storage and apply it
   * to this instance. Called once before the first connection. Storage failures
   * are non-fatal — the built-in defaults are kept.
   */
  private async applyPersistedConfig(): Promise<void> {
    try {
      const [storedNode, storedChainId, storedNetworkId] = await Promise.all([
        storageService.get<string>(STORAGE_KEY_SELECTED_NODE),
        storageService.get<number>(STORAGE_KEY_CHAIN_ID),
        storageService.get<number>(STORAGE_KEY_NETWORK_ID),
      ])

      if (storedChainId !== null || storedNetworkId !== null) {
        ZenonService.updateNetworkConfig(storedChainId ?? 1, storedNetworkId ?? 1)
      }
      if (storedNode) {
        this.nodeUrl = storedNode
      }
    } catch (error) {
      console.warn('Failed to load persisted network config; using defaults.', error)
    }
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

  getChainId(): number {
    return this.chainId
  }

  getNetworkId(): number {
    return this.networkId
  }

  // Disconnect from the node
  disconnect(): void {
    if (this.isInitialized || this.initializePromise) {
      this.zenon.clearConnection()
      this.isInitialized = false
      this.initializePromise = null
    }
  }

  // Change node URL and reconnect
  async changeNode(newNodeUrl: string): Promise<void> {
    // Let any in-flight connection finish before tearing it down. disconnect()
    // is a no-op while a connect is still pending (isInitialized is false), so
    // without this await changeNode() would piggyback on the old node's
    // in-flight initialize() promise and never switch to newNodeUrl.
    if (this.initializePromise) {
      try {
        await this.initializePromise
      } catch {
        // Ignore — we're replacing this connection anyway.
      }
    }
    this.disconnect()
    this.nodeUrl = newNodeUrl
    // An explicit node change is the authoritative target — never let a later
    // first-time initialize() override it with the persisted config.
    ZenonService.bootConfigResolved = true
    await this.initialize()
  }
}
