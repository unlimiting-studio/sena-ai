import crypto from "node:crypto";

import { CONFIG } from "../config.ts";

const ALGORITHM = "aes-256-gcm";
const INITIALIZATION_VECTOR_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const NON_ENCRYPTED_TEXT_LENGTH = INITIALIZATION_VECTOR_LENGTH + AUTH_TAG_LENGTH;

const generateRandomIV = (): Buffer => crypto.randomBytes(INITIALIZATION_VECTOR_LENGTH);

const getEncryptionKey = (): Buffer => {
  const raw = CONFIG.DATA_ENCRYPTION_KEY.trim();
  if (raw.length === 0) {
    throw new Error("DATA_ENCRYPTION_KEY가 비어 있습니다. base64로 인코딩된 32바이트 키가 필요합니다.");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `DATA_ENCRYPTION_KEY 길이가 올바르지 않습니다. 기대값=32바이트, 실제=${key.length}바이트 (base64 decode 기준)`,
    );
  }
  return key;
};

export const cipherDecrypt = (encrypted: string): string => {
  const encryptedBuffer = Buffer.from(encrypted, "base64");

  const encryptedPayloadBuffer = encryptedBuffer.subarray(0, encryptedBuffer.length - NON_ENCRYPTED_TEXT_LENGTH);
  const iv = encryptedBuffer.subarray(
    encryptedBuffer.length - NON_ENCRYPTED_TEXT_LENGTH,
    encryptedBuffer.length - AUTH_TAG_LENGTH,
  );
  const tag = encryptedBuffer.subarray(encryptedBuffer.length - AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(tag);

  return decipher.update(encryptedPayloadBuffer, undefined, "utf-8") + decipher.final("utf-8");
};

export const cipherEncrypt = (plainText: string): string => {
  const iv = generateRandomIV();
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plainText, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([encrypted, iv, authTag]).toString("base64");
};
