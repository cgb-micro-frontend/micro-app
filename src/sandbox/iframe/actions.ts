import type {
  microAppWindowType,
} from '@micro-app/types'
import {
  rawDefineProperties,
} from '../../libs/utils'

export function updateElementInfo <T extends Node> (
  element: T,
  microAppWindow: microAppWindowType,
  appName: string,
): T {
  if (!element.__MICRO_APP_NAME__) {
    const proxyLocation = microAppWindow.microApp.location
    rawDefineProperties(element, {
      baseURI: {
        configurable: true,
        get: () => proxyLocation.href,
      },
      ownerDocument: {
        configurable: true,
        get: () => microAppWindow.document,
      },
      __MICRO_APP_NAME__: {
        configurable: true,
        writable: true,
        value: appName,
      },
    })
  }

  return element
}
