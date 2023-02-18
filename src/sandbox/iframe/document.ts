import type {
  microAppWindowType,
  MicroEventListener,
  CommonIframeEffect,
  MicroLocation,
} from '@micro-app/types'
import {
  rawDefineProperty,
  rawDefineProperties,
  isFunction,
  logWarn,
  isUniqueElement,
  isInvalidQuerySelectorKey,
} from '../../libs/utils'
import globalEnv from '../../libs/global_env'
import bindFunctionToRawTarget from '../bind_function'
import {
  scopeIframeDocumentEvent,
  scopeIframeDocumentOnEvent,
  uniqueDocumentElement,
  proxy2RawDocOrShadowKeys,
  proxy2RawDocOrShadowMethods,
  proxy2RawDocumentKeys,
  proxy2RawDocumentMethods,
} from './special_key'
import {
  updateElementInfo,
} from './actions'
import { appInstanceMap } from '../../create_app'

/**
 * TODO:
 *  1、shadowDOM
 *  2、重构
 */
export function patchIframeDocument (
  appName: string,
  microAppWindow: microAppWindowType,
  proxyLocation: MicroLocation,
): CommonIframeEffect {
  patchDocumentPrototype(appName, microAppWindow)
  patchDocumentProperties(appName, microAppWindow, proxyLocation)

  return documentEffect(appName, microAppWindow)
}

function patchDocumentPrototype (appName: string, microAppWindow: microAppWindowType): void {
  const rawDocument = globalEnv.rawDocument
  const microRootDocument = microAppWindow.Document
  const microDocument = microAppWindow.document

  microRootDocument.prototype.createElement = function createElement (
    tagName: string,
    options?: ElementCreationOptions,
  ): HTMLElement {
    const element = globalEnv.rawCreateElement.call(this, tagName, options)
    return updateElementInfo(element, microAppWindow, appName)
  }

  microRootDocument.prototype.createTextNode = function createTextNode (data: string): Text {
    const element = globalEnv.rawCreateTextNode.call(this, data)
    return updateElementInfo<Text>(element, microAppWindow, appName)
  }

  function getDefaultRawTarget (target: Document): Document {
    return microDocument !== target ? target : rawDocument
  }

  // query element👇
  function querySelector (this: Document, selectors: string): any {
    if (
      isUniqueElement(selectors) ||
      microDocument !== this
    ) {
      const _this = getDefaultRawTarget(this)
      return globalEnv.rawQuerySelector.call(_this, selectors)
    }

    return appInstanceMap.get(appName)?.querySelector(selectors) ?? null
  }

  function querySelectorAll (this: Document, selectors: string): any {
    if (
      isUniqueElement(selectors) ||
      microDocument !== this
    ) {
      const _this = getDefaultRawTarget(this)
      return globalEnv.rawQuerySelectorAll.call(_this, selectors)
    }

    return appInstanceMap.get(appName)?.querySelectorAll(selectors) ?? []
  }

  microRootDocument.prototype.querySelector = querySelector
  microRootDocument.prototype.querySelectorAll = querySelectorAll

  microRootDocument.prototype.getElementById = function getElementById (key: string): HTMLElement | null {
    const _this = getDefaultRawTarget(this)
    if (isInvalidQuerySelectorKey(key)) {
      return globalEnv.rawGetElementById.call(_this, key)
    }

    try {
      return querySelector.call(this, `#${key}`)
    } catch {
      return globalEnv.rawGetElementById.call(_this, key)
    }
  }

  microRootDocument.prototype.getElementsByClassName = function getElementsByClassName (key: string): HTMLCollectionOf<Element> {
    const _this = getDefaultRawTarget(this)
    if (isInvalidQuerySelectorKey(key)) {
      return globalEnv.rawGetElementsByClassName.call(_this, key)
    }

    try {
      return querySelectorAll.call(this, `.${key}`)
    } catch {
      return globalEnv.rawGetElementsByClassName.call(_this, key)
    }
  }

  microRootDocument.prototype.getElementsByTagName = function getElementsByTagName (key: string): HTMLCollectionOf<Element> {
    const _this = getDefaultRawTarget(this)
    if (
      isUniqueElement(key) ||
      isInvalidQuerySelectorKey(key) ||
      (!appInstanceMap.get(appName)?.inline && /^script$/i.test(key))
    ) {
      return globalEnv.rawGetElementsByTagName.call(_this, key)
    }

    try {
      return querySelectorAll.call(this, key)
    } catch {
      return globalEnv.rawGetElementsByTagName.call(_this, key)
    }
  }

  microRootDocument.prototype.getElementsByName = function getElementsByName (key: string): NodeListOf<HTMLElement> {
    const _this = getDefaultRawTarget(this)
    if (isInvalidQuerySelectorKey(key)) {
      return globalEnv.rawGetElementsByName.call(_this, key)
    }

    try {
      return querySelectorAll.call(this, `[name=${key}]`)
    } catch {
      return globalEnv.rawGetElementsByName.call(_this, key)
    }
  }
}

