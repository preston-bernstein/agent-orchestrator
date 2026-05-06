import { z } from "zod";

const frontMatterSchema = z.object({
  vault_git_sha: z.string().optional(),
  vault_cut_date: z.string().optional(),
  playbook_path: z.string().optional(),
});

export { frontMatterSchema };

export const ExpectationsSnapshotSchema = z.object({
  docPath: z.string(),
  docSha256: z.string(),
  vault_git_sha: z.string().optional(),
  vault_cut_date: z.string().optional(),
  playbook_path: z.string().optional(),
});
export type ExpectationsSnapshot = z.infer<typeof ExpectationsSnapshotSchema>;
