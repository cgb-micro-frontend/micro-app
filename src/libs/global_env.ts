import type {
  Func,
  AppInterface,
  RequestIdleCallbackInfo,
  RequestIdleCallbackOptions,
} from '@micro-app/types'
import { isSupportModuleScript, isBrowser, getCurrentAppName, assign } from './utils'
import { rejectMicroAppStyle } from '../source/patch'

declare global {
  interface Window {
    requestIdleCallback (
      callback: (info: RequestIdleCallbackInfo) => void,
      opts?: RequestIdleCallbackOptions,
    ): number
    _babelPolyfill: boolean
    __MICRO_APP_ENVIRONMENT__?: boolean
    __MICRO_APP_UMD_MODE__?: boolean
    __MICRO_APP_BASE_APPLICATION__?: boolean
    __REACT_ERROR_OVERLAY_GLOBAL_HOOK__: boolean
    mount: Func
    unmount: Func
    rawLocation: Location
    rawWindow: Window
    rawDocument: Document
    Document: any
  }

  interface Node {
    __MICRO_APP_NAME__?: string | null
    __PURE_ELEMENT__?: boolean
    data?: unknown
  }

  interface HTMLStyleElement {
    __MICRO_APP_HAS_SCOPED__?: boolean
  }

  interface HTMLElement {
    reload(destroy?: boolean): Promise<boolean>
    mount(app: AppInterface): void
  }
}

const globalEnv: Record<string, any> = {}

/**
 * Note loop nesting
 * Only prototype or unique values can be put here
 */
export function initGlobalEnv (): void {
  if (isBrowser) {
    // mark current application as base application
    window.__MICRO_APP_BASE_APPLICATION__ = true
    const rawWindow = window.rawWindow || Function('return window')()
    const rawDocument = window.rawDocument || Function('return document')()
    const rawRootDocument = rawWindow.Document || Function('return Document')()
    const supportModuleScript = isSupportModuleScript()
    /**
     * save patch raw methods
     * pay attention to this binding
     */
    const rawSetAttribute = Element.prototype.setAttribute
    const rawAppendChild = Element.prototype.appendChild
    const rawInsertBefore = Element.prototype.insertBefore
    const rawReplaceChild = Element.prototype.replaceChild
    const rawRemoveChild = Element.prototype.removeChild
    const rawAppend = Element.prototype.append
    const rawPrepend = Element.prototype.prepend
    const rawCloneNode = Element.prototype.cloneNode
    const rawElementQuerySelector = Element.prototype.querySelector
    const rawElementQuerySelectorAll = Element.prototype.querySelectorAll
    const rawInnerHTMLDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')

    const rawCreateElement = rawRootDocument.prototype.createElement
    const rawCreateElementNS = rawRootDocument.prototype.createElementNS
    const rawCreateDocumentFragment = rawRootDocument.prototype.createDocumentFragment
    const rawCreateTextNode = rawRootDocument.prototype.createTextNode
    const rawQuerySelector = rawRootDocument.prototype.querySelector
    const rawQuerySelectorAll = rawRootDocument.prototype.querySelectorAll
    const rawGetElementById = rawRootDocument.prototype.getElementById
    const rawGetElementsByClassName = rawRootDocument.prototype.getElementsByClassName
    const rawGetElementsByTagName = rawRootDocument.prototype.getElementsByTagName
    const rawGetElementsByName = rawRootDocument.prototype.getElementsByName

    const ImageProxy = new Proxy(Image, {
      construct (Target, args): HTMLImageElement {
        const elementImage = new Target(...args)
        elementImage.__MICRO_APP_NAME__ = getCurrentAppName()
        return elementImage
      },
    })

    /**
     * save effect raw methods
     * pay attention to this binding, especially setInterval, setTimeout, clearInterval, clearTimeout
     */
    const rawSetInterval = rawWindow.setInterval
    const rawSetTimeout = rawWindow.setTimeout
    const rawClearInterval = rawWindow.clearInterval
    const rawClearTimeout = rawWindow.clearTimeout
    const rawPushState = rawWindow.history.pushState
    const rawReplaceState = rawWindow.history.replaceState

    const rawWindowAddEventListener = rawWindow.addEventListener
    const rawWindowRemoveEventListener = rawWindow.removeEventListener
    const rawDocumentAddEventListener = rawDocument.addEventListener
    const rawDocumentRemoveEventListener = rawDocument.removeEventListener
    // TODO: 统一使用 EventTarget 去掉上面四个
    const rawAddEventListener = EventTarget.prototype.addEventListener
    const rawRemoveEventListener = EventTarget.prototype.removeEventListener

    assign(globalEnv, {
      // common global vars
      rawWindow,
      rawDocument,
      rawRootDocument,
      supportModuleScript,

      // source/patch
      rawSetAttribute,
      rawAppendChild,
      rawInsertBefore,
      rawReplaceChild,
      rawRemoveChild,
      rawAppend,
      rawPrepend,
      rawCloneNode,
      rawElementQuerySelector,
      rawElementQuerySelectorAll,
      rawInnerHTMLDesc,

      rawCreateElement,
      rawCreateElementNS,
      rawCreateDocumentFragment,
      rawCreateTextNode,
      rawQuerySelector,
      rawQuerySelectorAll,
      rawGetElementById,
      rawGetElementsByClassName,
      rawGetElementsByTagName,
      rawGetElementsByName,
      ImageProxy,

      // sandbox/effect
      rawWindowAddEventListener,
      rawWindowRemoveEventListener,
      rawSetInterval,
      rawSetTimeout,
      rawClearInterval,
      rawClearTimeout,
      rawDocumentAddEventListener,
      rawDocumentRemoveEventListener,
      rawPushState,
      rawReplaceState,

      rawAddEventListener,
      rawRemoveEventListener,

      // iframe

    })

    // global effect
    rejectMicroAppStyle()
  }
}

export default globalEnv