function patchDocumentProperties (
  appName: string,
  microAppWindow: microAppWindowType,
  proxyLocation: MicroLocation,
): void {
  const rawDocument = globalEnv.rawDocument
  const microRootDocument = microAppWindow.Document
  const microDocument = microAppWindow.document

  const getCommonDescriptor = (key: PropertyKey, getter: () => unknown): PropertyDescriptor => {
    const { enumerable } = Object.getOwnPropertyDescriptor(microRootDocument.prototype, key) || {
      enumerable: true,
      writable: true,
    }
    return {
      configurable: true,
      enumerable,
      get: getter,
    }
  }

  const createDescriptors = (): PropertyDescriptorMap => {
    const result: PropertyDescriptorMap = {}
    const descList: Array<[PropertyKey, () => unknown]> = [
      ['documentURI', () => proxyLocation.href],
      ['URL', () => proxyLocation.href],
      ['documentElement', () => rawDocument.documentElement],
      ['scrollingElement', () => rawDocument.scrollingElement],
      ['forms', () => microRootDocument.prototype.querySelectorAll.call(microDocument, 'form')],
      ['images', () => microRootDocument.prototype.querySelectorAll.call(microDocument, 'img')],
      ['links', () => microRootDocument.prototype.querySelectorAll.call(microDocument, 'a')],
    ]

    descList.forEach((desc) => {
      result[desc[0]] = getCommonDescriptor(desc[0], desc[1])
    })

    // TODO: shadowDOM
    proxy2RawDocOrShadowKeys.forEach((key) => {
      result[key] = getCommonDescriptor(key, () => rawDocument[key])
    })

    // TODO: shadowDOM
    proxy2RawDocOrShadowMethods.forEach((key) => {
      result[key] = getCommonDescriptor(key, () => bindFunctionToRawTarget<Document>(rawDocument[key], rawDocument, 'DOCUMENT'))
    })

    proxy2RawDocumentKeys.forEach((key) => {
      result[key] = getCommonDescriptor(key, () => rawDocument[key])
    })

    proxy2RawDocumentMethods.forEach((key) => {
      result[key] = getCommonDescriptor(key, () => bindFunctionToRawTarget<Document>(rawDocument[key], rawDocument, 'DOCUMENT'))
    })

    return result
  }

  rawDefineProperties(microRootDocument.prototype, createDescriptors())

  // head, body, html, title
  uniqueDocumentElement.forEach((tagName: string) => {
    rawDefineProperty(microDocument, tagName, {
      enumerable: true,
      configurable: true,
      get: () => rawDocument[tagName],
      set: undefined,
    })
  })
}

