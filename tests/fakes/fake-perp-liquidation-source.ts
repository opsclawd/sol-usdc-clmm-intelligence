import type {
  PerpLiquidationSourcePort,
  PerpLiquidationSourceRequest,
  PerpLiquidationSourceSnapshot
} from "../../src/ports/perp-liquidation-source.js";

export class FakePerpLiquidationSource implements PerpLiquidationSourcePort {
  private snapshots: Map<string, PerpLiquidationSourceSnapshot> = new Map();
  private errorToThrow?: Error;

  setSnapshot(venue: string, snapshot: PerpLiquidationSourceSnapshot): void {
    this.snapshots.set(venue, snapshot);
  }

  setError(error: Error): void {
    this.errorToThrow = error;
  }

  async collect(_request: PerpLiquidationSourceRequest): Promise<PerpLiquidationSourceSnapshot> {
    void _request;

    if (this.errorToThrow) {
      throw this.errorToThrow;
    }
    // Return matching snapshot or default empty one
    for (const snap of this.snapshots.values()) {
      return snap;
    }
    throw new Error("No fake snapshot configured");
  }
}
