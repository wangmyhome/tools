// 本地密码管家 —— 旧数据迁移工具（不再用于日常存储）
// 仅在从旧版本（主密码加密）迁移到新版本（免密码、明文本地存储）时使用一次：
// 旧主密码 -> PBKDF2(SHA-256) -> 临时 AES-GCM 密钥 -> 解出旧记录 -> 明文重写 -> 丢弃密钥。

const te = new TextEncoder();
const td = new TextDecoder();

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function toB64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

export function fromB64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 由主密码 + 盐派生 AES-GCM 密钥（不可导出） */
export async function deriveKey(password, saltB64, iterations) {
  const base = await crypto.subtle.importKey(
    'raw',
    te.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromB64(saltB64), iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** 加密任意可 JSON 序列化的值 -> {iv, ct} */
export async function encryptValue(key, value) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    te.encode(JSON.stringify(value))
  );
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

/** 解密 {iv, ct}，失败（密钥不匹配/数据被篡改）时抛错 */
export async function decryptValue(key, blob) {
  if (!blob || !blob.iv || !blob.ct) throw new Error('密文格式错误');
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(blob.iv) },
    key,
    fromB64(blob.ct)
  );
  return JSON.parse(td.decode(pt));
}
