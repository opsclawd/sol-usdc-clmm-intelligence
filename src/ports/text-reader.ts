export interface TextReader {
  readText(path: string): Promise<string>;
}
