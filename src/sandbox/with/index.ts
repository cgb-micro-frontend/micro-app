/* eslint-disable no-cond-assign */
import type {
  microAppWindowType,
  WithSandBoxInterface,
  plugins,
  MicroLocation,
  SandBoxAdapter,
  SandBoxStartParams,
  SandBoxStopParams,
  EffectController,
} from '@micro-app/types'
import {
  EventCenterForMicroApp,
  rebuildDataCenterSnapshot,
  recordDataCenterSnapshot,
} from '../../interact'
import globalEnv from '../../libs/global_env'
import { initEnvOfNestedApp } from '../../libs/nest_app'
import {
  getEffectivePath,
  isArray,
  isPlainObject,
  isString,
  isUndefined,
  removeDomScope,
  unique,
  throttleDeferForSetAppName,
  rawDefineProperty,
  rawDefineProperties,
  rawHasOwnProperty,
  pureCreateElement,
  assign,
} from '../../libs/utils'
import microApp from '../../micro_app'
import bindFunctionToRawTarget from '../bind_function'
import effect, {
  effectDocumentEvent,
  releaseEffectDocumentEvent,
} from './effect'
import {
  patchElementAndDocument,
  releasePatchElementAndDocument,
} from '../../source/patch'
import {
  router,
  createMicroRouter,
  initRouteStateWithURL,
  clearRouteStateFromURL,
  addHistoryListener,
  removeStateAndPathFromBrowser,
  updateBrowserURLWithLocation,
  patchHistory,
  releasePatchHistory,
} from '../router'
import Adapter, {
  fixBabelPolyfill6,
  throttleDeferForParentNode,
} from './adapter'
import {
  createMicroFetch,
  useMicroEventSource,
  createMicroXMLHttpRequest,
} from '../request'
export {
  router,
  getNoHashMicroPathFromURL,
} from '../router'

export type MicroAppWindowDataType = {
  __MICRO_APP_ENVIRONMENT__: boolean,
  __MICRO_APP_NAME__: string,
  __MICRO_APP_URL__: string,
  __MICRO_APP_PUBLIC_PATH__: string,
  __MICRO_APP_BASE_URL__: string,
  __MICRO_APP_BASE_ROUTE__: string,
  __MICRO_APP_UMD_MODE__: boolean,
  __MICRO_APP_PRE_RENDER__: boolean
  microApp: EventCenterForMicroApp,
  rawWindow: Window,
  rawDocument: Document,
  removeDomScope: () => void,
}
export type MicroAppWindowType = Window & MicroAppWindowDataType
export type proxyWindow = WindowProxy & MicroAppWindowDataType

const { createMicroEventSource, clearMicroEventSource } = useMicroEventSource()
const globalPropertyList: Array<PropertyKey> = ['window', 'self', 'globalThis']

export default class WithSandBox implements WithSandBoxInterface {
  static activeCount = 0 // number of active sandbox
  private effectController: EffectController
  private removeHistoryListener!: CallableFunction
  private adapter: SandBoxAdapter
  /**
   * Scoped global Properties(Properties that can only get and set in microAppWindow, will not escape to rawWindow)
   * Fix https://github.com/micro-zoe/micro-app/issues/234
   */
  private scopeProperties: PropertyKey[] = []
  // Properties that can be escape to rawWindow
  private escapeProperties: PropertyKey[] = []
  // Properties newly added to microAppWindow
  private injectedKeys = new Set<PropertyKey>()
  // Properties escape to rawWindow, cleared when unmount
  private escapeKeys = new Set<PropertyKey>()
  // record injected values before the first execution of umdHookMount and rebuild before remount umd app
  // private recordUmdInjectedValues?: Map<PropertyKey, unknown>
  // sandbox state
  private active = false
  public proxyWindow: proxyWindow // Proxy
  public microAppWindow = {} as MicroAppWindowType // Proxy target

  constructor (appName: string, url: string) {
    this.adapter = new Adapter()
    // get scopeProperties and escapeProperties from plugins
    this.getSpecialProperties(appName)
    // create proxyWindow with Proxy(microAppWindow)
    this.proxyWindow = this.createProxyWindow(appName)
    // Rewrite global event listener & timeout
    this.effectController = effect(appName, this.microAppWindow)
    // inject global properties
    this.initStaticGlobalKeys(this.microAppWindow, appName, url)
  }

