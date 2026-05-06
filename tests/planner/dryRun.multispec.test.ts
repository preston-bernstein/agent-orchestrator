import { describe, expect, it } from "vitest";
import { plannerDryRun } from "../../src/planner/dryRun.js";

const cleanGit = async () => "";

const tasksAllDone = `# Tasks

- [x] 1. step one
- [x] 2. step two
- [x] 3. step three
`;

const tasksOneOpen = `# Tasks

- [x] 1. step one
- [ ] 2. step two
- [x] 3. step three
`;

describe("plannerDryRun — multi-spec OR semantics", () => {
  it("any open spec blocks skip", async () => {
    const reads: Record<string, string> = {
      "/a.md": tasksAllDone,
      "/b.md": tasksOneOpen,
    };
    const out = await plannerDryRun({
      specs: [
        { slug: "a", tasks_path: "/a.md", repo: "/r" },
        { slug: "b", tasks_path: "/b.md", repo: "/r" },
      ],
      readTasks: async (p) => reads[p] ?? "",
      gitStatus: cleanGit,
    });
    expect(out.skip).toBe(false);
    expect(out.reason).toMatch(/open tasks: b/);
  });
});
