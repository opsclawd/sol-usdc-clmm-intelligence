import { z } from "zod";
import type {
  ContextEventStatus,
  ContextEventSeverity,
  ContextEventWarning,
  ContextEventSourceQuality,
  ContextEventRawProvenance
} from "../../contracts/context-events.js";

const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_TITLE_LENGTH = 1000;
const MAX_SOURCE_REFERENCES = 50;
const MAX_AFFECTED_SCOPE = 100;

export function finiteInteger(): z.ZodType<number> {
  return z.number().refine(Number.isFinite, {
    message: "must be a finite number"
  });
}

export function positiveInteger(): z.ZodType<number> {
  return z.number().refine((n) => Number.isFinite(n) && n >= 0, {
    message: "must be a finite non-negative number"
  });
}

export function contextEventStatusSchema(): z.ZodType<ContextEventStatus> {
  return z.enum(["SCHEDULED", "ACTIVE", "RESOLVED", "CANCELLED", "UNCONFIRMED"]);
}

export const contextEventSeveritySchema: z.ZodType<ContextEventSeverity> = z.enum([
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW"
]);

export const contextEventWarningSchema: z.ZodType<ContextEventWarning> = z.enum([
  "conflicting_times",
  "source_disagreement",
  "incomplete_information",
  "missing_qualifying_confirmation",
  "postponed",
  "stale_observation"
]);

export function contextEventSourceQualitySchema(): z.ZodType<ContextEventSourceQuality> {
  return z.object({
    providerId: z.string(),
    reliability: z.number().min(0).max(1),
    completeness: z.enum(["complete", "partial"]),
    confirmation: z.enum(["official", "primary", "secondary", "none"])
  });
}

export function contextEventRawProvenanceSchema(): z.ZodType<ContextEventRawProvenance> {
  return z.object({
    sourceObservedAtUnixMs: finiteInteger(),
    retrievedAtUnixMs: finiteInteger(),
    retentionMode: z.literal("bounded_factual_extract"),
    license: z.string()
  });
}

const scheduledEventSnapshotSchema = z.object({
  providerId: z.string(),
  providerSourceEventId: z.string(),
  title: z.string().max(MAX_TITLE_LENGTH),
  description: z.string().max(MAX_DESCRIPTION_LENGTH),
  scheduledStartUnixMs: finiteInteger(),
  scheduledEndUnixMs: finiteInteger().nullable(),
  severity: contextEventSeveritySchema,
  status: contextEventStatusSchema(),
  sourceReferences: z.array(z.unknown()).max(MAX_SOURCE_REFERENCES),
  affectedScope: z.array(z.string()).max(MAX_AFFECTED_SCOPE),
  sourceQuality: contextEventSourceQualitySchema(),
  sourceObservedAtUnixMs: finiteInteger()
});

const protocolIncidentSnapshotSchema = z.object({
  providerId: z.string(),
  providerSourceEventId: z.string(),
  title: z.string().max(MAX_TITLE_LENGTH),
  description: z.string().max(MAX_DESCRIPTION_LENGTH),
  detectedAtUnixMs: finiteInteger(),
  resolvedAtUnixMs: finiteInteger().nullable(),
  severity: contextEventSeveritySchema,
  status: contextEventStatusSchema(),
  sourceReferences: z.array(z.unknown()).max(MAX_SOURCE_REFERENCES),
  affectedScope: z.array(z.string()).max(MAX_AFFECTED_SCOPE),
  sourceQuality: contextEventSourceQualitySchema(),
  sourceObservedAtUnixMs: finiteInteger()
});

export interface BoundedScheduledEventSnapshot {
  providerId: string;
  providerSourceEventId: string;
  source: "macro-calendar-api";
  payloadHash: string;
  snapshot: z.infer<typeof scheduledEventSnapshotSchema>;
  sourceObservedAtUnixMs: number;
  retrievedAtUnixMs: number;
}

export interface BoundedProtocolIncidentSnapshot {
  providerId: string;
  providerSourceEventId: string;
  source: "solana-status-api";
  payloadHash: string;
  snapshot: z.infer<typeof protocolIncidentSnapshotSchema>;
  sourceObservedAtUnixMs: number;
  retrievedAtUnixMs: number;
}

