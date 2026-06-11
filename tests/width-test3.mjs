import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// Simulate ToolCallView rendering logic with dimmed text
function dimText(text) {
  return "\x1b[2m" + text + "\x1b[0m";
}

function barLine(line, width) {
  const currentWidth = visibleWidth(line);
  const padding = " ".repeat(Math.max(0, width - currentWidth));
  const padded = line + padding;
  return padded;
}

// Simulate line 179: truncateToWidth(`   ${t.dim(line)}`, width)
function testToolResultLine(resultLine, width) {
  const dimmedLine = dimText(resultLine);
  const prefixedLine = "   " + dimmedLine;
  const truncated = truncateToWidth(prefixedLine, width);
  const padded = barLine(truncated, width);
  
  return {
    resultLine,
    width,
    truncatedWidth: visibleWidth(truncated),
    paddedWidth: visibleWidth(padded),
    exceeds: visibleWidth(padded) > width
  };
}

// Test pathological cases
console.log("Test 1: Long line with CJK");
console.log(testToolResultLine("中文".repeat(50), 40));

console.log("\nTest 2: Line with tabs");
console.log(testToolResultLine("a\tb\tc\td\te".repeat(10), 40));

console.log("\nTest 3: Mixed CJK and ASCII with tabs");
console.log(testToolResultLine("中a\t文b".repeat(20), 40));

console.log("\nTest 4: Very narrow width");
console.log(testToolResultLine("中文a".repeat(20), 10));

console.log("\nTest 5: Width exactly at boundary");
console.log(testToolResultLine("中文" + "a".repeat(34), 40));
