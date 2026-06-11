import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// Simulate what barLine does
function barLine(line, width) {
  const currentWidth = visibleWidth(line);
  const padding = " ".repeat(Math.max(0, width - currentWidth));
  const padded = line + padding;
  return padded;
}

// Test case 1: CJK result from truncate, then bar-line padding
const cjkLine = "中文" + "a".repeat(50);
const input1 = "   " + cjkLine;
const truncated1 = truncateToWidth(input1, 40);
const padded1 = barLine(truncated1, 40);
console.log("Test 1 (CJK through barLine):");
console.log(`  Truncated visible width: ${visibleWidth(truncated1)}`);
console.log(`  Padded visible width: ${visibleWidth(padded1)}`);
console.log(`  Exceeds 40? ${visibleWidth(padded1) > 40}`);

// Test case 2: Tab result
const tabLine = "a\tb\tc".repeat(20);
const input2 = "   " + tabLine;
const truncated2 = truncateToWidth(input2, 40);
const padded2 = barLine(truncated2, 40);
console.log("\nTest 2 (Tabs through barLine):");
console.log(`  Truncated visible width: ${visibleWidth(truncated2)}`);
console.log(`  Padded visible width: ${visibleWidth(padded2)}`);
console.log(`  Exceeds 40? ${visibleWidth(padded2) > 40}`);

// Test case 3: Path that might be tricky - result line without any prefix truncation
const shortLine = "short";
const input3 = "   " + shortLine;
const truncated3 = truncateToWidth(input3, 40);
const padded3 = barLine(truncated3, 40);
console.log("\nTest 3 (Short line through barLine):");
console.log(`  Truncated visible width: ${visibleWidth(truncated3)}`);
console.log(`  Padded visible width: ${visibleWidth(padded3)}`);
console.log(`  Exceeds 40? ${visibleWidth(padded3) > 40}`);
