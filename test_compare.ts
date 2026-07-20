import { compare } from "./src/domain/derived-feature/decimal";

const left = { numerator: 1n, denominator: -2n }; // -0.5
const right = { numerator: 1n, denominator: 3n }; // 0.333

console.log(compare(left, right)); // Should be -1 since -0.5 < 0.333
