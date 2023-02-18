import type {
  microAppWindowType,
  EffectController,
  MicroEventListener,
  timeInfo,
} from '@micro-app/types'
import {
  getCurrentAppName,
  setCurrentAppName,
  removeDomScope,
  logWarn,
  isFunction,
  rawDefineProperty,
} from '../../libs/utils'
import { appInstanceMap } from '../../create_app'
import globalEnv from '../../libs/global_env'

// this events should be sent to the specified app
const formatEventList = ['unmount', 'appstate-change']

/**
 * Format event name
 * @param eventName event name
 * @param appName app name
 */
export function formatEventName (eventName: string, appName: string): string {
  if (
    formatEventList.includes(eventName) ||
    (
      (eventName === 'popstate' || eventName === 'hashchange') &&
      appInstanceMap.get(appName)?.useMemoryRouter
    )
  ) {
    return `${eventName}-${appName}`
  }
  return eventName
}

// document.onclick binding list, the binding function of each application is unique
const documentClickListMap = new Map<string, unknown>()
let hasRewriteDocumentOnClick = false
/**
 * Rewrite document.onclick and execute it only once
 */
function overwriteDocumentOnClick (): void {
  hasRewriteDocumentOnClick = true
  if (Object.getOwnPropertyDescriptor(document, 'onclick')) {
    return logWarn('Cannot redefine document property onclick')
  }
  const rawOnClick = document.onclick
  document.onclick = null
  let hasDocumentClickInited = false

  function onClickHandler (e: MouseEvent) {
    documentClickListMap.forEach((f) => {
      isFunction(f) && (f as Function).call(document, e)
    })
  }

  rawDefineProperty(document, 'onclick', {
    configurable: true,
    enumerable: true,
    get () {
      const appName = getCurrentAppName()
      return appName ? documentClickListMap.get(appName) : documentClickListMap.get('base')
    },
    set (f: GlobalEventHandlers['onclick']) {
      const appName = getCurrentAppName()
      if (appName) {
        documentClickListMap.set(appName, f)
      } else {
        documentClickListMap.set('base', f)
      }

      if (!hasDocumentClickInited && isFunction(f)) {
        hasDocumentClickInited = true
        globalEnv.rawDocumentAddEventListener.call(globalEnv.rawDocument, 'click', onClickHandler, false)
      }
    }
  })

  rawOnClick && (document.onclick = rawOnClick)
}

/**
 * The document event is globally, we need to clear these event bindings when micro application unmounted
 */
const documentEventListenerMap = new Map<string, Map<string, Set<MicroEventListener>>>()
export function effectDocumentEvent (): void {
  const {
    rawDocument,
    rawDocumentAddEventListener,
    rawDocumentRemoveEventListener,
  } = globalEnv

  !hasRewriteDocumentOnClick && overwriteDocumentOnClick()

  document.addEventListener = function (
    type: string,
    listener: MicroEventListener,
    options?: boolean | AddEventListenerOptions
  ): void {
    const appName = getCurrentAppName()
    /**
     * ignore bound function of document event in umd mode, used to solve problem of react global events
     * update in 2022-09-02:
     * boundFunction is no longer exclude, because events in UMD mode will not cleared from v1.0.0-alpha.4
     * if (appName && !(appInstanceMap.get(appName)?.umdMode && isBoundFunction(listener))) {
     */
    if (appName) {
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
    }
    rawDocumentAddEventListener.call(rawDocument, type, listener, options)
  }

  document.removeEventListener = function (
    type: string,
    listener: MicroEventListener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const appName = getCurrentAppName()
    /**
     * update in 2022-09-02:
     * boundFunction is no longer exclude, because events in UMD mode will not cleared from v1.0.0-alpha.4
     * if (appName && !(appInstanceMap.get(appName)?.umdMode && isBoundFunction(listener))) {
     */
    if (appName) {
      const appListenersMap = documentEventListenerMap.get(appName)
      if (appListenersMap) {
        const appListenerList = appListenersMap.get(type)
        if (appListenerList?.size && appListenerList.has(listener)) {
          appListenerList.delete(listener)
        }
      }
    }
    rawDocumentRemoveEventListener.call(rawDocument, type, listener, options)
  }
}

// Clear the document event agent
export function releaseEffectDocumentEvent (): void {
  document.addEventListener = globalEnv.rawDocumentAddEventListener
  document.removeEventListener = globalEnv.rawDocumentRemoveEventListener
}

/**
 * Rewrite side-effect events
 * @param microAppWindow micro window
 */
