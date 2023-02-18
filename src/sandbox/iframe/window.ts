import type {
  microAppWindowType,
  MicroEventListener,
  CommonIframeEffect,
} from '@micro-app/types'
import {
  rawDefineProperty,
  isFunction,
  logWarn,
} from '../../libs/utils'
import globalEnv from '../../libs/global_env'
import bindFunctionToRawTarget from '../bind_function'
import {
  escape2RawWindowKeys,
  scopeIframeWindowOnEvent,
  scopeIframeWindowEvent,
} from './special_key'

export function patchIframeWindow (appName: string, microAppWindow: microAppWindowType): CommonIframeEffect {
  const rawWindow = globalEnv.rawWindow

  escape2RawWindowKeys.forEach((key: string) => {
    microAppWindow[key] = bindFunctionToRawTarget(rawWindow[key], rawWindow)
  })

  Object.getOwnPropertyNames(rawWindow)
    .filter((key: string) => /^on/.test(key) && !scopeIframeWindowOnEvent.includes(key))
    .forEach((eventName: string) => {
      const { enumerable, writable, set } = Object.getOwnPropertyDescriptor(microAppWindow, eventName) || {
        enumerable: true,
        writable: true,
      }
      try {
      /**
       * 如果设置了iframeWindow上的这些on事件，处理函数会设置到原生window上，但this会绑定到iframeWindow
       * 获取这些值，则直接从原生window上取
       * 总结：这些on事件全部都代理到原生window上
       *
       * 问题：
       * 1、如果子应用没有设置，基座设置了on事件，子应用触发事件是会不会执行基座的函数？
       *    比如 基座定义了 window.onpopstate，子应用执行跳转会不会触发基座的onpopstate函数？
       *
       * 2、如果基座已经定义了 window.onpopstate，子应用定义会不会覆盖基座的？
       *    现在的逻辑看来，是会覆盖的，那么问题1就是 肯定的
       * TODO: 一些特殊事件onpopstate、onhashchange不代理，放在scopeIframeWindowOnEvent中
       */
        rawDefineProperty(microAppWindow, eventName, {
          enumerable,
          configurable: true,
          get: () => rawWindow[eventName],
          set: writable ?? !!set
            ? (value) => { rawWindow[eventName] = isFunction(value) ? value.bind(microAppWindow) : value }
            : undefined,
        })
      } catch (e) {
        logWarn(e, appName)
      }
    })

  return windowEffect(microAppWindow)
}

