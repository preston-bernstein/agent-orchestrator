import { describe, expect, it } from "vitest";
import {
  ManagedRepoEnvError,
  ManagedRepoMetaInvalid,
  ManagedRepoMetaMissing,
  cwdsFromManagedRepos,
  loadManagedRepos,
  parseManagedReposEnv,
  parseMetaYaml,
  parseRepoMeta,
  repoIdForSupervisor,
  supervisorIdForRepo,
} from "../../src/config/managedRepos.js";
import { UnknownStackError } from "../../src/stacks/index.js";

const SPRING_META = `---
created: 2026-05-02
stack: java-spring
package_manager: maven
language_version: 21
codegen_paths:
  - "target/generated-sources/**"
  - "src/main/generated/**"
generated_markers:
  - "@Generated"
contract:
  format: openapi-3
  spec_path: "target/openapi.json"
restricted_paths:
  - "src/main/resources/db/migration/**"
  - "pom.xml"
owners:
  - prestonbernstein
---

# Repo manifest — spring-api
`;

const ORCH_META = `---
stack: ts-node
codegen_paths: []
generated_markers:
  - "// @generated"
contract:
  format: none
  spec_path: ""
restricted_paths:
  - "tsconfig.json"
---

# orch-self
`;

describe("parseMetaYaml — vault _meta.md shape", () => {
  it("parses scalars + arrays + nested object", () => {
    const obj = parseMetaYaml(`stack: java-spring
package_manager: maven
restricted_paths:
  - "pom.xml"
  - "target/**"
contract:
  format: openapi-3
  spec_path: "target/openapi.json"`);
    expect(obj.stack).toBe("java-spring");
    expect(obj.package_manager).toBe("maven");
    expect(obj.restricted_paths).toEqual(["pom.xml", "target/**"]);
    expect(obj.contract).toEqual({
      format: "openapi-3",
      spec_path: "target/openapi.json",
    });
  });

  it("treats key-only top entries followed by next top key as empty array", () => {
    const obj = parseMetaYaml(`codegen_paths:
stack: ts-node`);
    expect(obj.codegen_paths).toEqual([]);
    expect(obj.stack).toBe("ts-node");
  });
});

describe("parseRepoMeta — schema validation", () => {
  it("parses spring-api fixture w/ contract + restricted_paths", () => {
    const meta = parseRepoMeta(SPRING_META);
    expect(meta.stack).toBe("java-spring");
    expect(meta.contract?.spec_path).toBe("target/openapi.json");
    expect(meta.restricted_paths).toContain("pom.xml");
  });

  it("parses orch fixture w/ empty codegen_paths", () => {
    const meta = parseRepoMeta(ORCH_META);
    expect(meta.stack).toBe("ts-node");
    expect(meta.codegen_paths).toEqual([]);
  });

  it("throws when frontmatter missing", () => {
    expect(() => parseRepoMeta("# body only\n")).toThrow(/no frontmatter/);
  });

  it("throws on schema violation (missing stack)", () => {
    expect(() =>
      parseRepoMeta(`---
package_manager: maven
---
`),
    ).toThrow();
  });
});

describe("parseManagedReposEnv", () => {
  it("parses single-repo entry", () => {
    const out = parseManagedReposEnv("spring-api:/abs/spring-api");
    expect(out["spring-api"]).toBe("/abs/spring-api");
  });

  it("parses two-repo csv", () => {
    const out = parseManagedReposEnv(
      "spring-api:/abs/sa, react-ui:/abs/ru",
    );
    expect(out["spring-api"]).toBe("/abs/sa");
    expect(out["react-ui"]).toBe("/abs/ru");
  });

  it("returns empty for empty string", () => {
    expect(parseManagedReposEnv("")).toEqual({});
    expect(parseManagedReposEnv("   ")).toEqual({});
  });

  it("throws on malformed pair (no colon)", () => {
    expect(() => parseManagedReposEnv("spring-api/abs")).toThrow(
      ManagedRepoEnvError,
    );
  });

  it("throws on unknown repo id", () => {
    expect(() => parseManagedReposEnv("rust-axum:/abs")).toThrow(
      ManagedRepoEnvError,
    );
  });

  it("throws on relative path", () => {
    expect(() => parseManagedReposEnv("spring-api:./relative")).toThrow(
      ManagedRepoEnvError,
    );
  });

  it("throws on duplicate repo id", () => {
    expect(() =>
      parseManagedReposEnv("spring-api:/a,spring-api:/b"),
    ).toThrow(ManagedRepoEnvError);
  });
});

describe("supervisor ↔ repo mapping", () => {
  it("maps repo → supervisor", () => {
    expect(supervisorIdForRepo("spring-api")).toBe("spring");
    expect(supervisorIdForRepo("react-ui")).toBe("react");
    expect(supervisorIdForRepo("agent-orchestrator")).toBe("orch");
  });

  it("maps supervisor → repo", () => {
    expect(repoIdForSupervisor("spring")).toBe("spring-api");
  });
});

describe("loadManagedRepos — full pipeline w/ injected reader", () => {
  const fakeReader = (files: Record<string, string>) =>
    async (p: string) => {
      const body = files[p];
      if (body === undefined) throw new Error(`ENOENT ${p}`);
      return body;
    };

  it("builds ManagedRepoMap keyed by supervisor id", async () => {
    const out = await loadManagedRepos({
      envRaw: "spring-api:/abs/sa",
      readMeta: fakeReader({ "/abs/sa/docs/_meta.md": SPRING_META }),
    });
    expect(Object.keys(out)).toEqual(["spring"]);
    expect(out.spring?.repoId).toBe("spring-api");
    expect(out.spring?.cwd).toBe("/abs/sa");
    expect(out.spring?.profile.id).toBe("java-spring");
    expect(out.spring?.meta.contract?.spec_path).toBe("target/openapi.json");
  });

  it("throws ManagedRepoMetaMissing when reader rejects", async () => {
    await expect(
      loadManagedRepos({
        envRaw: "spring-api:/abs/sa",
        readMeta: fakeReader({}),
      }),
    ).rejects.toBeInstanceOf(ManagedRepoMetaMissing);
  });

  it("throws ManagedRepoMetaInvalid on bad frontmatter", async () => {
    await expect(
      loadManagedRepos({
        envRaw: "spring-api:/abs/sa",
        readMeta: fakeReader({ "/abs/sa/docs/_meta.md": "no frontmatter\n" }),
      }),
    ).rejects.toBeInstanceOf(ManagedRepoMetaInvalid);
  });

  it("rethrows UnknownStackError when _meta declares unknown stack", async () => {
    const badStack = SPRING_META.replace(
      "stack: java-spring",
      "stack: rust-axum",
    );
    await expect(
      loadManagedRepos({
        envRaw: "spring-api:/abs/sa",
        readMeta: fakeReader({ "/abs/sa/docs/_meta.md": badStack }),
      }),
    ).rejects.toBeInstanceOf(UnknownStackError);
  });
});

describe("cwdsFromManagedRepos", () => {
  it("flattens map → { supervisorId: cwd }", async () => {
    const map = await loadManagedRepos({
      envRaw: "spring-api:/abs/sa",
      readMeta: async () => SPRING_META,
    });
    expect(cwdsFromManagedRepos(map)).toEqual({ spring: "/abs/sa" });
  });
});
