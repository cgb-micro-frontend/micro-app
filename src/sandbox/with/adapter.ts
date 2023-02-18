import type { SandBoxAdapter, AppInterface } from '@micro-app/types'
import globalEnv from '../../libs/global_env'
import { defer, rawDefineProperty } from '../../libs/utils'

export default class Adapter implements SandBoxAdapter {
  constructor () {
    this.injectReactHRMProperty()
  }

  // keys that can only assigned to rawWindow
  public escapeSetterKeyList: PropertyKey[] = [
    'location',
  ]

  // keys that can escape to rawWindow
  public staticEscapeProperties: PropertyKey[] = [
    'System',
    '__cjsWrapper',
  ]

  // keys that scoped in child app
  public staticScopeProperties: PropertyKey[] = [
    'webpackJsonp',
    'webpackHotUpdate',
    'Vue',
  ]

  // adapter for react
  private injectReactHRMProperty (): void {
    if (__DEV__) {
      // react child in non-react env
      this.staticEscapeProperties.push('__REACT_ERROR_OVERLAY_GLOBAL_HOOK__')
      // in react parent
      if (globalEnv.rawWindow.__REACT_ERROR_OVERLAY_GLOBAL_HOOK__) {
        this.staticScopeProperties = this.staticScopeProperties.concat([
          '__REACT_ERROR_OVERLAY_GLOBAL_HOOK__',
          '__reactRefreshInjected',
        ])
      }
    }
  }
}

// Fix conflict of babel-polyfill@6.x
export function fixBabelPolyfill6 (): void {
  if (globalEnv.rawWindow._babelPolyfill) globalEnv.rawWindow._babelPolyfill = false
}

/**
 * Fix error of hot reload when parent&child created by create-react-app in development environment
 * Issue: https://github.com/micro-zoe/micro-app/issues/382
 */
export function fixReactHMRConflict (app: AppInterface): void {
  if (__DEV__) {
    const rawReactErrorHook = globalEnv.rawWindow.__REACT_ERROR_OVERLAY_GLOBAL_HOOK__
    const childReactErrorHook = app.sandBox?.proxyWindow.__REACT_ERROR_OVERLAY_GLOBAL_HOOK__
    if (rawReactErrorHook && childReactErrorHook) {
      globalEnv.rawWindow.__REACT_ERROR_OVERLAY_GLOBAL_HOOK__ = childReactErrorHook
      defer(() => {
        globalEnv.rawWindow.__REACT_ERROR_OVERLAY_GLOBAL_HOOK__ = rawReactErrorHook
      })
    }
  }
}

/**
 * reDefine parentNode of html
 * Scenes:
 *  1. element-ui popover.js
 *     if (html.parentNode === document) ...
 */
export function throttleDeferForParentNode (proxyDocument: Document): void {
  const html = globalEnv.rawDocument.firstElementChild
  if (html?.parentNode === globalEnv.rawDocument) {
    setParentNode(html, proxyDocument)
    defer(() => {
      setParentNode(html, globalEnv.rawDocument)
    })
  }
}

/**
 * Modify the point of parentNode
 * @param target target Node
 * @param value parentNode
 */
export function setParentNode (target: Node, value: Document | Element): void {
  const descriptor = Object.getOwnPropertyDescriptor(target, 'parentNode')
  if (!descriptor || descriptor.configurable) {
    rawDefineProperty(target, 'parentNode', {
      value,
      configurable: true,
    })
  }
}
