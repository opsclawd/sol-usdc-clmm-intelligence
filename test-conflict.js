function normalizeTextReplaceNumbers(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\d+\.?\d*\b/g, "#")
    .trim();
}
const claimsA = ["Solana price is $100", "High trading volume reported"];
const claimsB = ["Solana price is $95", "High trading volume reported"];
const normA = claimsA.map(normalizeTextReplaceNumbers).sort();
const normB = claimsB.map(normalizeTextReplaceNumbers).sort();
console.log(normA.join("|") !== normB.join("|"));
console.log(normA);
console.log(normB);
