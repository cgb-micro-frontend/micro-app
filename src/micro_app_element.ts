/* eslint-disable no-new */
import type {
  AttrType,
  MicroAppElementType,
  AppInterface,
  OptionsType,
} from '@micro-app/types'
import {
  defer,
  formatAppName,
  formatAppURL,
  version,
  logError,
  logWarn,
  isString,
  isFunction,
  CompletionPath,
  createURL,
} from './libs/utils'
import {
  ObservedAttrName,
  appStates,
  lifeCycles,
  keepAliveStates,
} from './constants'
import CreateApp, { appInstanceMap } from './create_app'
import { patchSetAttribute } from './source/patch'
import microApp from './micro_app'
import dispatchLifecyclesEvent from './interact/lifecycles_event'
import globalEnv from './libs/global_env'
import { getNoHashMicroPathFromURL, router } from './sandbox/with'

/**
 * define element
 * @param tagName element name
 */
export function defineElement (tagName: string): void {
  class MicroAppElement extends HTMLElement implements MicroAppElementType {
    static get observedAttributes (): string[] {
      return ['name', 'url']
    }

    constructor () {
      super()
      // patchSetAttribute hijiack data attribute, it needs exec first
      patchSetAttribute()
    }

    private isWaiting = false
    private cacheData: Record<PropertyKey, unknown> | null = null
    private connectedCount = 0
    private connectStateMap: Map<number, boolean> = new Map()
    public appName = '' // app name
    public appUrl = '' // app url
    public ssrUrl = '' // html path in ssr mode
    public version = version

    // 👇 Configuration
    // name: app name
    // url: html address
    // shadowDom: use shadowDOM, default is false
    // destroy: whether delete cache resources when unmount, default is false
    // inline: whether js runs in inline script mode, default is false
    // disableScopecss: whether disable css scoped, default is false
    // disableSandbox: whether disable sandbox, default is false
    // baseRoute: route prefix, default is ''
    // keep-alive: open keep-alive mode

    public connectedCallback (): void {
      const cacheCount = ++this.connectedCount
      this.connectStateMap.set(cacheCount, true)
      /**
       * In some special scenes, such as vue's keep-alive, the micro-app will be inserted and deleted twice in an instant
       * So we execute the mount method async and record connectState to prevent repeated rendering
       */
      const effectiveApp = this.appName && this.appUrl
      defer(() => {
        if (this.connectStateMap.get(cacheCount)) {
          dispatchLifecyclesEvent(
            this,
            this.appName,
            lifeCycles.CREATED,
          )
          /**
           * If insert micro-app element without name or url, and set them in next action like angular,
           * handleConnected will be executed twice, causing the app render repeatedly,
           * so we only execute handleConnected() if url and name exist when connectedCallback
           */
          effectiveApp && this.handleConnected()
        }
      })
    }

    public disconnectedCallback (): void {
      this.connectStateMap.set(this.connectedCount, false)
      this.handleDisconnected()
    }

    /**
     * Re render app from the command line
     * MicroAppElement.reload(destroy)
     */
    public reload (destroy?: boolean): Promise<boolean> {
      return new Promise((resolve) => {
        const handleAfterReload = () => {
          this.removeEventListener(lifeCycles.MOUNTED, handleAfterReload)
          this.removeEventListener(lifeCycles.AFTERSHOW, handleAfterReload)
          resolve(true)
        }
        this.addEventListener(lifeCycles.MOUNTED, handleAfterReload)
        this.addEventListener(lifeCycles.AFTERSHOW, handleAfterReload)
        this.handleDisconnected(destroy, () => {
          this.handleConnected()
        })
      })
    }

    /**
     * common action for unmount
     * @param destroy reload param
     */
    private handleDisconnected (destroy = false, callback?: CallableFunction): void {
      const app = appInstanceMap.get(this.appName)
      if (
        app &&
        app.getAppState() !== appStates.UNMOUNT &&
        app.getKeepAliveState() !== keepAliveStates.KEEP_ALIVE_HIDDEN
      ) {
        // keep-alive
        if (this.getKeepAliveModeResult() && !destroy) {
          this.handleHiddenKeepAliveApp(callback)
        } else {
          this.handleUnmount(destroy || this.getDestroyCompatibleResult(), callback)
        }
      }
    }

    public attributeChangedCallback (attr: ObservedAttrName, _oldVal: string, newVal: string): void {
      if (
        this.legalAttribute(attr, newVal) &&
        this[attr === ObservedAttrName.NAME ? 'appName' : 'appUrl'] !== newVal
      ) {
        if (attr === ObservedAttrName.URL && !this.appUrl) {
          newVal = formatAppURL(newVal, this.appName)
          if (!newVal) {
            return logError(`Invalid attribute url ${newVal}`, this.appName)
          }
          this.appUrl = newVal
          this.handleInitialNameAndUrl()
        } else if (attr === ObservedAttrName.NAME && !this.appName) {
          const formatNewName = formatAppName(newVal)

          if (!formatNewName) {
            return logError(`Invalid attribute name ${newVal}`, this.appName)
          }

          if (this.cacheData) {
            microApp.setData(formatNewName, this.cacheData)
            this.cacheData = null
          }

          this.appName = formatNewName
          if (formatNewName !== newVal) {
            this.setAttribute('name', this.appName)
          }
          this.handleInitialNameAndUrl()
        } else if (!this.isWaiting) {
          this.isWaiting = true
          defer(this.handleAttributeUpdate)
        }
      }
    }

    // handle for connectedCallback run before attributeChangedCallback
    private handleInitialNameAndUrl (): void {
      this.connectStateMap.get(this.connectedCount) && this.handleConnected()
    }

    /**
     * first mount of this app
     */
    private handleConnected (): void {
      if (!this.appName || !this.appUrl) return

      if (this.getDisposeResult('shadowDOM') && !this.shadowRoot && isFunction(this.attachShadow)) {
        this.attachShadow({ mode: 'open' })
      }

      this.updateSsrUrl(this.appUrl)

      if (appInstanceMap.has(this.appName)) {
        const app = appInstanceMap.get(this.appName)!
        const existAppUrl = app.ssrUrl || app.url
        const targetAppUrl = this.ssrUrl || this.appUrl
        /**
         * NOTE:
         * 1. keep-alive don't care about ssrUrl
         * 2. Even if the keep-alive app is pushed into the background, it is still active and cannot be replaced. Otherwise, it is difficult for developers to troubleshoot in case of conflict and  will leave developers at a loss
         * 3. When scopecss, useSandbox of prefetch app different from target app, delete prefetch app and create new one
         */
        if (
          app.getKeepAliveState() === keepAliveStates.KEEP_ALIVE_HIDDEN &&
          app.url === this.appUrl
        ) {
          this.handleShowKeepAliveApp(app)
        } else if (
          existAppUrl === targetAppUrl && (
            app.getAppState() === appStates.UNMOUNT ||
            (
              app.isPrefetch && (
                app.scopecss === this.isScopecss() &&
                app.useSandbox === this.isSandbox()
              )
            )
          )
        ) {
          this.handleAppMount(app)
        } else if (app.isPrefetch || app.getAppState() === appStates.UNMOUNT) {
          if (
            __DEV__ &&
            app.scopecss === this.isScopecss() &&
            app.useSandbox === this.isSandbox()
          ) {
            /**
             * url is different & old app is unmounted or prefetch, create new app to replace old one
             */
            logWarn(`the ${app.isPrefetch ? 'prefetch' : 'unmounted'} app with url: ${existAppUrl} replaced by a new app with url: ${targetAppUrl}`, this.appName)
          }
          this.handleCreateApp()
        } else {
          logError(`app name conflict, an app named: ${this.appName} with url: ${existAppUrl} is running`)
        }
      } else {
        this.handleCreateApp()
      }
    }

    /**
     * handle for change of name an url after element init
     */
    private handleAttributeUpdate = (): void => {
      this.isWaiting = false
      if (!this.connectStateMap.get(this.connectedCount)) return
      const formatAttrName = formatAppName(this.getAttribute('name'))
      const formatAttrUrl = formatAppURL(this.getAttribute('url'), this.appName)
      if (this.legalAttribute('name', formatAttrName) && this.legalAttribute('url', formatAttrUrl)) {
        const existApp = appInstanceMap.get(formatAttrName)
        if (formatAttrName !== this.appName && existApp) {
          // handling of cached and non-prefetch apps
          if (
            appStates.UNMOUNT !== existApp.getAppState() &&
            keepAliveStates.KEEP_ALIVE_HIDDEN !== existApp.getKeepAliveState() &&
            !existApp.isPrefetch
          ) {
            this.setAttribute('name', this.appName)
            return logError(`app name conflict, an app named ${formatAttrName} is running`)
          }
        }

        if (formatAttrName !== this.appName || formatAttrUrl !== this.appUrl) {
          if (formatAttrName === this.appName) {
            this.handleUnmount(true, () => {
              this.actionsForAttributeChange(formatAttrName, formatAttrUrl, existApp)
            })
          } else if (this.getKeepAliveModeResult()) {
            this.handleHiddenKeepAliveApp()
            this.actionsForAttributeChange(formatAttrName, formatAttrUrl, existApp)
          } else {
            this.handleUnmount(
              this.getDestroyCompatibleResult(),
              () => {
                this.actionsForAttributeChange(formatAttrName, formatAttrUrl, existApp)
              }
            )
          }
        }
      } else if (formatAttrName !== this.appName) {
        this.setAttribute('name', this.appName)
      }
    }

    // remount app or create app if attribute url or name change
    private actionsForAttributeChange (
      formatAttrName: string,
      formatAttrUrl: string,
      existApp: AppInterface | void,
    ): void {
      /**
       * do not add judgment of formatAttrUrl === this.appUrl
       */
      this.updateSsrUrl(formatAttrUrl)

      this.appName = formatAttrName
      this.appUrl = formatAttrUrl
      ;(this.shadowRoot ?? this).innerHTML = ''
      if (formatAttrName !== this.getAttribute('name')) {
        this.setAttribute('name', this.appName)
      }

      /**
       * when existApp not null: this.appName === existApp.name
       * scene1: if formatAttrName and this.appName are equal: exitApp is the current app, the url must be different, existApp has been unmounted
       * scene2: if formatAttrName and this.appName are different: existApp must be prefetch or unmounted, if url is equal, then just mount, if url is different, then create new app to replace existApp
       * scene3: url is different but ssrUrl is equal
       * scene4: url is equal but ssrUrl is different, if url is equal, name must different
       * scene5: if existApp is KEEP_ALIVE_HIDDEN, name must different
       */
      if (existApp) {
        if (existApp.getKeepAliveState() === keepAliveStates.KEEP_ALIVE_HIDDEN) {
          if (existApp.url === this.appUrl) {
            this.handleShowKeepAliveApp(existApp)
          } else {
            // the hidden keep-alive app is still active
            logError(`app name conflict, an app named ${this.appName} is running`)
          }
        } else if (existApp.url === this.appUrl && existApp.ssrUrl === this.ssrUrl) {
          // mount app
          this.handleAppMount(existApp)
        } else {
          this.handleCreateApp()
        }
      } else {
        this.handleCreateApp()
      }
    }

    /**
     * judge the attribute is legal
     * @param name attribute name
     * @param val attribute value
     */
    private legalAttribute (name: string, val: AttrType): boolean {
      if (!isString(val) || !val) {
        logError(`unexpected attribute ${name}, please check again`, this.appName)

        return false
      }

      return true
    }

    // create app instance
    private handleCreateApp (): void {
      /**
       * actions for destroy old app
       * fix of unmounted umd app with disableSandbox
       */
      if (appInstanceMap.has(this.appName)) {
        appInstanceMap.get(this.appName)!.actionsForCompletelyDestroy()
      }

      new CreateApp({
        name: this.appName,
        url: this.appUrl,
        scopecss: this.isScopecss(),
        useSandbox: this.isSandbox(),
        inline: this.getDisposeResult('inline'),
        esmodule: this.getDisposeResult('esmodule'),
        iframe: this.getDisposeResult('iframe'),
        container: this.shadowRoot ?? this,
        ssrUrl: this.ssrUrl,
      })
    }

    /**
     * mount app
     * some serious note before mount:
     * 1. is prefetch ?
     * 2. is remount in another container ?
     * 3. is remount with change properties of the container ?
     */
    private handleAppMount (app: AppInterface): void {
      app.isPrefetch = false
      defer(() => this.mount(app))
    }

    /**
     * public mount action for micro_app_element & create_app
     */
    public mount (app: AppInterface): void {
      app.mount({
        container: this.shadowRoot ?? this,
        inline: this.getDisposeResult('inline'),
        useMemoryRouter: !this.getDisposeResult('disable-memory-router'),
        defaultPage: this.getDefaultPageValue(),
        baseroute: this.getBaseRouteCompatible(),
        disablePatchRequest: this.getDisposeResult('disable-patch-request'),
        fiber: this.getDisposeResult('fiber'),
        esmodule: this.getDisposeResult('esmodule'),
        // hiddenRouter: this.getDisposeResult('hidden-router'),
      })
    }

    /**
     * unmount app
     * @param destroy delete cache resources when unmount
     */
    private handleUnmount (destroy: boolean, unmountcb?: CallableFunction): void {
      const app = appInstanceMap.get(this.appName)
      if (
        app &&
        app.getAppState() !== appStates.UNMOUNT
      ) {
        app.unmount({
          destroy,
          clearData: this.getDisposeResult('clear-data'),
          keepRouteState: this.getDisposeResult('keep-router-state'),
          unmountcb,
        })
      }
    }

    // hidden app when disconnectedCallback called with keep-alive
    private handleHiddenKeepAliveApp (callback?: CallableFunction): void {
      const app = appInstanceMap.get(this.appName)
      if (
        app &&
        app.getAppState() !== appStates.UNMOUNT &&
        app.getKeepAliveState() !== keepAliveStates.KEEP_ALIVE_HIDDEN
      ) {
        app.hiddenKeepAliveApp(callback)
      }
    }

    // show app when connectedCallback called with keep-alive
    private handleShowKeepAliveApp (app: AppInterface): void {
      // must be async
      defer(() => app.showKeepAliveApp(this.shadowRoot ?? this))
    }

    /**
     * Get configuration
     * Global setting is lowest priority
     * @param name Configuration item name
     */
    private getDisposeResult <T extends keyof OptionsType> (name: T): boolean {
      return (this.compatibleProperties(name) || !!microApp.options[name]) && this.compatibleDisableProperties(name)
    }

    // compatible of disableScopecss & disableSandbox
    private compatibleProperties (name: string): boolean {
      if (name === 'disable-scopecss') {
        return this.hasAttribute('disable-scopecss') || this.hasAttribute('disableScopecss')
      } else if (name === 'disable-sandbox') {
        return this.hasAttribute('disable-sandbox') || this.hasAttribute('disableSandbox')
      }
      return this.hasAttribute(name)
    }

    // compatible of disableScopecss & disableSandbox
    private compatibleDisableProperties (name: string): boolean {
      if (name === 'disable-scopecss') {
        return this.getAttribute('disable-scopecss') !== 'false' && this.getAttribute('disableScopecss') !== 'false'
      } else if (name === 'disable-sandbox') {
        return this.getAttribute('disable-sandbox') !== 'false' && this.getAttribute('disableSandbox') !== 'false'
      }
      return this.getAttribute(name) !== 'false'
    }

    private isScopecss (): boolean {
      return !(this.getDisposeResult('disable-scopecss') || this.getDisposeResult('shadowDOM'))
    }

    private isSandbox (): boolean {
      return !this.getDisposeResult('disable-sandbox')
    }

    /**
     * 2021-09-08
     * get baseRoute
     * getAttribute('baseurl') is compatible writing of versions below 0.3.1
     */
    private getBaseRouteCompatible (): string {
      return this.getAttribute('baseroute') ?? this.getAttribute('baseurl') ?? ''
    }

    // compatible of destroy
    private getDestroyCompatibleResult (): boolean {
      return this.getDisposeResult('destroy') || this.getDisposeResult('destory')
    }

    /**
     * destroy has priority over destroy keep-alive
     */
    private getKeepAliveModeResult (): boolean {
      return this.getDisposeResult('keep-alive') && !this.getDestroyCompatibleResult()
    }

    /**
     * change ssrUrl in ssr mode
     */
    private updateSsrUrl (baseUrl: string): void {
      if (this.getDisposeResult('ssr')) {
        if (this.getDisposeResult('disable-memory-router') || this.getDisposeResult('disableSandbox')) {
          const rawLocation = globalEnv.rawWindow.location
          this.ssrUrl = CompletionPath(rawLocation.pathname + rawLocation.search, baseUrl)
        } else {
          // get path from browser URL
          let targetPath = getNoHashMicroPathFromURL(this.appName, baseUrl)
          const defaultPagePath = this.getDefaultPageValue()
          if (!targetPath && defaultPagePath) {
            const targetLocation = createURL(defaultPagePath, baseUrl)
            targetPath = targetLocation.origin + targetLocation.pathname + targetLocation.search
          }
          this.ssrUrl = targetPath
        }
      } else if (this.ssrUrl) {
        this.ssrUrl = ''
      }
    }

    /**
     * get config of default page
     */
    private getDefaultPageValue (): string {
      return (
        router.getDefaultPage(this.appName) ||
        this.getAttribute('default-page') ||
        this.getAttribute('defaultPage') ||
        ''
      )
    }

    /**
     * Data from the base application
     */
    set data (value: Record<PropertyKey, unknown> | null) {
      if (this.appName) {
        microApp.setData(this.appName, value as Record<PropertyKey, unknown>)
      } else {
        this.cacheData = value
      }
    }

    /**
     * get data only used in jsx-custom-event once
     */
    get data (): Record<PropertyKey, unknown> | null {
      if (this.appName) {
        return microApp.getData(this.appName, true)
      } else if (this.cacheData) {
        return this.cacheData
      }
      return null
    }
  }

  globalEnv.rawWindow.customElements.define(tagName, MicroAppElement)
}
