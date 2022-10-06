import { Utils } from '@ethersphere/bee-js'
import { POD_PASSWORD_LENGTH, PodPasswordBytes } from './encryption'

export type { PublicKey } from '@fairdatasociety/fdp-contracts'
export const ETH_ADDR_HEX_LENGTH = 40

/**
 * Asserts that the given value is a number
 */
export function assertNumber(value: unknown): asserts value is number {
  if (!isNumber(value)) {
    throw new Error('Expected a number')
  }
}

/**
 * Asserts that the given value is an array
 */
export function assertArray(value: unknown): asserts value is [] {
  if (!Array.isArray(value)) {
    throw new Error('Expected an array')
  }
}

/**
 * Asserts that the given value is a string
 */
export function assertString(value: unknown): asserts value is string {
  if (!isString(value)) {
    throw new Error('Expected a string')
  }
}

/**
 * Checks that value is a valid Ethereum address string (without 0x prefix)
 */
export function isEthAddress(value: unknown): value is Utils.EthAddress {
  return Utils.isHexString(value) && value.length === ETH_ADDR_HEX_LENGTH
}

/**
 * Checks that value is a string
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

/**
 * Checks that value is a number
 */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number'
}

/**
 * Checks that value is an object
 */
// eslint-disable-next-line @typescript-eslint/ban-types
export function isObject(value: unknown): value is object {
  return typeof value === 'object'
}

/**
 * Checks that value is a pod password
 */
export function isPodPassword(value: PodPasswordBytes): value is PodPasswordBytes {
  return typeof value === 'object' && ArrayBuffer.isView(value) && value.length === POD_PASSWORD_LENGTH
}

/**
 * Asserts that the given value is a pod password
 */
export function assertPodPasswordBytes(value: PodPasswordBytes): asserts value is PodPasswordBytes {
  if (!isPodPassword(value)) {
    throw new Error('Expected a pod password bytes')
  }
}

/**
 * Checks that value is an array buffer view
 */
export function isArrayBufferView(value: unknown): value is ArrayBufferView {
  return ArrayBuffer.isView(value)
}
