
export const escape2RawWindowKeys = [
  'getComputedStyle',
  'visualViewport',
  'matchMedia',
  'DOMParser',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'ResizeObserver',
  'MutationObserver',
  'IntersectionObserver',
  'innerHeight',
  'outerHeight',
  'innerWidth',
  'outerWidth',
  'screen',
  'screenLeft',
  'screenTop',
  'screenX',
  'screenY',
  'fullScreen',
  'scrollX',
  'scrollY',
  'pageXOffset', // same as scrollX
  'pageYOffset', // same as scrollY
]

export const scopeIframeWindowOnEvent = [
  'onload',
  'onbeforeunload',
  'onunload',
]

export const scopeIframeWindowEvent = [
  'hashchange',
  'popstate',
  'DOMContentLoaded',
  'load',
  'beforeunload',
  'unload',
  'unmount', // micro-app custom event
  'appstate-change', // micro-app custom event
]

export const scopeIframeDocumentEvent = [
  'DOMContentLoaded',
  'readystatechange',
]

export const scopeIframeDocumentOnEvent = [
  'onreadystatechange',
]

export const uniqueDocumentElement = [
  'body',
  'head',
  'html',
  'title',
]

export const hijackMicroLocationKeys = [
  'host',
  'hostname',
  'port',
  'protocol',
  'origin',
]

// 有shadowRoot则代理到shadowRoot否则代理到原生document上 (属性)
export const proxy2RawDocOrShadowKeys = [
  'childElementCount',
  'children',
  'firstElementChild',
  'firstChild',
  'lastElementChild',
  'activeElement', // 普通元素没有 -- document或shadowRoot有
  'fullscreenElement', // 普通元素没有 -- document或shadowRoot有
  'pictureInPictureElement', // 普通元素没有 -- document或shadowRoot有
  'pointerLockElement', // 普通元素没有 -- document或shadowRoot有
  'styleSheets', // 普通元素没有 -- document或shadowRoot有
]

// 有shadowRoot则代理到shadowRoot否则代理到原生document上 (方法)
export const proxy2RawDocOrShadowMethods = [
  'append',
  'contains',
  'replaceChildren',
  'getSelection', // 普通元素没有 -- document或shadowRoot有
  'elementFromPoint', // 普通元素没有 -- document或shadowRoot有
  'elementsFromPoint', // 普通元素没有 -- document或shadowRoot有
  'getAnimations', // 普通元素没有 -- document或shadowRoot有
]

// 直接代理到原生document上 (属性)
export const proxy2RawDocumentKeys = [
  'characterSet',
  'compatMode',
  'contentType',
  'designMode',
  'dir',
  'doctype',
  'embeds',
  'fullscreenEnabled',
  'hidden',
  'implementation',
  'lastModified',
  'pictureInPictureEnabled',
  'plugins',
  'readyState',
  'referrer',
  'visibilityState',
  'fonts',
]

// 直接代理到原生document上 (方法)
export const proxy2RawDocumentMethods = [
  'execCommand',
  'createRange',
  'exitFullscreen',
  'exitPictureInPicture',
  'getElementsByTagNameNS',
  'hasFocus',
  'prepend',
]

export const globalPropertyList = [
  'window',
  'self',
  'globalThis'
]
