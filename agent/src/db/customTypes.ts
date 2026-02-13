import { customType } from "drizzle-orm/mysql-core/columns/custom";

import { cipherDecrypt, cipherEncrypt } from "../utils/cipher.ts";

type EncryptedTypeConfig = { mode: "varchar"; length?: number } | { mode: "text" };

export const encrypted = customType<{
  data: string;
  driverData: string;
  config: EncryptedTypeConfig;
  configRequired: false;
}>({
  dataType(config?: EncryptedTypeConfig) {
    if (config?.mode !== "text") {
      const varcharLength = config?.length ?? 256;
      return `varchar(${varcharLength})`;
    }
    return "text";
  },
  fromDriver(value: string) {
    if (!value) {
      return value;
    }
    return cipherDecrypt(value);
  },
  toDriver(value: string) {
    if (!value) {
      return value;
    }
    return cipherEncrypt(value);
  },
});