function windowEffect (microAppWindow: microAppWindowType): CommonIframeEffect {
  const {
    rawWindow,
    rawAddEventListener,
    rawRemoveEventListener,
    // rawSetInterval,
    // rawSetTimeout,
    // rawClearInterval,
    // rawClearTimeout,
  } = globalEnv
  const eventListenerMap = new Map<string, Set<MicroEventListener>>()
  const sstWindowListenerMap = new Map<string, Set<MicroEventListener>>()
  // const intervalIdSet = new Set<number>()
  // const timeoutIdSet = new Set<number>()

  function getEventTarget (type: string): Window {
    return scopeIframeWindowEvent.includes(type) ? microAppWindow : rawWindow
  }

  microAppWindow.addEventListener = function (
    type: string,
    listener: MicroEventListener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const listenerList = eventListenerMap.get(type)
    if (listenerList) {
      listenerList.add(listener)
    } else {
      eventListenerMap.set(type, new Set([listener]))
    }
    listener && (listener.__MICRO_APP_MARK_OPTIONS__ = options)

    rawAddEventListener.call(getEventTarget(type), type, listener, options)
  }

  microAppWindow.removeEventListener = function (
    type: string,
    listener: MicroEventListener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const listenerList = eventListenerMap.get(type)
    if (listenerList?.size && listenerList.has(listener)) {
      listenerList.delete(listener)
    }
    rawRemoveEventListener.call(getEventTarget(type), type, listener, options)
  }

  // microAppWindow.setInterval = function (
  //   handler: TimerHandler,
  //   timeout?: number,
  //   ...args: any[]
  // ): number {
  //   const intervalId = rawSetInterval.call(microAppWindow, handler, timeout, ...args)
  //   intervalIdSet.add(intervalId)
  //   return intervalId
  // }

  // microAppWindow.setTimeout = function (
  //   handler: TimerHandler,
  //   timeout?: number,
  //   ...args: any[]
  // ): number {
  //   const timeoutId = rawSetTimeout.call(microAppWindow, handler, timeout, ...args)
  //   timeoutIdSet.add(timeoutId)
  //   return timeoutId
  // }

  // microAppWindow.clearInterval = function (intervalId: number) {
  //   intervalIdSet.delete(intervalId)
  //   rawClearInterval.call(microAppWindow, intervalId)
  // }

  // microAppWindow.clearTimeout = function (timeoutId: number) {
  //   timeoutIdSet.delete(timeoutId)
  //   rawClearTimeout.call(microAppWindow, timeoutId)
  // }

  const clearSnapshotData = () => {
    sstWindowListenerMap.clear()
    // sstIntervalIdMap.clear()
    // sstTimeoutIdMap.clear()
  }

  /**
   * 定时器的问题：
   * 1、umd模式下不再记录和清除定时器，避免出现的各种问题
   * 2、默认模式下正常清除定时器
   * 3、keep-alive模式下也不再清除。。。也对吧
   * 4、那么，预渲染呢？？？
   *    预渲染类似于keep-alive，只是渲染后隐藏应用，所以也不用清除
   * 5、默认模式下的keep-alive和预渲染不应该清除，因为清除就无法恢复了
   *    这是一个很麻烦的事情：
   *    umd的keep-alive：清除 + 恢复
   *    umd的预渲染呢：清除 + 恢复
   *    umd的卸载：不进行任何操作
   *
   *    默认模式的卸载：清除
   *    默认模式的keep-alive：清除 + 恢复
   *    默认模式的预渲染呢：清除 + 恢复
   *
   *    梳理：
   *      keep-alive、预渲染：清除 + 恢复
   *      umd的卸载：不进行任何操作
   *      默认模式的卸载：清除
   *
   *    TODO：
   *      1、完善逻辑
   *      2、现在的 清除、记录和恢复操作分散的太零散，sandbox、create_app中都有分散，将代码再优化一下，集中处理
   *
   *    现在统一：不做任何处理
   */
  const release = (): void => {
    // Clear window binding events
    if (eventListenerMap.size) {
      eventListenerMap.forEach((listenerList, type) => {
        for (const listener of listenerList) {
          rawRemoveEventListener.call(getEventTarget(type), type, listener)
        }
      })
      eventListenerMap.clear()
    }

    // if (!umdMode && !preRender) {
    //   // Clear timers
    //   if (intervalIdSet.size) {
    //     intervalIdSet.forEach((intervalId: number) => {
    //       rawClearInterval.call(rawWindow, intervalId)
    //     })
    //   }

    //   if (timeoutIdSet.size) {
    //     timeoutIdSet.forEach((_, timeoutId: number) => {
    //       rawClearTimeout.call(rawWindow, timeoutId)
    //     })
    //   }
    // }

    // intervalIdSet.clear()
    // timeoutIdSet.clear()
  }

  /**
   * record event
   * Scenes:
   * 1. exec umdMountHook in umd mode
   * 2. hidden keep-alive app
   * 3. after init prerender app
   */
  const record = (): void => {
    // record window event
    eventListenerMap.forEach((listenerList, type) => {
      if (listenerList.size) {
        sstWindowListenerMap.set(type, new Set(listenerList))
      }
    })

    // // record timers
    // if (intervalIdMap.size) {
    //   sstIntervalIdMap = new Map(intervalIdMap)
    // }

    // if (timeoutIdMap.size) {
    //   sstTimeoutIdMap = new Map(timeoutIdMap)
    // }
  }

  // rebuild event and timer before remount app
  const rebuild = (): void => {
    // rebuild window event
    sstWindowListenerMap.forEach((listenerList, type) => {
      for (const listener of listenerList) {
        microAppWindow.addEventListener(type, listener, listener?.__MICRO_APP_MARK_OPTIONS__)
      }
    })

    // // rebuild timer
    // sstIntervalIdMap.forEach((info: timeInfo) => {
    //   microAppWindow.setInterval(info.handler, info.timeout, ...info.args)
    // })

    // sstTimeoutIdMap.forEach((info: timeInfo) => {
    //   microAppWindow.setTimeout(info.handler, info.timeout, ...info.args)
    // })

    clearSnapshotData()
  }

  return {
    record,
    rebuild,
    release,
  }
}
