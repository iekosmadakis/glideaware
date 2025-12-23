/**
 * JSON Warnings
 * 
 * Analyzes JSON content for common issues, structural problems,
 * and best practice violations.
 */

/**
 * Analyzes JSON for warnings and errors
 * @param {string} code - The JSON content to analyze
 * @returns {{ warnings: string[], errors: string[] }}
 */
export function analyzeJsonWarnings(code) {
  const warnings = [];
  const errors = [];

  if (!code || code.trim() === '') {
    return { warnings, errors };
  }

  // Check for syntax errors by attempting to parse
  try {
    JSON.parse(code);
  } catch (e) {
    const match = e.message.match(/position (\d+)/i);
    if (match) {
      const position = parseInt(match[1]);
      const lines = code.substring(0, position).split('\n');
      const line = lines.length;
      const col = lines[lines.length - 1].length + 1;
      errors.push(`Syntax error at line ${line}, column ${col}: ${e.message}`);
    } else {
      errors.push(`JSON syntax error: ${e.message}`);
    }
    return { warnings, errors };
  }

  // Check for trailing commas (not valid in JSON)
  const trailingCommaPattern = /,\s*[\]}]/g;
  const trailingCommas = code.match(trailingCommaPattern);
  if (trailingCommas) {
    errors.push(`Found ${trailingCommas.length} trailing comma(s) - not valid in JSON`);
  }

  // Check for single quotes (JSON requires double quotes)
  const singleQuotePattern = /'[^']*'/g;
  const inString = [];
  let inStringContext = false;
  let escaped = false;
  for (let i = 0; i < code.length; i++) {
    const char = code[i];
    if (char === '\\' && inStringContext) {
      escaped = !escaped;
      continue;
    }
    if (char === '"' && !escaped) {
      inStringContext = !inStringContext;
    }
    if (char === "'" && !inStringContext) {
      inString.push(i);
    }
    escaped = false;
  }
  if (inString.length > 0) {
    errors.push('Single quotes found - JSON requires double quotes');
  }

  // Check for comments (not valid in JSON)
  const singleLineComments = code.match(/\/\/[^\n]*/g);
  const multiLineComments = code.match(/\/\*[\s\S]*?\*\//g);
  const commentCount = (singleLineComments?.length || 0) + (multiLineComments?.length || 0);
  if (commentCount > 0) {
    errors.push(`Found ${commentCount} comment(s) - comments are not valid in JSON`);
  }

  // Check for duplicate keys (requires parsing)
  const duplicateKeys = findDuplicateKeys(code);
  if (duplicateKeys.length > 0) {
    duplicateKeys.forEach(key => {
      warnings.push(`Duplicate key "${key}" found - later value will override`);
    });
  }

  // Check for very deep nesting (10+ levels)
  const maxDepth = calculateMaxDepth(code);
  if (maxDepth > 10) {
    warnings.push(`Deep nesting detected (${maxDepth} levels) - consider flattening structure`);
  }

  // Check for very long strings (1000+ chars)
  const longStringPattern = /"[^"]{1000,}"/g;
  const longStrings = code.match(longStringPattern);
  if (longStrings) {
    warnings.push(`${longStrings.length} very long string(s) detected (1000+ chars)`);
  }

  // Check for empty arrays or objects that might be unintentional
  const emptyArrays = (code.match(/\[\s*\]/g) || []).length;
  const emptyObjects = (code.match(/\{\s*\}/g) || []).length;
  if (emptyArrays + emptyObjects > 5) {
    warnings.push(`Multiple empty arrays/objects (${emptyArrays + emptyObjects}) - verify intentional`);
  }

  // Check for null values
  const nullValues = (code.match(/:\s*null\b/g) || []).length;
  if (nullValues > 10) {
    warnings.push(`Many null values (${nullValues}) - consider omitting null fields`);
  }

  // Check for numeric keys (valid but often unintentional)
  const numericKeyPattern = /"(\d+)"\s*:/g;
  const numericKeys = code.match(numericKeyPattern);
  if (numericKeys && numericKeys.length > 3) {
    warnings.push(`${numericKeys.length} numeric keys found - consider using an array instead`);
  }

  // Large file warning
  const lineCount = code.split('\n').length;
  if (lineCount > 1000) {
    warnings.push(`Large JSON file (${lineCount} lines) - may impact performance`);
  }

  // Check for unescaped special characters in strings
  const unescapedPattern = /[\x00-\x1f]/;
  if (unescapedPattern.test(code)) {
    warnings.push('Unescaped control characters detected - may cause parsing issues');
  }

  return { warnings, errors };
}

/**
 * Find duplicate keys in JSON (walks through manually to detect)
 * @param {string} code - JSON string
 * @returns {string[]} Array of duplicate key names
 */
function findDuplicateKeys(code) {
  const duplicates = [];
  const keysByLevel = {};
  let depth = 0;

  // Track brace depth as we scan
  for (let i = 0; i < code.length; i++) {
    const char = code[i];
    
    if (char === '{') {
      depth++;
      keysByLevel[depth] = new Set();
    } else if (char === '}') {
      delete keysByLevel[depth];
      depth--;
    }
  }

  // Reset and do a proper scan
  depth = 0;
  const levelKeys = {};
  let inString = false;
  let escaped = false;
  let currentKey = '';
  let collectingKey = false;
  let afterColon = false;

  for (let i = 0; i < code.length; i++) {
    const char = code[i];

    if (escaped) {
      if (collectingKey) currentKey += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      if (collectingKey) currentKey += char;
      continue;
    }

    if (char === '"') {
      if (!inString) {
        inString = true;
        if (!afterColon) {
          collectingKey = true;
          currentKey = '';
        }
      } else {
        inString = false;
        if (collectingKey) {
          collectingKey = false;
          // Check for duplicate at current level
          if (!levelKeys[depth]) levelKeys[depth] = new Set();
          if (levelKeys[depth].has(currentKey)) {
            if (!duplicates.includes(currentKey)) {
              duplicates.push(currentKey);
            }
          }
          levelKeys[depth].add(currentKey);
        }
      }
      continue;
    }

    if (inString) {
      if (collectingKey) currentKey += char;
      continue;
    }

    if (char === ':') {
      afterColon = true;
    } else if (char === ',' || char === '{' || char === '[') {
      afterColon = false;
    }

    if (char === '{') {
      depth++;
      levelKeys[depth] = new Set();
    } else if (char === '}') {
      delete levelKeys[depth];
      depth--;
    }
  }

  return duplicates;
}

/**
 * Calculate maximum nesting depth
 * @param {string} code - JSON string
 * @returns {number} Maximum depth
 */
function calculateMaxDepth(code) {
  let maxDepth = 0;
  let currentDepth = 0;
  let inString = false;
  let escaped = false;

  for (const char of code) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{' || char === '[') {
      currentDepth++;
      maxDepth = Math.max(maxDepth, currentDepth);
    } else if (char === '}' || char === ']') {
      currentDepth--;
    }
  }

  return maxDepth;
}

export default analyzeJsonWarnings;
