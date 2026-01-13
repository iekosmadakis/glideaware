/**
 * @fileoverview Generic JavaScript Fixes
 * @description Pre-processing fixes that apply to any JavaScript code,
 * not specific to ServiceNow. These run before Prettier formatting.
 */

/**
 * Applies generic pre-processing fixes before Prettier formatting.
 *
 * @param {string} code - The code to process
 * @returns {{ processed: string, fixes: string[] }} Processed code and list of applied fixes
 */
export function applyGenericFixes(code) {
  let processed = code;
  const fixes = [];

  // Normalize line endings (Windows CRLF to Unix LF)
  if (processed.includes('\r\n')) {
    processed = processed.replace(/\r\n/g, '\n');
    fixes.push('Normalized line endings to LF');
  }

  // Remove trailing whitespace from lines
  const trailingWhitespaceCount = (processed.match(/[ \t]+$/gm) || []).length;
  if (trailingWhitespaceCount > 0) {
    processed = processed.replace(/[ \t]+$/gm, '');
    fixes.push(`Removed trailing whitespace from ${trailingWhitespaceCount} lines`);
  }

  // Fix multiple semicolons (;;; or more becomes single ;)
  const multipleSemiCount = (processed.match(/;{2,}/g) || []).length;
  if (multipleSemiCount > 0) {
    processed = processed.replace(/;{2,}/g, ';');
    fixes.push(`Fixed ${multipleSemiCount} multiple semicolons`);
  }

  // Remove empty statements (standalone semicolons on their own line)
  const emptyStatementsBefore = processed;
  processed = processed.replace(/^\s*;\s*$/gm, '');
  if (processed !== emptyStatementsBefore) {
    fixes.push('Removed empty statements');
  }

  // Ensure proper spacing after control flow keywords
  const keywordBefore = processed;
  processed = processed
    .replace(/\bif\(/g, 'if (')
    .replace(/\bfor\(/g, 'for (')
    .replace(/\bwhile\(/g, 'while (')
    .replace(/\bswitch\(/g, 'switch (')
    .replace(/\bcatch\(/g, 'catch (')
    .replace(/\btypeof\(/g, 'typeof (');
  if (processed !== keywordBefore) {
    fixes.push('Fixed spacing after keywords');
  }

  // Reduce excessive blank lines (4+ consecutive to max 2)
  const multipleBlanksBefore = processed;
  processed = processed.replace(/\n{4,}/g, '\n\n\n');
  if (processed !== multipleBlanksBefore) {
    fixes.push('Reduced excessive blank lines');
  }

  // Simplify boolean comparisons (conservative: only remove == true)
  const booleanBefore = processed;
  processed = processed.replace(/\s*===?\s*true\b/g, '');
  if (processed !== booleanBefore) {
    fixes.push('Simplified boolean comparisons (removed == true)');
  }

  return { processed, fixes };
}