function documentEffect (appName: string, microAppWindow: microAppWindowType): CommonIframeEffect {
  const documentEventListenerMap = new Map<string, Map<string, Set<MicroEventListener>>>()
  const sstDocumentListenerMap = new Map<string, Set<MicroEventListener>>()
  let onClickHandler: unknown
  let sstOnClickHandler: unknown
  const microRootDocument = microAppWindow.Document
  const microDocument = microAppWindow.document
  const {
    rawDocument,
    rawAddEventListener,
    rawRemoveEventListener,
  } = globalEnv

  function getEventTarget (type: string, bindTarget: Document): Document {
    return scopeIframeDocumentEvent.includes(type) ? bindTarget : rawDocument
  }

  microRootDocument.prototype.addEventListener = function (
    type: string,
    listener: MicroEventListener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const handler = isFunction(listener) ? (listener.__MICRO_APP_BOUND_FUNCTION__ = listener.bind(this)) : listener
    const appListenersMap = documentEventListenerMap.get(appName)
    if (appListenersMap) {
      const appListenerList = appListenersMap.get(type)
      if (appListenerList) {
        appListenerList.add(listener)
      } else {
        appListenersMap.set(type, new Set([listener]))
      }
    } else {
      documentEventListenerMap.set(appName, new Map([[type, new Set([listener])]]))
    }
    listener && (listener.__MICRO_APP_MARK_OPTIONS__ = options)
    rawAddEventListener.call(getEventTarget(type, this), type, handler, options)
  }

  microRootDocument.prototype.removeEventListener = function (
    type: string,
    listener: MicroEventListener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const appListenersMap = documentEventListenerMap.get(appName)
    if (appListenersMap) {
      const appListenerList = appListenersMap.get(type)
      if (appListenerList?.size && appListenerList.has(listener)) {
        appListenerList.delete(listener)
      }
    }
    const handler = listener?.__MICRO_APP_BOUND_FUNCTION__ || listener
    rawRemoveEventListener.call(getEventTarget(type, this), type, handler, options)
  }

  // 重新定义microRootDocument.prototype 上的on开头方法
  function createSetterHandler (eventName: string): (value: unknown) => void {
    if (eventName === 'onclick') {
      return (value: unknown): void => {
        if (isFunction(onClickHandler)) {
          rawRemoveEventListener.call(rawDocument, 'click', onClickHandler, false)
        }
        if (isFunction(value)) {
          onClickHandler = value.bind(microDocument)
          rawAddEventListener.call(rawDocument, 'click', onClickHandler, false)
        } else {
          onClickHandler = value
        }
      }
    }
    return (value: unknown) => { rawDocument[eventName] = isFunction(value) ? value.bind(microDocument) : value }
  }

  /**
   * TODO:
   * 1、直接代理到原生document是否正确
   * 2、shadowDOM
   */
  Object.getOwnPropertyNames(microRootDocument.prototype)
    .filter((key: string) => /^on/.test(key) && !scopeIframeDocumentOnEvent.includes(key))
    .forEach((eventName: string) => {
      const { enumerable, writable, set } = Object.getOwnPropertyDescriptor(microRootDocument.prototype, eventName) || {
        enumerable: true,
        writable: true,
      }

      try {
        rawDefineProperty(microRootDocument.prototype, eventName, {
          enumerable,
          configurable: true,
          get: () => {
            if (eventName === 'onclick') return onClickHandler
            return rawDocument[eventName]
          },
          set: writable ?? !!set ? createSetterHandler(eventName) : undefined,
        })
      } catch (e) {
        logWarn(e, appName)
      }
    })

  const clearSnapshotData = () => {
    sstDocumentListenerMap.clear()
    sstOnClickHandler = null
  }

  const release = (): void => {
    // Clear the function bound by micro application through document.onclick
    if (isFunction(onClickHandler)) {
      rawRemoveEventListener.call(rawDocument, 'click', onClickHandler)
      onClickHandler = null
    }

    // Clear document binding event
    const documentAppListenersMap = documentEventListenerMap.get(appName)
    if (documentAppListenersMap) {
      documentAppListenersMap.forEach((listenerList, type) => {
        for (const listener of listenerList) {
          rawRemoveEventListener.call(
            getEventTarget(type, microDocument),
            type,
            listener?.__MICRO_APP_BOUND_FUNCTION__ || listener,
          )
        }
      })
      documentAppListenersMap.clear()
    }
  }

  /**
   * record event
   * Scenes:
   * 1. exec umdMountHook in umd mode
   * 2. hidden keep-alive app
   * 3. after init prerender app
   */
  const record = (): void => {
    // record onclick handler
    sstOnClickHandler = onClickHandler

    // record document event
    const documentAppListenersMap = documentEventListenerMap.get(appName)
    if (documentAppListenersMap) {
      documentAppListenersMap.forEach((listenerList, type) => {
        if (listenerList.size) {
          sstDocumentListenerMap.set(type, new Set(listenerList))
        }
      })
    }
  }

  // rebuild event and timer before remount app
  const rebuild = (): void => {
    // rebuild onclick event
    if (sstOnClickHandler) microDocument.onclick = sstOnClickHandler

    sstDocumentListenerMap.forEach((listenerList, type) => {
      for (const listener of listenerList) {
        document.addEventListener(type, listener, listener?.__MICRO_APP_MARK_OPTIONS__)
      }
    })

    clearSnapshotData()
  }

  return {
    record,
    rebuild,
    release,
  }
}
