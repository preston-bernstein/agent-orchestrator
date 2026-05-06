export class CycleAbortError extends Error {
  constructor(
    public readonly visited: readonly string[],
    public readonly cap: number,
  ) {
    super(
      `cycle aborted: visited.length=${visited.length} > graph_depth_cap=${cap} ` +
        `(edge 32 mechanical guard)`,
    );
    this.name = "CycleAbortError";
  }
}
