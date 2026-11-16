/**
 * Password hashing with scrypt.
 *
 * Encoded format: `scrypt$N=16384,r=8,p=1$<salt-base64>$<hash-base64>` where the salt is
 * 16 random bytes and the derived key is 64 bytes (both standard base64 with padding).
 * `verifyPassword` never throws: malformed encodings, unexpected parameters, or length
 * mismatches return `false`.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto'

const VERSION = 'scrypt'
const COST_N = 16384
const BLOCK_SIZE_R = 8
const PARALLELIZATION_P = 1
const SALT_BYTES = 16
const KEY_BYTES = 64

const PARAMS = `N=${COST_N},r=${BLOCK_SIZE_R},p=${PARALLELIZATION_P}`
const HEADER = `${VERSION}$${PARAMS}`

const SCRYPT_OPTIONS: ScryptOptions = {
  N: COST_N,
  r: BLOCK_SIZE_R,
  p: PARALLELIZATION_P,
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, KEY_BYTES, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) reject(error)
      else resolve(derivedKey)
    })
  })
}

interface ParsedEncoding {
  salt: Buffer
  hash: Buffer
}

function parseEncoding(encoded: string): ParsedEncoding | null {
  const parts = encoded.split('$')
  if (parts.length !== 4) return null
  const [version, params, saltBase64, hashBase64] = parts
  if (version !== VERSION || params !== PARAMS) return null
  if (!saltBase64 || !hashBase64) return null
  const salt = Buffer.from(saltBase64, 'base64')
  const hash = Buffer.from(hashBase64, 'base64')
  if (salt.length !== SALT_BYTES || hash.length !== KEY_BYTES) return null
  return { salt, hash }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const derivedKey = await deriveKey(password, salt)
  return `${HEADER}$${salt.toString('base64')}$${derivedKey.toString('base64')}`
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = parseEncoding(encoded)
  if (!parsed) return false
  try {
    const derivedKey = await deriveKey(password, parsed.salt)
    if (derivedKey.length !== parsed.hash.length) return false
    return timingSafeEqual(derivedKey, parsed.hash)
  } catch {
    return false
  }
}
