import { describe, expect, it } from "vitest";
import { devServerScript, wranglerConfig } from "../src/steps/localdev.ts";

describe("wranglerConfig", () => {
  it("binds a local D1 and uses the server dev port", () => {
    const config = wranglerConfig("my-app", 3000);
    expect(config).toContain('"name": "my-app-server"');
    expect(config).toContain('"binding": "DB"');
    expect(config).toContain('"migrations_dir": ".wrangler/migrations"');
    expect(config).toContain('"dev": { "port": 3000 }');
  });
});

describe("devServerScript", () => {
  it("reads the port the wrangler config declares", () => {
    const pattern = /const port = Number\(\/(.+)\/\.exec/.exec(devServerScript())?.[1];
    expect(pattern).toBeDefined();
    expect(new RegExp(pattern ?? "").exec(wranglerConfig("my-app", 4100))?.[1]).toBe("4100");
  });
});
