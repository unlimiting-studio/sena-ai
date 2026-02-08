import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import type { ChunkedEntry, NoteEntry } from "../sdks/couchdb.ts";
import { type CouchDBClient, id2path, path2id, reassembleContent, writeNote } from "../sdks/couchdb.ts";

export const createSenaObsidianMcpServer = (client: CouchDBClient) =>
  createSdkMcpServer({
    name: "obsidian",
    version: "0.0.1",
    tools: [
      tool(
        "list_notes",
        "Obsidian 볼트의 특정 경로에 있는 노트와 폴더를 조회합니다. ls 명령어처럼 해당 레벨의 항목만 반환합니다. folder 미지정 시 루트 경로를 조회합니다.",
        {
          folder: z.string().optional().describe("조회할 폴더 경로 (예: 'Projects/sena')"),
          limit: z.number().int().min(1).max(500).default(50),
        },
        async (args) => {
          const docs = await client.listNoteDocuments(args.folder, 500);
          const prefix = args.folder ? args.folder.replace(/\/+$/, "") + "/" : "";

          const folders = new Set<string>();
          const files: Array<{ name: string; mtime: number }> = [];

          for (const doc of docs) {
            const filepath = id2path(doc._id);
            // Strip the prefix to get the relative path
            const relative = prefix ? filepath.slice(prefix.length) : filepath;
            const slashIdx = relative.indexOf("/");

            if (slashIdx !== -1) {
              // Has subdirectory — collect folder name
              folders.add(relative.slice(0, slashIdx));
            } else {
              // Direct child file
              files.push({ name: relative, mtime: doc.mtime });
            }
          }

          const lines: string[] = [];
          const sortedFolders = [...folders].sort();
          for (const folder of sortedFolders) {
            lines.push(`📁 ${folder}/`);
          }
          for (const file of files.slice(0, args.limit - sortedFolders.length)) {
            const mtime = new Date(file.mtime).toISOString();
            lines.push(`📄 ${file.name} (수정: ${mtime})`);
          }

          const location = args.folder || "/";
          const header = `${location} (폴더 ${sortedFolders.length}개, 파일 ${files.length}개)`;
          const body = lines.length > 0 ? lines.join("\n") : "(비어 있음)";

          return {
            content: [{ type: "text", text: `${header}\n\n${body}` }],
          };
        },
      ),

      tool(
        "read_note",
        "Obsidian 볼트에서 특정 노트의 전체 내용을 읽어옵니다.",
        {
          path: z.string().describe("노트 경로 (예: 'Daily/2024-01-01.md')"),
        },
        async (args) => {
          const docId = path2id(args.path);

          let doc: NoteEntry | ChunkedEntry;
          try {
            const raw = await client.getDocument(docId);
            if (raw.type === "leaf") {
              return {
                content: [{ type: "text", text: `노트를 찾을 수 없습니다: ${args.path}` }],
              };
            }
            doc = raw as NoteEntry | ChunkedEntry;
          } catch (err) {
            if (err instanceof Error && err.message.includes("404")) {
              return {
                content: [{ type: "text", text: `노트를 찾을 수 없습니다: ${args.path}` }],
              };
            }
            throw err;
          }

          const content = await reassembleContent(doc, client);
          const filepath = id2path(doc._id);

          return {
            content: [{ type: "text", text: `# ${filepath}\n\n${content}` }],
          };
        },
      ),

      tool(
        "search_notes",
        "Obsidian 볼트에서 키워드로 노트를 검색합니다. 경로와 내용을 모두 검색합니다.",
        {
          query: z.string().describe("검색 키워드"),
          folder: z.string().optional().describe("검색 범위를 제한할 폴더 경로"),
          limit: z.number().int().min(1).max(50).default(10),
        },
        async (args) => {
          const queryLower = args.query.toLowerCase();
          const docs = await client.listNoteDocuments(args.folder, 500);

          type SearchResult = { path: string; snippet: string; matchType: "path" | "content" };
          const results: SearchResult[] = [];

          // Phase 1: path matching
          for (const doc of docs) {
            if (results.length >= args.limit) break;
            const filepath = id2path(doc._id);
            if (filepath.toLowerCase().includes(queryLower)) {
              results.push({ path: filepath, snippet: "(경로 매칭)", matchType: "path" });
            }
          }

          // Phase 2: content matching (only if we need more results)
          if (results.length < args.limit) {
            const remaining = args.limit - results.length;
            const pathMatchedIds = new Set(results.map((r) => path2id(r.path)));

            let found = 0;
            for (const doc of docs) {
              if (found >= remaining) break;
              if (pathMatchedIds.has(doc._id)) continue;

              const filepath = id2path(doc._id);
              try {
                const content = await reassembleContent(doc, client);
                const idx = content.toLowerCase().indexOf(queryLower);
                if (idx !== -1) {
                  const start = Math.max(0, idx - 50);
                  const end = Math.min(content.length, idx + args.query.length + 50);
                  const snippet = (start > 0 ? "..." : "") + content.slice(start, end) + (end < content.length ? "..." : "");
                  results.push({ path: filepath, snippet, matchType: "content" });
                  found++;
                }
              } catch {
                // Skip documents that fail to reassemble
              }
            }
          }

          if (results.length === 0) {
            return {
              content: [{ type: "text", text: `"${args.query}" 검색 결과가 없습니다.` }],
            };
          }

          const lines = results.map(
            (r) => `- **${r.path}**\n  ${r.snippet}`,
          );

          return {
            content: [
              {
                type: "text",
                text: `"${args.query}" 검색 결과 (${results.length}건)\n\n${lines.join("\n")}`,
              },
            ],
          };
        },
      ),
      tool(
        "write_note",
        "Obsidian 볼트에 노트를 생성하거나 수정합니다. 기존 노트가 있으면 내용을 덮어씁니다.",
        {
          path: z.string().describe("노트 경로 (예: 'Daily/2026-02-08.md')"),
          content: z.string().describe("노트 내용 (Markdown)"),
        },
        async (args) => {
          try {
            await writeNote(client, args.path, args.content);
            return {
              content: [{ type: "text", text: `노트 저장 완료: ${args.path}` }],
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const isConflict = message.includes("409");
            const guide = isConflict
              ? " Obsidian에서 동시에 수정되어 충돌이 발생했습니다. 다시 시도하면 최신 revision 기반으로 저장됩니다."
              : "";
            return {
              content: [{ type: "text", text: `노트 저장 실패: ${message}${guide}` }],
            };
          }
        },
      ),
    ],
  });
