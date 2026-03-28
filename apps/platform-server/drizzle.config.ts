import { defineConfig } from 'drizzle-kit'
import { TABLE_PREFIX } from '@sena-ai/platform/db/mysql'

export default defineConfig({
  schema: '../../packages/platform/src/db/mysql/schema.ts',
  out: './drizzle',
  dialect: 'mysql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'mysql://root:password@localhost:3306/sena_platform',
  },
  tablesFilter: TABLE_PREFIX ? [`${TABLE_PREFIX}_*`] : undefined,
})
