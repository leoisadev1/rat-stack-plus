import { describe, expect, it } from "vitest";
import { devPorts, validateHost } from "../src/stack.ts";
import { allowDevHost, devConfigJson, devServerScript, devWebScript, setAlchemyDevPorts, wranglerConfig } from "../src/steps/localdev.ts";

describe("wranglerConfig", () => {
  it("binds a local D1 and leaves the port to dev.config.json", () => {
    const config = wranglerConfig("my-app");
    expect(config).toContain('"name": "my-app-server"');
    expect(config).toContain('"binding": "DB"');
    expect(config).toContain('"migrations_dir": ".wrangler/migrations"');
    expect(config).not.toContain('"dev"');
  });
});

describe("devPorts", () => {
  it("puts the web app on the port after the server", () => {
    expect(devPorts({ port: 4100 })).toEqual({ server: 4100, web: 4101 });
    expect(devConfigJson("localhost", devPorts({ port: 4100 }))).toBe(
      '{\n  "host": "localhost",\n  "serverPort": 4100,\n  "webPort": 4101\n}\n',
    );
  });
});

describe("validateHost", () => {
  it("accepts hostnames and IPv4 addresses", () => {
    for (const host of ["localhost", "100.84.34.117", "box.tail1234.ts.net"]) expect(validateHost(host)).toBeUndefined();
  });

  it("rejects wildcard binds and out-of-range IPs", () => {
    expect(validateHost("0.0.0.0")).toMatch(/Tailscale/);
    expect(validateHost("999.999.999.999")).toMatch(/not a valid IPv4/);
  });
});

describe("setAlchemyDevPorts", () => {
  it("sets the server port first and the web port second", () => {
    const source = "server = { dev: { port: 3000 } }\nweb = { dev: { port: 3001 } }";
    expect(setAlchemyDevPorts(source, { server: 4100, web: 4101 })).toBe(
      "server = { dev: { port: 4100 } }\nweb = { dev: { port: 4101 } }",
    );
  });
});

describe("devServerScript", () => {
  it("overrides the auth and CORS URLs for Better Auth", () => {
    const script = devServerScript("better-auth");
    expect(script).toContain("`BETTER_AUTH_URL:${serverUrl}`");
    expect(script).toContain("`CORS_ORIGIN:${webUrl}`");
    expect(script).toContain('"--ip", bindHost');
  });

  it("only overrides CORS without Better Auth", () => {
    expect(devServerScript("none")).not.toContain("BETTER_AUTH_URL");
  });
});

describe("devWebScript", () => {
  it("passes the server URL each frontend reads", () => {
    expect(devWebScript("tanstack-start")).toContain("VITE_SERVER_URL: serverUrl");
    expect(devWebScript("react-router")).toContain('spawnSync("react-router"');
    expect(devWebScript("next")).toContain("NEXT_PUBLIC_SERVER_URL: serverUrl");
    expect(devWebScript("next")).toContain('"--hostname", bindHost');
  });
});

describe("allowDevHost", () => {
  it("adds allowedDevOrigins to the Next config once", () => {
    const source = 'const nextConfig: NextConfig = {\n  typedRoutes: true,\n};\n';
    const once = allowDevHost(source);
    expect(once).toContain("allowedDevOrigins: process.env.DEV_HOST ? [process.env.DEV_HOST] : [],");
    expect(allowDevHost(once)).toBe(once);
  });
});

describe("generated dev scripts", () => {
  it("import only what they use", () => {
    expect(devServerScript("none")).toContain("import { bindHost, serverPort, webUrl }");
    expect(devWebScript("next")).not.toContain("isIp");
  });
});
