export function getColumnNames(table: object): string[] {
  return Object.keys(table).filter(
    (k) =>
      typeof (table as Record<string, unknown>)[k] === "object" &&
      (table as Record<string, unknown>)[k] !== null &&
      "dataType" in ((table as Record<string, unknown>)[k] as object)
  );
}
