import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// Test case 1: CJK characters (each width 2)
const cjkLine = "中文" + "a".repeat(50); // 2+2+50 = 54 visible
const input1 = "   " + cjkLine; // 3+54 = 57
const result1 = truncateToWidth(input1, 40);
console.log("Test 1 (CJK):");
console.log(`  Input visible width: ${visibleWidth(input1)}`);
console.log(`  Result: "${result1}"`);
console.log(`  Result visible width: ${visibleWidth(result1)}`);
console.log(`  Exceeds 40? ${visibleWidth(result1) > 40}`);

// Test case 2: Tabs (each width 3)
const tabLine = "a\tb\tc".repeat(20); // lots of width
const input2 = "   " + tabLine;
const result2 = truncateToWidth(input2, 40);
console.log("\nTest 2 (Tabs):");
console.log(`  Input visible width: ${visibleWidth(input2)}`);
console.log(`  Result: "${result2}"`);
console.log(`  Result visible width: ${visibleWidth(result2)}`);
console.log(`  Exceeds 40? ${visibleWidth(result2) > 40}`);

// Test case 3: Mixed with ANSI codes
const ansiLine = "\x1b[2m" + "中a".repeat(25) + "\x1b[0m"; // dim, then style toggle
const input3 = "   " + ansiLine;
const result3 = truncateToWidth(input3, 40);
console.log("\nTest 3 (ANSI + CJK):");
console.log(`  Input visible width: ${visibleWidth(input3)}`);
console.log(`  Result visible width: ${visibleWidth(result3)}`);
console.log(`  Exceeds 40? ${visibleWidth(result3) > 40}`);
