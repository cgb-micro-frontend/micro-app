import type {
  microAppWindowType,
  MicroLocation,
  SandBoxStartParams,
  CommonIframeEffect,
  SandBoxStopParams,
  plugins,
} from '@micro-app/types'
import {
  getEffectivePath,
  removeDomScope,
  pureCreateElement,
  assign,
  clearDOM,
  isPlainObject,
  isArray,
} from '../../libs/utils'
import {
  EventCenterForMicroApp,
  rebuildDataCenterSnapshot,
  recordDataCenterSnapshot,
} from '../../interact'
import globalEnv from '../../libs/global_env'
import {
  patchIframeRoute,
} from './route'
import {
  router,
  initRouteStateWithURL,
  clearRouteStateFromURL,
  addHistoryListener,
  removeStateAndPathFromBrowser,
  updateBrowserURLWithLocation,
  patchHistory,
  releasePatchHistory,
} from '../router'
import {
  createMicroLocation,
} from '../router/location'
import bindFunctionToRawTarget from '../bind_function'
import {
  globalPropertyList,
} from './special_key'
import {
  patchElementAndDocument,
  releasePatchElementAndDocument,
} from '../../source/patch'
import {
  patchIframeWindow,
} from './window'
import {
  patchIframeDocument,
} from './document'
import {
  patchIframeElement,
} from './element'
import microApp from '../../micro_app'

export default class IframeSandbox {
  static activeCount = 0 // number of active sandbox
  public iframe: HTMLIFrameElement
  public sandboxReady!: Promise<void>
  public microAppWindow: microAppWindowType
  public proxyLocation!: MicroLocation
  public proxyWindow: WindowProxy & microAppWindowType
  public baseElement!: HTMLBaseElement
  public microHead!: HTMLHeadElement
  public microBody!: HTMLBodyElement
  private active = false
  private windowEffect!: CommonIframeEffect
  private documentEffect!: CommonIframeEffect
  private removeHistoryListener!: CallableFunction
  // Properties that can be escape to rawWindow
  private escapeProperties: PropertyKey[] = []
  // Properties escape to rawWindow, cleared when unmount
  private escapeKeys = new Set<PropertyKey>()

  constructor (appName: string, url: string) {
    const rawLocation = globalEnv.rawWindow.location
    const browserHost = rawLocation.protocol + '//' + rawLocation.host

    const childStaticLocation = new URL(url) as MicroLocation
    const childHost = childStaticLocation.protocol + '//' + childStaticLocation.host
    const childFullPath = childStaticLocation.pathname + childStaticLocation.search + childStaticLocation.hash

    this.iframe = pureCreateElement('iframe')
    const iframeAttrs: Record<string, string> = {
      src: browserHost,
      style: 'display: none',
      name: appName,
    }
    Object.keys(iframeAttrs).forEach((key) => this.iframe.setAttribute(key, iframeAttrs[key]))

    globalEnv.rawDocument.body.appendChild(this.iframe)

    this.microAppWindow = this.iframe.contentWindow

    // TODO: 优化代码
    // exec before initStaticGlobalKeys
    this.createProxyLocation(
      appName,
      url,
      this.microAppWindow,
      childStaticLocation,
      browserHost,
      childHost,
    )

    this.createProxyWindow(
      appName,
      this.microAppWindow,
    )

    this.initStaticGlobalKeys(appName, url)
    // get escapeProperties from plugins
    this.getSpecialProperties(appName)

    this.patchIframe(this.microAppWindow, (resolve: CallableFunction) => {
      this.createIframeTemplate(this.microAppWindow)
      patchIframeRoute(appName, this.microAppWindow, childFullPath)
      this.windowEffect = patchIframeWindow(appName, this.microAppWindow)
      this.documentEffect = patchIframeDocument(appName, this.microAppWindow, this.proxyLocation)
      patchIframeElement(appName, url, this.microAppWindow, this)
      resolve()
    })
  }

  public start ({
    baseroute,
    useMemoryRouter,
    defaultPage,
    disablePatchRequest,
  }: SandBoxStartParams): void {
    if (!this.active) {
      this.active = true
      // TODO: 虚拟路由升级
      if (useMemoryRouter) {
        this.initRouteState(defaultPage)
        // unique listener of popstate event for sub app
        this.removeHistoryListener = addHistoryListener(
          this.microAppWindow.__MICRO_APP_NAME__,
        )
      } else {
        this.microAppWindow.__MICRO_APP_BASE_ROUTE__ = this.microAppWindow.__MICRO_APP_BASE_URL__ = baseroute
      }

      /**
       * delete baseElement, prevent address completion through baseElement
       * Waring:
       *  1. This will also affect a, image, link and script
       */
      if (disablePatchRequest) {
        this.baseElement?.parentNode?.removeChild(this.baseElement)
      }

      // TODO: 两种沙箱同时存在 activeCount 计数有问题，改为统一记录，放在globalEnv里
      if (++IframeSandbox.activeCount === 1) {
        patchElementAndDocument()
        patchHistory()
        // TODO: 多层嵌套兼容
      }
    }
  }

