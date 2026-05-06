import { describe, expect, it } from "vitest";
import { parseCheckboxes, plannerDryRun } from "../../src/planner/dryRun.js";

const cleanGit = async () => "";
const dirtyGit = async () => " M src/foo.ts\n";

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

const tasksWithInProgress = `# Tasks

- [x] 1. step one
- [~] 2. step two (in progress treated as not done)
`;

describe("parseCheckboxes (O5 §tasks.md parsing)", () => {
  it("recognizes [x] / [X] as done; [ ] + [~] as not done", () => {
    expect(parseCheckboxes("- [x] one\n- [ ] two\n- [X] three\n- [~] four")).toEqual([
      { done: true, line: "- [x] one" },
      { done: false, line: "- [ ] two" },
      { done: true, line: "- [X] three" },
      { done: false, line: "- [~] four" },
    ]);
  });

  it("ignores non-task lines", () => {
    const md = "# Tasks\n\nIntro.\n\n- [x] real task\n\nText\n";
    expect(parseCheckboxes(md)).toEqual([
      { done: true, line: "- [x] real task" },
    ]);
  });
});
describe("plannerDryRun — O5 skip branches", () => {
  it("skip:true when all tasks ticked + tree clean + no pending fixes", async () => {
    const out = await plannerDryRun({
      specs: [{ slug: "no-op", tasks_path: "/fake/tasks.md", repo: "/fake/repo" }],
      attempt_counter: {},
      readTasks: async () => tasksAllDone,
      gitStatus: cleanGit,
    });
    expect(out.skip).toBe(true);
    expect(out.reason).toMatch(/all tasks checked/);
  });

  it("skip:false when tasks.md has open box (O5 §3 anti-pattern)", async () => {
    const out = await plannerDryRun({
      specs: [{ slug: "feat-x", tasks_path: "/fake/tasks.md", repo: "/fake/repo" }],
      readTasks: async () => tasksOneOpen,
      gitStatus: cleanGit,
    });
    expect(out.skip).toBe(false);
    expect(out.reason).toMatch(/open tasks/);
  });

  it("skip:false when [~] in-progress marker present", async () => {
    const out = await plannerDryRun({
      specs: [{ slug: "feat-x", tasks_path: "/fake/tasks.md", repo: "/fake/repo" }],
      readTasks: async () => tasksWithInProgress,
      gitStatus: cleanGit,
    });
    expect(out.skip).toBe(false);
    expect(out.reason).toMatch(/open tasks/);
  });

  it("skip:false when tasks.md missing (per O5 edge note)", async () => {
    const out = await plannerDryRun({
      specs: [{ slug: "ghost", tasks_path: "/nope.md", repo: "/fake/repo" }],
      readTasks: async () => {
        throw new Error("ENOENT");
      },
      gitStatus: cleanGit,
    });
    expect(out.skip).toBe(false);
    expect(out.reason).toMatch(/tasks.md missing/);
  });

  it("skip:false when working tree dirty (O5 §rule 2)", async () => {
    const out = await plannerDryRun({
      specs: [{ slug: "no-op", tasks_path: "/fake/tasks.md", repo: "/fake/repo" }],
      readTasks: async () => tasksAllDone,
      gitStatus: dirtyGit,
    });
    expect(out.skip).toBe(false);
    expect(out.reason).toMatch(/working tree dirty/);
  });

  it("skip:false when prior fix-loop pending (O5 §rule 3)", async () => {
    const out = await plannerDryRun({
      specs: [{ slug: "no-op", tasks_path: "/fake/tasks.md", repo: "/fake/repo" }],
      attempt_counter: { "spring-T1": 2 },
      readTasks: async () => tasksAllDone,
      gitStatus: cleanGit,
    });
    expect(out.skip).toBe(false);
    expect(out.reason).toMatch(/prior fix-loop pending: spring-T1/);
  });

  it("skip:false when zero tasks parsed (empty body)", async () => {
    const out = await plannerDryRun({
      specs: [{ slug: "empty", tasks_path: "/fake/tasks.md", repo: "/fake/repo" }],
      readTasks: async () => "# Tasks\n\nno checkboxes here",
      gitStatus: cleanGit,
    });
    expect(out.skip).toBe(false);
    expect(out.reason).toMatch(/no tasks parsed/);
  });
});