  /**
   * open sandbox and perform some initial actions
   * @param umdMode is umd mode
   * @param baseroute base route for child
   * @param useMemoryRouter use virtual router
   * @param defaultPage default page when mount child base on virtual router
   * @param disablePatchRequest prevent patchRequestApi
   */
  public start ({
    umdMode,
    baseroute,
    useMemoryRouter,
    defaultPage,
    disablePatchRequest,
  }: SandBoxStartParams): void {
    if (!this.active) {
      this.active = true
      if (useMemoryRouter) {
        if (isUndefined(this.microAppWindow.location)) {
          this.setMicroAppRouter(
            this.microAppWindow,
            this.microAppWindow.__MICRO_APP_NAME__,
            this.microAppWindow.__MICRO_APP_URL__,
          )
        }
        this.initRouteState(defaultPage)
        // unique listener of popstate event for sub app
        this.removeHistoryListener = addHistoryListener(
          this.microAppWindow.__MICRO_APP_NAME__,
        )
      } else {
        this.microAppWindow.__MICRO_APP_BASE_ROUTE__ = this.microAppWindow.__MICRO_APP_BASE_URL__ = baseroute
      }

      /**
       * Target: Ensure default mode action exactly same to first time when render again
       * 1. The following globalKey maybe modified when render, reset them when render again in default mode
       * 2. Umd mode will not delete any keys during sandBox.stop, ignore umd mode
       * 3. When sandbox.start called for the first time, it must be the default mode
       */
      if (!umdMode) {
        this.initGlobalKeysWhenStart(
          this.microAppWindow,
          this.microAppWindow.__MICRO_APP_NAME__,
          this.microAppWindow.__MICRO_APP_URL__,
          disablePatchRequest,
        )
      }

      if (++WithSandBox.activeCount === 1) {
        effectDocumentEvent()
        patchElementAndDocument()
        initEnvOfNestedApp()
        patchHistory()
      }

      fixBabelPolyfill6()
    }
  }

  /**
   * close sandbox and perform some clean up actions
   * @param umdMode is umd mode
   * @param keepRouteState prevent reset route
   * @param destroy completely destroy, delete cache resources
   * @param clearData clear data from base app
   */
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

      /**
       * NOTE:
       *  1. injectedKeys and escapeKeys must be placed at the back
       *  2. if key in initial microAppWindow, and then rewrite, this key will be delete from microAppWindow when stop, and lost when restart
       *  3. umd mode will not delete global keys
       */
      if (!umdMode || destroy) {
        clearMicroEventSource(this.microAppWindow.__MICRO_APP_NAME__)

        this.injectedKeys.forEach((key: PropertyKey) => {
          Reflect.deleteProperty(this.microAppWindow, key)
        })
        this.injectedKeys.clear()

        this.escapeKeys.forEach((key: PropertyKey) => {
          Reflect.deleteProperty(globalEnv.rawWindow, key)
        })
        this.escapeKeys.clear()
      }

      if (--WithSandBox.activeCount === 0) {
        releaseEffectDocumentEvent()
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
    this.effectController.releaseEffect()
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
    // this.microAppWindow.__MICRO_APP_UMD_MODE__ = true
    this.effectController.recordEffect()
    recordDataCenterSnapshot(this.microAppWindow.microApp)

    // this.recordUmdInjectedValues = new Map<PropertyKey, unknown>()
    // this.injectedKeys.forEach((key: PropertyKey) => {
    //   this.recordUmdInjectedValues!.set(key, Reflect.get(this.microAppWindow, key))
    // })
  }

  // rebuild umd snapshot before remount umd app
  public rebuildEffectSnapshot (): void {
    // this.recordUmdInjectedValues!.forEach((value: unknown, key: PropertyKey) => {
    //   Reflect.set(this.proxyWindow, key, value)
    // })
    this.effectController.rebuildEffect()
    rebuildDataCenterSnapshot(this.microAppWindow.microApp)
  }

  // set __MICRO_APP_PRE_RENDER__ state
  public setPreRenderState (state: boolean): void {
    this.microAppWindow.__MICRO_APP_PRE_RENDER__ = state
  }

