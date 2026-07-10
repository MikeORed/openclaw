import { defaultProvider } from "@aws-sdk/credential-provider-node";
import type { AwsCredentialIdentityProvider } from "@smithy/types";

const DEFAULT_REGION = "us-east-1";

/**
 * Resolves the AWS region using priority order:
 * explicit config > AWS_REGION env > AWS_DEFAULT_REGION env > "us-east-1" fallback.
 */
export function resolveRegion(explicit?: string): string {
  return (
    explicit || process.env["AWS_REGION"] || process.env["AWS_DEFAULT_REGION"] || DEFAULT_REGION
  );
}

/**
 * Builds AWS credential provider using the standard Node credential chain.
 * Supports environment variables, shared config/profiles, container credentials, and IMDS.
 * Stores no secrets in the returned config object.
 */
export function buildAwsCredentials(params?: { region?: string }): {
  credentials: AwsCredentialIdentityProvider;
  region: string;
} {
  const region = resolveRegion(params?.region);
  const credentials = defaultProvider();
  return { credentials, region };
}