const boundedScheduledEventSnapshotInputSchema = z.object({
  providerId: z.string(),
  providerSourceEventId: z.string(),
  source: z.literal("macro-calendar-api"),
  payloadHash: z.string(),
  snapshot: scheduledEventSnapshotSchema,
  sourceObservedAtUnixMs: finiteInteger(),
  retrievedAtUnixMs: finiteInteger()
});

const boundedProtocolIncidentSnapshotInputSchema = z.object({
  providerId: z.string(),
  providerSourceEventId: z.string(),
  source: z.literal("solana-status-api"),
  payloadHash: z.string(),
  snapshot: protocolIncidentSnapshotSchema,
  sourceObservedAtUnixMs: finiteInteger(),
  retrievedAtUnixMs: finiteInteger()
});

export class ContextEventValidationError extends Error {
  constructor(
    public readonly field: string,
    public readonly message: string
  ) {
    super(`[${field}] ${message}`);
    this.name = "ContextEventValidationError";
  }
}

function validateScheduledEventSnapshotInternal(data: unknown): BoundedScheduledEventSnapshot {
  const parsed = boundedScheduledEventSnapshotInputSchema.strict().parse(data);
  if (parsed.snapshot.scheduledEndUnixMs !== null) {
    if (parsed.snapshot.scheduledEndUnixMs < parsed.snapshot.scheduledStartUnixMs) {
      throw new ContextEventValidationError(
        "scheduledEndUnixMs",
        "scheduledEndUnixMs cannot be before scheduledStartUnixMs"
      );
    }
  }
  if (parsed.retrievedAtUnixMs < parsed.sourceObservedAtUnixMs) {
    throw new ContextEventValidationError(
      "retrievedAtUnixMs",
      "retrievedAtUnixMs cannot be before sourceObservedAtUnixMs"
    );
  }
  return parsed as BoundedScheduledEventSnapshot;
}

function validateProtocolIncidentSnapshotInternal(data: unknown): BoundedProtocolIncidentSnapshot {
  const parsed = boundedProtocolIncidentSnapshotInputSchema.strict().parse(data);
  const now = Date.now();
  const clockSkewToleranceMs = 300000;
  if (parsed.snapshot.detectedAtUnixMs > now + clockSkewToleranceMs) {
    throw new ContextEventValidationError(
      "detectedAtUnixMs",
      "detectedAtUnixMs cannot be in the future beyond clock skew tolerance"
    );
  }
  if (
    parsed.snapshot.resolvedAtUnixMs !== null &&
    parsed.snapshot.resolvedAtUnixMs < parsed.snapshot.detectedAtUnixMs
  ) {
    throw new ContextEventValidationError(
      "resolvedAtUnixMs",
      "resolvedAtUnixMs cannot be before detectedAtUnixMs"
    );
  }
  if (parsed.retrievedAtUnixMs < parsed.sourceObservedAtUnixMs) {
    throw new ContextEventValidationError(
      "retrievedAtUnixMs",
      "retrievedAtUnixMs cannot be before sourceObservedAtUnixMs"
    );
  }
  return parsed as BoundedProtocolIncidentSnapshot;
}

export function acceptScheduledEventSnapshot(input: unknown): BoundedScheduledEventSnapshot {
  try {
    return validateScheduledEventSnapshotInternal(input);
  } catch (err) {
    if (err instanceof ContextEventValidationError) {
      throw err;
    }
    if (err instanceof z.ZodError) {
      const issues = err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new ContextEventValidationError("schema", issues);
    }
    throw err;
  }
}

export function acceptProtocolIncidentSnapshot(input: unknown): BoundedProtocolIncidentSnapshot {
  try {
    return validateProtocolIncidentSnapshotInternal(input);
  } catch (err) {
    if (err instanceof ContextEventValidationError) {
      throw err;
    }
    if (err instanceof z.ZodError) {
      const issues = err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new ContextEventValidationError("schema", issues);
    }
    throw err;
  }
}