  /**
   * get scopeProperties and escapeProperties from plugins & adapter
   * @param appName app name
   */
  private getSpecialProperties (appName: string): void {
    this.scopeProperties = this.scopeProperties.concat(this.adapter.staticScopeProperties)
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
          if (isArray(plugin.scopeProperties)) {
            this.scopeProperties = this.scopeProperties.concat(plugin.scopeProperties)
          }
          if (isArray(plugin.escapeProperties)) {
            this.escapeProperties = this.escapeProperties.concat(plugin.escapeProperties)
          }
        }
      }
    }
  }

  // create proxyWindow with Proxy(microAppWindow)
  private createProxyWindow (appName: string) {
    const rawWindow = globalEnv.rawWindow
    const descriptorTargetMap = new Map<PropertyKey, 'target' | 'rawWindow'>()
    // window.xxx will trigger proxy
    return new Proxy(this.microAppWindow, {
      get: (target: microAppWindowType, key: PropertyKey): unknown => {
        throttleDeferForSetAppName(appName)
        if (
          Reflect.has(target, key) ||
          (isString(key) && /^__MICRO_APP_/.test(key)) ||
          this.scopeProperties.includes(key)
        ) return Reflect.get(target, key)

        return bindFunctionToRawTarget(Reflect.get(rawWindow, key), rawWindow)
      },
      set: (target: microAppWindowType, key: PropertyKey, value: unknown): boolean => {
        if (this.active) {
          /**
           * TODO:
           * 1、location域名相同，子应用内部跳转时的处理
           */
          if (this.adapter.escapeSetterKeyList.includes(key)) {
            Reflect.set(rawWindow, key, value)
          } else if (
            // target.hasOwnProperty has been rewritten
            !rawHasOwnProperty.call(target, key) &&
            rawHasOwnProperty.call(rawWindow, key) &&
            !this.scopeProperties.includes(key)
          ) {
            const descriptor = Object.getOwnPropertyDescriptor(rawWindow, key)
            const { configurable, enumerable, writable, set } = descriptor!
            // set value because it can be set
            rawDefineProperty(target, key, {
              value,
              configurable,
              enumerable,
              writable: writable ?? !!set,
            })

            this.injectedKeys.add(key)
          } else {
            !Reflect.has(target, key) && this.injectedKeys.add(key)
            Reflect.set(target, key, value)
          }

          if (
            (
              this.escapeProperties.includes(key) ||
              (
                this.adapter.staticEscapeProperties.includes(key) &&
                !Reflect.has(rawWindow, key)
              )
            ) &&
            !this.scopeProperties.includes(key)
          ) {
            !Reflect.has(rawWindow, key) && this.escapeKeys.add(key)
            Reflect.set(rawWindow, key, value)
          }
        }

        return true
      },
      has: (target: microAppWindowType, key: PropertyKey): boolean => {
        if (this.scopeProperties.includes(key)) return key in target
        return key in target || key in rawWindow
      },
      // Object.getOwnPropertyDescriptor(window, key)
      getOwnPropertyDescriptor: (target: microAppWindowType, key: PropertyKey): PropertyDescriptor|undefined => {
        if (rawHasOwnProperty.call(target, key)) {
          descriptorTargetMap.set(key, 'target')
          return Object.getOwnPropertyDescriptor(target, key)
        }

        if (rawHasOwnProperty.call(rawWindow, key)) {
          descriptorTargetMap.set(key, 'rawWindow')
          const descriptor = Object.getOwnPropertyDescriptor(rawWindow, key)
          if (descriptor && !descriptor.configurable) {
            descriptor.configurable = true
          }
          return descriptor
        }

        return undefined
      },
      // Object.defineProperty(window, key, Descriptor)
      defineProperty: (target: microAppWindowType, key: PropertyKey, value: PropertyDescriptor): boolean => {
        const from = descriptorTargetMap.get(key)
        if (from === 'rawWindow') {
          return Reflect.defineProperty(rawWindow, key, value)
        }
        return Reflect.defineProperty(target, key, value)
      },
      // Object.getOwnPropertyNames(window)
      ownKeys: (target: microAppWindowType): Array<string | symbol> => {
        return unique(Reflect.ownKeys(rawWindow).concat(Reflect.ownKeys(target)))
      },
      deleteProperty: (target: microAppWindowType, key: PropertyKey): boolean => {
        if (rawHasOwnProperty.call(target, key)) {
          this.injectedKeys.has(key) && this.injectedKeys.delete(key)
          this.escapeKeys.has(key) && Reflect.deleteProperty(rawWindow, key)
          return Reflect.deleteProperty(target, key)
        }
        return true
      },
    })
  }

  /**
   * inject global properties to microAppWindow
   * @param microAppWindow micro window
   * @param appName app name
   * @param url app url
   * @param useMemoryRouter whether use memory router
   */
  private initStaticGlobalKeys (
    microAppWindow: microAppWindowType,
    appName: string,
    url: string,
  ): void {
    microAppWindow.__MICRO_APP_ENVIRONMENT__ = true
    microAppWindow.__MICRO_APP_NAME__ = appName
    microAppWindow.__MICRO_APP_URL__ = url
    microAppWindow.__MICRO_APP_PUBLIC_PATH__ = getEffectivePath(url)
    microAppWindow.__MICRO_APP_WINDOW__ = microAppWindow
    microAppWindow.__MICRO_APP_PRE_RENDER__ = false
    microAppWindow.rawWindow = globalEnv.rawWindow
    microAppWindow.rawDocument = globalEnv.rawDocument
    microAppWindow.microApp = assign(new EventCenterForMicroApp(appName), {
      removeDomScope,
      pureCreateElement,
      router,
    })

    this.setProxyDocument(microAppWindow, appName)
    this.setMappingPropertiesWithRawDescriptor(microAppWindow)
  }

  private setProxyDocument (microAppWindow: microAppWindowType, appName: string): void {
    const { proxyDocument, MicroDocument } = this.createProxyDocument(appName)
    rawDefineProperties(microAppWindow, {
      document: {
        configurable: false,
        enumerable: true,
        get () {
          // return globalEnv.rawDocument
          return proxyDocument
        },
      },
      Document: {
        configurable: false,
        enumerable: false,
        get () {
          // return globalEnv.rawRootDocument
          return MicroDocument
        },
      }
    })
  }

  // properties associated with the native window
  private setMappingPropertiesWithRawDescriptor (microAppWindow: microAppWindowType): void {
    let topValue: Window, parentValue: Window
    const rawWindow = globalEnv.rawWindow
    if (rawWindow === rawWindow.parent) { // not in iframe
      topValue = parentValue = this.proxyWindow
    } else { // in iframe
      topValue = rawWindow.top
      parentValue = rawWindow.parent
    }

    rawDefineProperty(
      microAppWindow,
      'top',
      this.createDescriptorForMicroAppWindow('top', topValue)
    )

    rawDefineProperty(
      microAppWindow,
      'parent',
      this.createDescriptorForMicroAppWindow('parent', parentValue)
    )

    globalPropertyList.forEach((key: PropertyKey) => {
      rawDefineProperty(
        microAppWindow,
        key,
        this.createDescriptorForMicroAppWindow(key, this.proxyWindow)
      )
    })
  }

  private createDescriptorForMicroAppWindow (key: PropertyKey, value: unknown): PropertyDescriptor {
    const { configurable = true, enumerable = true, writable, set } = Object.getOwnPropertyDescriptor(globalEnv.rawWindow, key) || { writable: true }
    const descriptor: PropertyDescriptor = {
      value,
      configurable,
      enumerable,
      writable: writable ?? !!set
    }

    return descriptor
  }

  /**
   * init global properties of microAppWindow when exec sandBox.start
   * @param microAppWindow micro window
   * @param appName app name
   * @param url app url
   * @param disablePatchRequest prevent rewrite request method of child app
   */
  private initGlobalKeysWhenStart (
    microAppWindow: microAppWindowType,
    appName: string,
    url: string,
    disablePatchRequest: boolean,
  ): void {
    microAppWindow.hasOwnProperty = (key: PropertyKey) => rawHasOwnProperty.call(microAppWindow, key) || rawHasOwnProperty.call(globalEnv.rawWindow, key)
    this.setHijackProperty(microAppWindow, appName)
    if (!disablePatchRequest) this.patchRequestApi(microAppWindow, appName, url)
    this.setScopeProperties(microAppWindow)
  }

  // set hijack Properties to microAppWindow
  private setHijackProperty (microAppWindow: microAppWindowType, appName: string): void {
    let modifiedEval: unknown, modifiedImage: unknown
    rawDefineProperties(microAppWindow, {
      eval: {
        configurable: true,
        enumerable: false,
        get () {
          throttleDeferForSetAppName(appName)
          return modifiedEval || eval
        },
        set: (value) => {
          modifiedEval = value
        },
      },
      Image: {
        configurable: true,
        enumerable: false,
        get () {
          throttleDeferForSetAppName(appName)
          return modifiedImage || globalEnv.ImageProxy
        },
        set: (value) => {
          modifiedImage = value
        },
      },
    })
  }

  // rewrite fetch, XMLHttpRequest, EventSource
  private patchRequestApi (microAppWindow: microAppWindowType, appName: string, url: string): void {
    let microFetch = createMicroFetch(url)
    let microXMLHttpRequest = createMicroXMLHttpRequest(url)
    let microEventSource = createMicroEventSource(appName, url)

    rawDefineProperties(microAppWindow, {
      fetch: {
        configurable: true,
        enumerable: true,
        get () {
          return microFetch
        },
        set (value) {
          microFetch = createMicroFetch(url, value)
        },
      },
      XMLHttpRequest: {
        configurable: true,
        enumerable: true,
        get () {
          return microXMLHttpRequest
        },
        set (value) {
          microXMLHttpRequest = createMicroXMLHttpRequest(url, value)
        },
      },
      EventSource: {
        configurable: true,
        enumerable: true,
        get () {
          return microEventSource
        },
        set (value) {
          microEventSource = createMicroEventSource(appName, url, value)
        },
      },
    })
  }

  /**
   * Init scope keys to microAppWindow, prevent fall to rawWindow from with(microAppWindow)
   * like: if (!xxx) {}
   * NOTE:
   * 1. Symbol.unscopables cannot affect undefined keys
   * 2. Doesn't use for window.xxx because it fall to proxyWindow
   */
  setScopeProperties (microAppWindow: microAppWindowType): void {
    this.scopeProperties.forEach((key: PropertyKey) => {
      Reflect.set(microAppWindow, key, microAppWindow[key])
    })
  }

  // set location & history for memory router
  private setMicroAppRouter (microAppWindow: microAppWindowType, appName: string, url: string): void {
    const { microLocation, microHistory } = createMicroRouter(appName, url)
    rawDefineProperties(microAppWindow, {
      location: {
        configurable: false,
        enumerable: true,
        get () {
          return microLocation
        },
        set: (value) => {
          globalEnv.rawWindow.location = value
        },
      },
      history: {
        configurable: true,
        enumerable: true,
        get () {
          return microHistory
        },
      },
    })
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

  /**
   * Create new document and Document
   */
  private createProxyDocument (appName: string) {
    const rawDocument = globalEnv.rawDocument
    const rawRootDocument = globalEnv.rawRootDocument

    const createElement = function (tagName: string, options?: ElementCreationOptions): HTMLElement {
      const element = globalEnv.rawCreateElement.call(rawDocument, tagName, options)
      element.__MICRO_APP_NAME__ = appName
      return element
    }

    const proxyDocument = new Proxy(rawDocument, {
      get: (target: Document, key: PropertyKey): unknown => {
        throttleDeferForSetAppName(appName)
        throttleDeferForParentNode(proxyDocument)
        if (key === 'createElement') return createElement
        if (key === Symbol.toStringTag) return 'ProxyDocument'
        if (key === 'defaultView') return this.proxyWindow
        return bindFunctionToRawTarget<Document>(Reflect.get(target, key), rawDocument, 'DOCUMENT')
      },
      set: (target: Document, key: PropertyKey, value: unknown): boolean => {
        /**
         * 1. Fix TypeError: Illegal invocation when set document.title
         * 2. If the set method returns false, and the assignment happened in strict-mode code, a TypeError will be thrown.
         */
        Reflect.set(target, key, value)
        return true
      }
    })

    class MicroDocument {
      static [Symbol.hasInstance] (target: unknown) {
        let proto = target
        while (proto = Object.getPrototypeOf(proto)) {
          if (proto === MicroDocument.prototype) {
            return true
          }
        }
        return (
          target === proxyDocument ||
          target instanceof rawRootDocument
        )
      }
    }

    /**
     * TIP:
     * 1. child class __proto__, which represents the inherit of the constructor, always points to the parent class
     * 2. child class prototype.__proto__, which represents the inherit of methods, always points to parent class prototype
     * e.g.
     * class B extends A {}
     * B.__proto__ === A // true
     * B.prototype.__proto__ === A.prototype // true
     */
    Object.setPrototypeOf(MicroDocument, rawRootDocument)
    // Object.create(rawRootDocument.prototype) will cause MicroDocument and proxyDocument methods not same when exec Document.prototype.xxx = xxx in child app
    Object.setPrototypeOf(MicroDocument.prototype, new Proxy(rawRootDocument.prototype, {
      get (target: Document, key: PropertyKey): unknown {
        throttleDeferForSetAppName(appName)
        return bindFunctionToRawTarget<Document>(Reflect.get(target, key), rawDocument, 'DOCUMENT')
      },
      set (target: Document, key: PropertyKey, value: unknown): boolean {
        Reflect.set(target, key, value)
        return true
      }
    }))

    return {
      proxyDocument,
      MicroDocument,
    }
  }
}
