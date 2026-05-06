import type { StackProfile } from "../../stacks/types.js";
import type { SubagentOutputT } from "./schema.js";

function pathInGlob(filePath: string, glob: string): boolean {
  if (glob === filePath) return true;
  if (glob.endsWith("/**")) {
    const root = glob.slice(0, -3);
    return filePath === root || filePath.startsWith(root + "/");
  }
  if (glob.endsWith("**")) {
    const root = glob.slice(0, -2);
    return filePath.startsWith(root);
  }
  return false;
}

export function enforceFilesTouched(
  out: SubagentOutputT,
  taskPaths: readonly string[],
): SubagentOutputT {
  if (out.status !== "patch") return out;
  const allowed = new Set(taskPaths);
  for (const f of out.files_touched) {
    const inLane = taskPaths.some((p) => f === p || pathInGlob(f, p));
    if (!inLane && !allowed.has(f)) {
      return {
        ...out,
        status: "refused",
        patch: "",
        rationale: `out of scope: ${f}`,
        refusals: [...out.refusals, `out of scope: ${f}`],
      };
    }
  }
  return out;
}

export function enforceSnapshotFlagBan(
  out: SubagentOutputT,
  profile: StackProfile,
): SubagentOutputT {
  if (out.status !== "patch") return out;
  for (const flag of profile.snapshotForbiddenFlags) {
    if (out.patch.includes(flag)) {
      return {
        ...out,
        status: "refused",
        patch: "",
        rationale: `snapshot auto-pass forbidden: ${flag}`,
        refusals: [...out.refusals, `snapshot auto-pass forbidden: ${flag}`],
      };
    }
  }
  return out;
}
