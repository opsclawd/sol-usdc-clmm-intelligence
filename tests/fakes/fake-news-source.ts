import type {
  NewsSourcePort,
  NewsSourceRequest,
  NewsSourceSnapshot,
  NewsSourceError
} from "../../src/ports/news-source.js";

export interface FakeNewsSourceCall {
  request: NewsSourceRequest;
}

export class FakeNewsSource implements NewsSourcePort {
  readonly calls: FakeNewsSourceCall[] = [];
  private response: NewsSourceSnapshot | NewsSourceError | null = null;
  private shouldThrow = false;

  setResponse(response: NewsSourceSnapshot): void {
    this.response = response;
    this.shouldThrow = false;
  }

  setError(error: NewsSourceError): void {
    this.response = error;
    this.shouldThrow = true;
  }

  async collect(request: NewsSourceRequest): Promise<NewsSourceSnapshot> {
    this.calls.push({ request });

    if (this.shouldThrow && this.response !== null) {
      throw this.response;
    }

    if (this.response === null) {
      throw new Error("FakeNewsSource: no response configured");
    }

    if (!this.shouldThrow) {
      return this.response as NewsSourceSnapshot;
    }

    throw new Error("FakeNewsSource: invalid state");
  }
}
