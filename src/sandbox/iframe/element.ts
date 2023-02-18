import type {
  microAppWindowType,
} from '@micro-app/types'
import type IframeSandbox from './index'
import {
  rawDefineProperty,
  CompletionPath,
  isScriptElement,
} from '../../libs/utils'
import globalEnv from '../../libs/global_env'
import {
  updateElementInfo,
} from './actions'
import {
  appInstanceMap,
} from '../../create_app'

export function patchIframeElement (
  appName: string,
  url: string,
  microAppWindow: microAppWindowType,
  iframeSandbox: IframeSandbox,
): void {
  patchIframeNode(appName, microAppWindow, iframeSandbox)
  patchIframeAttribute(appName, url, microAppWindow)
}

function patchIframeNode (
  appName: string,
  microAppWindow: microAppWindowType,
  iframeSandbox: IframeSandbox,
): void {
  // const microDocument = microAppWindow.document
  const rawDocument = globalEnv.rawDocument
  const microRootNode = microAppWindow.Node
  const rawMicroGetRootNode = microRootNode.prototype.getRootNode
  const rawMicroAppendChild = microRootNode.prototype.appendChild
  const rawMicroInsertBefore = microRootNode.prototype.insertBefore
  const rawMicroReplaceChild = microRootNode.prototype.replaceChild
  const rawMicroCloneNode = microRootNode.prototype.cloneNode

  const getRawTarget = (target: Node): Node => {
    if (target === iframeSandbox.microHead) {
      return rawDocument.head
    } else if (target === iframeSandbox.microBody) {
      return rawDocument.body
    }

    return target
  }

  microRootNode.prototype.getRootNode = function getRootNode (options?: GetRootNodeOptions): Node {
    const rootNode = rawMicroGetRootNode.call(this, options)
    // TODO: 只有shadowDOM才有效，非情shadowDOM直接指向document
    if (rootNode === appInstanceMap.get(appName)?.container) return microAppWindow.document
    return rootNode
  }

  microRootNode.prototype.appendChild = function appendChild <T extends Node> (node: T): T {
    updateElementInfo(node, microAppWindow, appName)
    // TODO：只有script才可以这样拦截，link、style不应该拦截
    if (isScriptElement(node) && node.__PURE_ELEMENT__) {
      return rawMicroAppendChild.call(this, node)
    }
    const _this = getRawTarget(this)
    if (_this !== this) {
      return _this.appendChild(node)
    }
    return rawMicroAppendChild.call(_this, node)
  }

  // TODO: 更多场景适配
  microRootNode.prototype.insertBefore = function insertBefore <T extends Node> (node: T, child: Node | null): T {
    updateElementInfo(node, microAppWindow, appName)
    // console.log(6666666, node)
    if (isScriptElement(node) && node.__PURE_ELEMENT__) {
      return rawMicroInsertBefore.call(this, node, child)
    }
    const _this = getRawTarget(this)
    if (_this !== this) {
      if (child && !_this.contains(child)) {
        return _this.appendChild(node)
      }
      return _this.insertBefore(node, child)
    }
    return rawMicroInsertBefore.call(_this, node, child)
  }

  // TODO: 更多场景适配
  microRootNode.prototype.replaceChild = function replaceChild <T extends Node> (node: Node, child: T): T {
    updateElementInfo(node, microAppWindow, appName)
    if (isScriptElement(node) && node.__PURE_ELEMENT__) {
      return rawMicroReplaceChild.call(this, node, child)
    }
    const _this = getRawTarget(this)
    if (_this !== this) {
      if (child && !_this.contains(child)) {
        _this.appendChild(node) as T
        return child
      }
      return _this.replaceChild(node, child)
    }
    return rawMicroReplaceChild.call(_this, node, child)
  }

  // patch cloneNode
  microRootNode.prototype.cloneNode = function cloneNode (deep?: boolean): Node {
    const clonedNode = rawMicroCloneNode.call(this, deep)
    return updateElementInfo(clonedNode, microAppWindow, appName)
  }

  // Adapt to new image(...) scene
  const ImageProxy = new Proxy(microAppWindow.Image, {
    construct (Target, args): HTMLImageElement {
      const elementImage = new Target(...args)
      updateElementInfo(elementImage, microAppWindow, appName)
      return elementImage
    },
  })

  rawDefineProperty(microAppWindow, 'Image', {
    configurable: true,
    writable: true,
    value: ImageProxy,
  })

  /**
   * TODO:
   * 1、append prepend
   * 2、cloneNode -- 完成
   * 3、innerHTML
   * 4、querySelector、querySelectorAll (head, body)
   * 5、Image -- 完成
   * 都是Element原型链上的方法
   */
}

function patchIframeAttribute (appName: string, url: string, microAppWindow: microAppWindowType): void {
  const microRootElement = microAppWindow.Element
  const rawMicroSetAttribute = microRootElement.prototype.setAttribute

  microRootElement.prototype.setAttribute = function setAttribute (key: string, value: any): void {
    if (
      ((key === 'src' || key === 'srcset') && /^(img|script)$/i.test(this.tagName)) ||
      (key === 'href' && /^link$/i.test(this.tagName))
    ) {
      value = CompletionPath(value, url)
    }

    rawMicroSetAttribute.call(this, key, value)
  }

  const protoAttrList: Array<[HTMLElement, string]> = [
    [microAppWindow.HTMLImageElement.prototype, 'src'],
    [microAppWindow.HTMLScriptElement.prototype, 'src'],
    [microAppWindow.HTMLLinkElement.prototype, 'href'],
  ]

  protoAttrList.forEach(([target, attr]) => {
    const { enumerable, configurable, get, set } = Object.getOwnPropertyDescriptor(target, attr) || {
      enumerable: true,
      configurable: true,
    }

    rawDefineProperty(target, attr, {
      enumerable,
      configurable,
      get: function () {
        return get?.call(this)
      },
      set: function (value) {
        set?.call(this, CompletionPath(value, url))
      },
    })
  })
}