  public stop ({
    umdMode,
    keepRouteState,
    destroy,
    clearData,
  }: SandBoxStopParams): void {
    if (this.active) {
      // clear global event, timeout, data listener
      this.releaseGlobalEffect(clearData)

      if (this.removeHistoryListener) {
        this.clearRouteState(keepRouteState)
        // release listener of popstate
        this.removeHistoryListener()
      }

      if (!umdMode || destroy) {
        // in default mode, iframe will be deleted when unmount
        this.iframe.parentNode?.removeChild(this.iframe)

        this.escapeKeys.forEach((key: PropertyKey) => {
          Reflect.deleteProperty(globalEnv.rawWindow, key)
        })
        this.escapeKeys.clear()
      }

      if (--IframeSandbox.activeCount === 0) {
        releasePatchElementAndDocument()
        releasePatchHistory()
      }

      this.active = false
    }
  }

  /**
   * clear global event, timeout, data listener
   * Scenes:
   * 1. unmount of normal/umd app
   * 2. hidden keep-alive app
   * 3. after init prerender app
   * @param clearData clear data from base app
   */
  public releaseGlobalEffect (clearData = false): void {
    this.windowEffect.release()
    this.documentEffect.release()
    this.microAppWindow.microApp.clearDataListener()
    this.microAppWindow.microApp.clearGlobalDataListener()
    if (clearData) {
      microApp.clearData(this.microAppWindow.__MICRO_APP_NAME__)
      this.microAppWindow.microApp.clearData()
    }
  }

  /**
   * record umd snapshot before the first execution of umdHookMount
   * Scenes:
   * 1. exec umdMountHook in umd mode
   * 2. hidden keep-alive app
   * 3. after init prerender app
   */
  public recordEffectSnapshot (): void {
    this.windowEffect.record()
    this.documentEffect.record()
    recordDataCenterSnapshot(this.microAppWindow.microApp)
  }

  // rebuild umd snapshot before remount umd app
  public rebuildEffectSnapshot (): void {
    this.windowEffect.rebuild()
    this.documentEffect.rebuild()
    rebuildDataCenterSnapshot(this.microAppWindow.microApp)
  }

  // set __MICRO_APP_PRE_RENDER__ state
  public setPreRenderState (state: boolean): void {
    this.microAppWindow.__MICRO_APP_PRE_RENDER__ = state
  }

  private initStaticGlobalKeys (appName: string, url: string): void {
    this.microAppWindow.__MICRO_APP_ENVIRONMENT__ = true
    this.microAppWindow.__MICRO_APP_NAME__ = appName
    this.microAppWindow.__MICRO_APP_URL__ = url
    this.microAppWindow.__MICRO_APP_PUBLIC_PATH__ = getEffectivePath(url)
    this.microAppWindow.__MICRO_APP_WINDOW__ = this.microAppWindow
    this.microAppWindow.__MICRO_APP_PRE_RENDER__ = false
    this.microAppWindow.__MICRO_APP_SANDBOX__ = this
    this.microAppWindow.__MICRO_APP_PROXY_WINDOW__ = this.proxyWindow
    this.microAppWindow.rawWindow = globalEnv.rawWindow
    this.microAppWindow.rawDocument = globalEnv.rawDocument
    this.microAppWindow.microApp = assign(new EventCenterForMicroApp(appName), {
      removeDomScope,
      pureCreateElement,
      location: this.proxyLocation,
      router,
    })
  }

  // TODO: RESTRUCTURE
  private patchIframe (microAppWindow: microAppWindowType, cb: CallableFunction): void {
    this.sandboxReady = new Promise<void>((resolve) => {
      (function iframeLocationReady () {
        setTimeout(() => {
          if (microAppWindow.location.href === 'about:blank') {
            iframeLocationReady()
          } else {
            microAppWindow.stop()
            cb(resolve)
          }
        }, 0)
      })()
    })
  }

