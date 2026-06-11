import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// Recreate the exact scenario from the claim:
// "Lines 153-154, 178-180: While result lines are truncated via 
// `truncateToWidth("   " + t.dim(line), width)` on line 179,
// each result line from `b.result.split("\n")` is not pre-validated.
// If a single result line contains embedded tabs or wide CJK characters,
// the visible width computation during construction of the indent string
// could cause the final truncated result to be at the boundary."

function dimmed(str) {
  return "\x1b[2m" + str + "\x1b[0m";
}

function simulate(resultLine, width) {
  const truncated = truncateToWidth("   " + dimmed(resultLine), width);
  const padding = " ".repeat(Math.max(0, width - visibleWidth(truncated)));
  const final = truncated + padding;
  return {
    truncatedWidth: visibleWidth(truncated),
    finalWidth: visibleWidth(final),
    exceeds: visibleWidth(final) > width
  };
}

// Test the specific case: "embedded tabs or wide CJK characters"
const tests = [
  { name: "CJK - each 2 width", line: "中".repeat(60) },
  { name: "Tabs - each 3 width", line: "a\t" + "b\t".repeat(50) },
  { name: "Mixed CJK + tabs", line: "中a\t".repeat(30) },
  { name: "Very long with special chars", line: "中文" + "\ta" * 50 },
];

for (const test of tests) {
  const result = simulate(test.line, 40);
  console.log(`${test.name}:`);
  console.log(`  Result:`, result);
  console.log(`  Status: ${result.exceeds ? "EXCEEDS (BUG!)":"OK"}`);
  console.log();
}
