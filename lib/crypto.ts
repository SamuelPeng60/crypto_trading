import CryptoJS from 'crypto-js'

function getSecret(): string {
  const s = process.env.ENCRYPTION_SECRET
  if (!s) {
    throw new Error(
      '[crypto] ENCRYPTION_SECRET 環境變數未設定。請在 .env.local 加入 ENCRYPTION_SECRET=<32字元以上隨機字串>'
    )
  }
  if (s.length < 32) {
    throw new Error(
      `[crypto] ENCRYPTION_SECRET 太短（${s.length} 字元），至少需要 32 字元`
    )
  }
  return s
}

export function encrypt(text: string): string {
  return CryptoJS.AES.encrypt(text, getSecret()).toString()
}

export function decrypt(cipher: string): string {
  try {
    const bytes = CryptoJS.AES.decrypt(cipher, getSecret())
    return bytes.toString(CryptoJS.enc.Utf8)
  } catch {
    return ''
  }
}