export default function effect (appName: string, microAppWindow: microAppWindowType): EffectController {
  const eventListenerMap = new Map<string, Set<MicroEventListener>>()
  const intervalIdMap = new Map<number, timeInfo>()
  const timeoutIdMap = new Map<number, timeInfo>()
  const {
    rawWindow,
    rawDocument,
    rawWindowAddEventListener,
    rawWindowRemoveEventListener,
    rawSetInterval,
    rawSetTimeout,
    rawClearInterval,
    rawClearTimeout,
    rawDocumentRemoveEventListener,
  } = globalEnv

  // listener may be null, e.g test-passive
  microAppWindow.addEventListener = function (
    type: string,
    listener: MicroEventListener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    type = formatEventName(type, appName)
    const listenerList = eventListenerMap.get(type)
    if (listenerList) {
      listenerList.add(listener)
    } else {
      eventListenerMap.set(type, new Set([listener]))
    }
    listener && (listener.__MICRO_APP_MARK_OPTIONS__ = options)
    rawWindowAddEventListener.call(rawWindow, type, listener, options)
  }

  microAppWindow.removeEventListener = function (
    type: string,
    listener: MicroEventListener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    type = formatEventName(type, appName)
    const listenerList = eventListenerMap.get(type)
    if (listenerList?.size && listenerList.has(listener)) {
      listenerList.delete(listener)
    }
    rawWindowRemoveEventListener.call(rawWindow, type, listener, options)
  }

  microAppWindow.setInterval = function (
    handler: TimerHandler,
    timeout?: number,
    ...args: any[]
  ): number {
    const intervalId = rawSetInterval.call(rawWindow, handler, timeout, ...args)
    intervalIdMap.set(intervalId, { handler, timeout, args })
    return intervalId
  }

  microAppWindow.setTimeout = function (
    handler: TimerHandler,
    timeout?: number,
    ...args: any[]
  ): number {
    const timeoutId = rawSetTimeout.call(rawWindow, handler, timeout, ...args)
    timeoutIdMap.set(timeoutId, { handler, timeout, args })
    return timeoutId
  }

  microAppWindow.clearInterval = function (intervalId: number) {
    intervalIdMap.delete(intervalId)
    rawClearInterval.call(rawWindow, intervalId)
  }

  microAppWindow.clearTimeout = function (timeoutId: number) {
    timeoutIdMap.delete(timeoutId)
    rawClearTimeout.call(rawWindow, timeoutId)
  }

  const sstWindowListenerMap = new Map<string, Set<MicroEventListener>>()
  const sstDocumentListenerMap = new Map<string, Set<MicroEventListener>>()
  let sstIntervalIdMap = new Map<number, timeInfo>()
  let sstTimeoutIdMap = new Map<number, timeInfo>()
  let sstOnClickHandler: unknown

  const clearSnapshotData = () => {
    sstWindowListenerMap.clear()
    sstIntervalIdMap.clear()
    sstTimeoutIdMap.clear()
    sstDocumentListenerMap.clear()
    sstOnClickHandler = null
  }

  /**
   * record event and timer
   * Scenes:
   * 1. exec umdMountHook in umd mode
   * 2. hidden keep-alive app
   * 3. after init prerender app
   */
  const recordEffect = (): void => {
    // record window event
    eventListenerMap.forEach((listenerList, type) => {
      if (listenerList.size) {
        sstWindowListenerMap.set(type, new Set(listenerList))
      }
    })

    // record timers
    if (intervalIdMap.size) {
      sstIntervalIdMap = new Map(intervalIdMap)
    }

    if (timeoutIdMap.size) {
      sstTimeoutIdMap = new Map(timeoutIdMap)
    }

    // record onclick handler
    sstOnClickHandler = documentClickListMap.get(appName)

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
  const rebuildEffect = (): void => {
    // rebuild window event
    sstWindowListenerMap.forEach((listenerList, type) => {
      for (const listener of listenerList) {
        microAppWindow.addEventListener(type, listener, listener?.__MICRO_APP_MARK_OPTIONS__)
      }
    })

    // rebuild timer
    sstIntervalIdMap.forEach((info: timeInfo) => {
      microAppWindow.setInterval(info.handler, info.timeout, ...info.args)
    })

    sstTimeoutIdMap.forEach((info: timeInfo) => {
      microAppWindow.setTimeout(info.handler, info.timeout, ...info.args)
    })

    // rebuild onclick event
    sstOnClickHandler && documentClickListMap.set(appName, sstOnClickHandler)

    /**
     * rebuild document event
     * WARNING!!: do not delete setCurrentAppName & removeDomScope
     */
    setCurrentAppName(appName)
    sstDocumentListenerMap.forEach((listenerList, type) => {
      for (const listener of listenerList) {
        document.addEventListener(type, listener, listener?.__MICRO_APP_MARK_OPTIONS__)
      }
    })
    removeDomScope()

    clearSnapshotData()
  }

  // release all event listener & interval & timeout when unmount app
  const releaseEffect = (): void => {
    // Clear window binding events
    if (eventListenerMap.size) {
      eventListenerMap.forEach((listenerList, type) => {
        for (const listener of listenerList) {
          rawWindowRemoveEventListener.call(rawWindow, type, listener)
        }
      })
      eventListenerMap.clear()
    }

    // Clear timers
    if (intervalIdMap.size) {
      intervalIdMap.forEach((_, intervalId: number) => {
        rawClearInterval.call(rawWindow, intervalId)
      })
      intervalIdMap.clear()
    }

    if (timeoutIdMap.size) {
      timeoutIdMap.forEach((_, timeoutId: number) => {
        rawClearTimeout.call(rawWindow, timeoutId)
      })
      timeoutIdMap.clear()
    }

    // Clear the function bound by micro application through document.onclick
    documentClickListMap.delete(appName)

    // Clear document binding event
    const documentAppListenersMap = documentEventListenerMap.get(appName)
    if (documentAppListenersMap) {
      documentAppListenersMap.forEach((listenerList, type) => {
        for (const listener of listenerList) {
          rawDocumentRemoveEventListener.call(rawDocument, type, listener)
        }
      })
      documentAppListenersMap.clear()
    }
  }

  return {
    recordEffect,
    rebuildEffect,
    releaseEffect,
  }
}
