import CryptoJS from 'crypto-js'

const SECRET = process.env.ENCRYPTION_SECRET || 'crypto-trading-secret-key-2024'

export function encrypt(text: string): string {
  return CryptoJS.AES.encrypt(text, SECRET).toString()
}

export function decrypt(cipher: string): string {
  try {
    const bytes = CryptoJS.AES.decrypt(cipher, SECRET)
    return bytes.toString(CryptoJS.enc.Utf8)
  } catch {
    return ''
  }
}
