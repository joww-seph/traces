import { randomInt } from 'node:crypto'

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

export const newToken = () => Array.from({ length: 10 }, () => ALPHABET[randomInt(62)]).join('')
