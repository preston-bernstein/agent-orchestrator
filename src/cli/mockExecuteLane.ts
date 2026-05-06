import { mockFixSubagentCompletion } from "../agents/fixSubagent.js";
import { mockSubagentCompletion } from "../agents/subagent/index.js";
import { mockExec } from "../gates/runQuality.js";
import { runExecuteLane } from "../workflows/executeLane.js";

type RunExecuteLaneInput = Parameters<typeof runExecuteLane>[0];
type RunExecuteLaneDeps = Parameters<typeof runExecuteLane>[1];

export async function runMockExecuteLane(
  opts: RunExecuteLaneInput,
  inject?: Pick<RunExecuteLaneDeps, "wrapSupervisorTaskRun">,
): ReturnType<typeof runExecuteLane> {
  const diffBlock = [
    "diff --git a/mock/no-op/readme.md b/mock/no-op/readme.md\n",
    "+++ b/mock/no-op/readme.md\n",
    "@@ -0,0 +1 @@\n",
    "+orch fixture tweak\n",
  ].join("");
  return runExecuteLane(
    { ctx: opts.ctx, plan: opts.plan, repos: opts.repos, runDir: opts.runDir },
    {
      subagentCompletion: mockSubagentCompletion(diffBlock, ["mock/no-op/readme.md"]),
      fixSubagentCompletion: mockFixSubagentCompletion(),
      exec: mockExec({ exit: 0, stdout: "MOCK GATE OK" }),
      reviewerPhase2Completion: async () => ({
        rationale: "phase2 mock: no additional findings",
        findings: [],
      }),
      ...(inject?.wrapSupervisorTaskRun
        ? { wrapSupervisorTaskRun: inject.wrapSupervisorTaskRun }
        : {}),
    },
  );
}