  // TODO: RESTRUCTURE
  private createIframeTemplate (microAppWindow: microAppWindowType): void {
    const microDocument = microAppWindow.document
    clearDOM(microDocument)
    const html = microDocument.createElement('html')
    html.innerHTML = '<head></head><body></body>'
    microDocument.appendChild(html)

    // 记录iframe原生body
    this.microBody = microDocument.body
    this.microHead = microDocument.head

    // 创建base
    this.createIframeBase(microAppWindow)
  }

  /**
   * baseElement will complete the relative address of element according to the URL
   * e.g: a image link script fetch ajax EventSource
   */
  private createIframeBase (microAppWindow: microAppWindowType): void {
    const microDocument = microAppWindow.document
    this.baseElement = microDocument.createElement('base')
    this.updateIframeBase()
    microDocument.head.appendChild(this.baseElement)
  }

  // TODO: 初始化和每次跳转时都要更新base的href
  public updateIframeBase = (): void => {
    this.baseElement?.setAttribute('href', this.proxyLocation.protocol + '//' + this.proxyLocation.host + this.proxyLocation.pathname)
  }

  private createProxyLocation (
    appName: string,
    url: string,
    microAppWindow: microAppWindowType,
    childStaticLocation: MicroLocation,
    browserHost: string,
    childHost: string,
  ): void {
    this.proxyLocation = createMicroLocation(
      appName,
      url,
      microAppWindow,
      childStaticLocation,
      browserHost,
      childHost,
    )
  }

  private createProxyWindow (appName: string, microAppWindow: microAppWindowType): void {
    const rawWindow = globalEnv.rawWindow
    this.proxyWindow = new Proxy(microAppWindow, {
      get: (target: microAppWindowType, key: PropertyKey): unknown => {
        if (key === 'location') {
          return this.proxyLocation
        }

        if (globalPropertyList.includes(key.toString())) {
          return this.proxyWindow
        }

        return bindFunctionToRawTarget(Reflect.get(target, key), target)
      },
      set: (target: microAppWindowType, key: PropertyKey, value: unknown): boolean => {
        /**
         * TODO:
         * 1、location域名相同，子应用内部跳转时的处理
         * 2、和with沙箱的变量相同，提取成公共数组
         */
        if (key === 'location') {
          return Reflect.set(rawWindow, key, value)
        }

        Reflect.set(target, key, value)

        if (this.escapeProperties.includes(key)) {
          !Reflect.has(rawWindow, key) && this.escapeKeys.add(key)
          Reflect.set(rawWindow, key, value)
        }

        return true
      },
      has: (target: microAppWindowType, key: PropertyKey) => key in target,
      deleteProperty: (target: microAppWindowType, key: PropertyKey): boolean => {
        if (Reflect.has(target, key)) {
          this.escapeKeys.has(key) && Reflect.deleteProperty(rawWindow, key)
          return Reflect.deleteProperty(target, key)
        }
        return true
      },
    })
  }

  /**
   * get escapeProperties from plugins & adapter
   * @param appName app name
   */
  private getSpecialProperties (appName: string): void {
    if (isPlainObject(microApp.options.plugins)) {
      this.commonActionForSpecialProperties(microApp.options.plugins.global)
      this.commonActionForSpecialProperties(microApp.options.plugins.modules?.[appName])
    }
  }

  // common action for global plugins and module plugins
  private commonActionForSpecialProperties (plugins: plugins['global']) {
    if (isArray(plugins)) {
      for (const plugin of plugins) {
        if (isPlainObject(plugin)) {
          if (isArray(plugin.escapeProperties)) {
            this.escapeProperties = this.escapeProperties.concat(plugin.escapeProperties)
          }
        }
      }
    }
  }

  private initRouteState (defaultPage: string): void {
    initRouteStateWithURL(
      this.microAppWindow.__MICRO_APP_NAME__,
      this.microAppWindow.location as MicroLocation,
      defaultPage,
    )
  }

  private clearRouteState (keepRouteState: boolean): void {
    clearRouteStateFromURL(
      this.microAppWindow.__MICRO_APP_NAME__,
      this.microAppWindow.__MICRO_APP_URL__,
      this.microAppWindow.location as MicroLocation,
      keepRouteState,
    )
  }

  public setRouteInfoForKeepAliveApp (): void {
    updateBrowserURLWithLocation(
      this.microAppWindow.__MICRO_APP_NAME__,
      this.microAppWindow.location as MicroLocation,
    )
  }

  public removeRouteInfoForKeepAliveApp (): void {
    removeStateAndPathFromBrowser(this.microAppWindow.__MICRO_APP_NAME__)
  }
}
