import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

function dimText(text) {
  return "\x1b[2m" + text + "\x1b[0m";
}

function barLine(line, width) {
  const currentWidth = visibleWidth(line);
  const padding = " ".repeat(Math.max(0, width - currentWidth));
  return line + padding;
}

function toolCallViewLine(resultLine, width) {
  const dimmedLine = dimText(resultLine);
  const prefixedLine = "   " + dimmedLine;
  const truncated = truncateToWidth(prefixedLine, width);
  const padded = barLine(truncated, width);
  return visibleWidth(padded);
}

// Test many widths and input combinations
let failures = [];
for (let width = 5; width <= 200; width += 5) {
  // Test various pathological inputs
  const tests = [
    "a".repeat(width + 100),
    "中".repeat(width + 100),
    "中a".repeat(width + 50),
    "a\tb".repeat(width + 50),
    "中\t文\ta".repeat(width + 50),
    "🔥😀🎉🌟".repeat(width + 20), // emoji
  ];
  
  for (const test of tests) {
    const result = toolCallViewLine(test, width);
    if (result > width) {
      failures.push({
        width,
        input: test.substring(0, 50),
        result,
        exceeds: result - width
      });
    }
  }
}

if (failures.length === 0) {
  console.log("✓ All tests passed! No line exceeded its width constraint.");
} else {
  console.log(`✗ Found ${failures.length} failures:`);
  for (const f of failures.slice(0, 10)) {
    console.log(f);
  }
}
