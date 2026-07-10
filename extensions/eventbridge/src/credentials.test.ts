// Credentials helper unit tests.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAwsCredentials, resolveRegion } from "./credentials.js";

describe("resolveRegion", () => {
  let savedAwsRegion: string | undefined;
  let savedAwsDefaultRegion: string | undefined;

  beforeEach(() => {
    savedAwsRegion = process.env["AWS_REGION"];
    savedAwsDefaultRegion = process.env["AWS_DEFAULT_REGION"];
    delete process.env["AWS_REGION"];
    delete process.env["AWS_DEFAULT_REGION"];
  });

  afterEach(() => {
    if (savedAwsRegion !== undefined) {
      process.env["AWS_REGION"] = savedAwsRegion;
    } else {
      delete process.env["AWS_REGION"];
    }
    if (savedAwsDefaultRegion !== undefined) {
      process.env["AWS_DEFAULT_REGION"] = savedAwsDefaultRegion;
    } else {
      delete process.env["AWS_DEFAULT_REGION"];
    }
  });

  it("returns us-east-1 fallback when no explicit, no env vars", () => {
    expect(resolveRegion()).toBe("us-east-1");
  });

  it("returns explicit region when provided", () => {
    process.env["AWS_REGION"] = "eu-west-1";
    process.env["AWS_DEFAULT_REGION"] = "ap-southeast-1";
    expect(resolveRegion("us-west-2")).toBe("us-west-2");
  });

  it("returns AWS_REGION when no explicit region", () => {
    process.env["AWS_REGION"] = "eu-central-1";
    expect(resolveRegion()).toBe("eu-central-1");
  });

  it("returns AWS_DEFAULT_REGION when no explicit and no AWS_REGION", () => {
    process.env["AWS_DEFAULT_REGION"] = "ap-northeast-1";
    expect(resolveRegion()).toBe("ap-northeast-1");
  });

  it("prefers AWS_REGION over AWS_DEFAULT_REGION", () => {
    process.env["AWS_REGION"] = "eu-west-2";
    process.env["AWS_DEFAULT_REGION"] = "ap-south-1";
    expect(resolveRegion()).toBe("eu-west-2");
  });

  it("prefers explicit over AWS_REGION", () => {
    process.env["AWS_REGION"] = "eu-west-2";
    expect(resolveRegion("ca-central-1")).toBe("ca-central-1");
  });
});

describe("buildAwsCredentials", () => {
  let savedAwsRegion: string | undefined;
  let savedAwsDefaultRegion: string | undefined;

  beforeEach(() => {
    savedAwsRegion = process.env["AWS_REGION"];
    savedAwsDefaultRegion = process.env["AWS_DEFAULT_REGION"];
    delete process.env["AWS_REGION"];
    delete process.env["AWS_DEFAULT_REGION"];
  });

  afterEach(() => {
    if (savedAwsRegion !== undefined) {
      process.env["AWS_REGION"] = savedAwsRegion;
    } else {
      delete process.env["AWS_REGION"];
    }
    if (savedAwsDefaultRegion !== undefined) {
      process.env["AWS_DEFAULT_REGION"] = savedAwsDefaultRegion;
    } else {
      delete process.env["AWS_DEFAULT_REGION"];
    }
  });

  it("returns object with credentials (function) and region (string)", () => {
    const result = buildAwsCredentials({ region: "us-west-2" });
    expect(result).toHaveProperty("credentials");
    expect(result).toHaveProperty("region");
    expect(typeof result.credentials).toBe("function");
    expect(typeof result.region).toBe("string");
    expect(result.region).toBe("us-west-2");
  });

  it("uses us-east-1 fallback when no region provided and no env vars", () => {
    const result = buildAwsCredentials();
    expect(result.region).toBe("us-east-1");
  });

  it("stores no secrets in returned config (only region string and credentials provider)", () => {
    const result = buildAwsCredentials({ region: "eu-west-1" });
    const keys = Object.keys(result);
    // Only region and credentials — no access keys, tokens, or other secrets
    expect(keys).toHaveLength(2);
    expect(keys).toContain("credentials");
    expect(keys).toContain("region");
    // Region is a plain string, not a secret
    expect(result.region).toBe("eu-west-1");
    // Credentials is a provider function, not a resolved secret
    expect(typeof result.credentials).toBe("function");
  });
});
