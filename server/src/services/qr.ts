import { randomInt } from 'node:crypto'

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

// 10 base62 chars from a CSPRNG: 62^10 ≈ 8e17, so tokens can't be guessed (BR-11).
export const newToken = () => Array.from({ length: 10 }, () => ALPHABET[randomInt(62)]).join('')
