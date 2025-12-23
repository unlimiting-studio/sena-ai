import { customType } from "drizzle-orm/mysql-core";

import { cipherDecrypt, cipherEncrypt } from "../utils/cipher.ts";

export const encrypted = customType<{
  data: string;
  driverData: string;
  config?: { mode: "varchar"; length?: number } | { mode: "text" };
}>({
  dataType(config) {
    if (config?.mode !== "text") {
      const varcharLength = config?.length ?? 256;
      return `varchar(${varcharLength})`;
    }
    return "text";
  },
  fromDriver(value) {
    if (!value) {
      return value;
    }
    return cipherDecrypt(value);
  },
  toDriver(value) {
    if (!value) {
      return value;
    }
    return cipherEncrypt(value);
  },
});
