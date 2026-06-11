import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// Test that dim() doesn't add unexpected width
const testLine = "中文aabbcc\t";
const dimmedLine = "\x1b[2m" + testLine + "\x1b[0m";

console.log("Original line:");
console.log(`  visibleWidth: ${visibleWidth(testLine)}`);

console.log("\nDimmed line:");
console.log(`  visibleWidth: ${visibleWidth(dimmedLine)}`);

console.log("\nWith prefix:");
const withPrefix = "   " + dimmedLine;
console.log(`  visibleWidth: ${visibleWidth(withPrefix)}`);

console.log("\nTruncated at 40:");
const truncated = truncateToWidth(withPrefix, 40);
console.log(`  visibleWidth: ${visibleWidth(truncated)}`);
console.log(`  Within 40? ${visibleWidth(truncated) <= 40}`);
