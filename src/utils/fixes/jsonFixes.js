/**
 * @fileoverview JSON Fixes
 * @description Pre-processing fixes for JSON content including comment removal,
 * trailing comma fixes, quote normalization, and structural repairs.
 * These run before Prettier formatting to handle common JSON5/relaxed JSON patterns.
 */

// ============================================================================
// MAIN EXPORT
// ============================================================================

/**
 * Applies fixes to JSON content before formatting.
 * Handles common JSON issues like comments, trailing commas, and missing brackets.
 *
 * @param {string} code - The JSON content to process
 * @returns {{ processed: string, fixes: string[] }} Processed JSON and list of applied fixes
 */
export function applyJsonFixes(code) {
  let processed = code;
  const fixes = [];

  if (!processed || processed.trim() === '') {
    return { processed, fixes };
  }

  // Normalize line endings (Windows CRLF to Unix LF)
  if (processed.includes('\r\n')) {
    processed = processed.replace(/\r\n/g, '\n');
    fixes.push('Normalized line endings to LF');
  }

  // Remove trailing whitespace from each line
  const trailingCount = (processed.match(/[ \t]+$/gm) || []).length;
  if (trailingCount > 0) {
    processed = processed.replace(/[ \t]+$/gm, '');
    fixes.push(`Removed trailing whitespace from ${trailingCount} lines`);
  }

  // Remove single-line comments (// ...) - not valid in JSON
  const singleLineComments = processed.match(/\/\/[^\n]*/g);
  if (singleLineComments && singleLineComments.length > 0) {
    processed = removeSingleLineComments(processed);
    fixes.push(`Removed ${singleLineComments.length} single-line comment(s)`);
  }

  // Remove multi-line comments (/* ... */) - not valid in JSON
  const multiLineComments = processed.match(/\/\*[\s\S]*?\*\//g);
  if (multiLineComments && multiLineComments.length > 0) {
    processed = processed.replace(/\/\*[\s\S]*?\*\//g, '');
    fixes.push(`Removed ${multiLineComments.length} multi-line comment(s)`);
  }

  // Remove trailing commas before ] or } - not valid in JSON
  const trailingCommasBefore = processed;
  processed = removeTrailingCommas(processed);
  if (processed !== trailingCommasBefore) {
    fixes.push('Removed trailing commas');
  }

  // Convert single quotes to double quotes (JSON requires double quotes)
  const singleQuotesBefore = processed;
  processed = convertSingleToDoubleQuotes(processed);
  if (processed !== singleQuotesBefore) {
    fixes.push('Converted single quotes to double quotes');
  }

  // Quote unquoted keys (JavaScript-style object keys)
  const unquotedKeysBefore = processed;
  processed = quoteUnquotedKeys(processed);
  if (processed !== unquotedKeysBefore) {
    fixes.push('Added quotes to unquoted keys');
  }

  // Fix multiple consecutive commas (,, becomes ,)
  const multipleCommasBefore = processed;
  processed = processed.replace(/,(\s*,)+/g, ',');
  if (processed !== multipleCommasBefore) {
    fixes.push('Fixed multiple consecutive commas');
  }

  // Reduce excessive blank lines (3+ to 2)
  const emptyLinesBefore = processed;
  processed = processed.replace(/\n{3,}/g, '\n\n');
  if (processed !== emptyLinesBefore) {
    fixes.push('Reduced excessive blank lines');
  }

  // Fix missing closing braces/brackets (structural repair)
  const structuralBefore = processed;
  const structuralResult = fixMissingClosingBrackets(processed);
  processed = structuralResult.code;
  if (processed !== structuralBefore) {
    fixes.push(...structuralResult.fixes);
  }

  return { processed, fixes };
}

// ============================================================================
// STRUCTURAL REPAIR
// ============================================================================

/**
 * Fixes missing closing braces and brackets by analyzing structure.
 * Tracks opening brackets and adds missing closers at the end.
 *
 * @param {string} code - JSON content
 * @returns {{ code: string, fixes: string[] }} Fixed code and fix messages
 */
function fixMissingClosingBrackets(code) {
  const fixes = [];
  const stack = [];
  let inString = false;
  let escaped = false;

  // Analyze structure and track unmatched opening brackets
  for (let i = 0; i < code.length; i++) {
    const char = code[i];

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
      stack.push({ char, pos: i });
    } else if (char === '}') {
      if (stack.length > 0 && stack[stack.length - 1].char === '{') {
        stack.pop();
      }
    } else if (char === ']') {
      if (stack.length > 0 && stack[stack.length - 1].char === '[') {
        stack.pop();
      }
    }
  }

  // Structure is balanced - no fixes needed
  if (stack.length === 0) {
    return { code, fixes };
  }

  // Add missing closers in reverse order (LIFO)
  let result = code.trimEnd();
  const missingBraces = stack.filter(s => s.char === '{').length;
  const missingBrackets = stack.filter(s => s.char === '[').length;

  for (let i = stack.length - 1; i >= 0; i--) {
    const opener = stack[i];
    const closer = opener.char === '{' ? '}' : ']';
    result += '\n' + closer;
  }

  if (missingBraces > 0) {
    fixes.push(`Added ${missingBraces} missing closing brace(s) '}'`);
  }
  if (missingBrackets > 0) {
    fixes.push(`Added ${missingBrackets} missing closing bracket(s) ']'`);
  }

  return { code: result, fixes };
}

// ============================================================================
// COMMENT REMOVAL
// ============================================================================

/**
 * Removes single-line comments while preserving strings.
 * Comments inside strings are not removed.
 *
 * @param {string} code - JSON content
 * @returns {string} Code without single-line comments
 */
function removeSingleLineComments(code) {
  let result = '';
  let inString = false;
  let escaped = false;
  let i = 0;

  while (i < code.length) {
    const char = code[i];
    const nextChar = code[i + 1];

    if (escaped) {
      result += char;
      escaped = false;
      i++;
      continue;
    }

    if (char === '\\' && inString) {
      result += char;
      escaped = true;
      i++;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      i++;
      continue;
    }

    // Found comment start outside of string - skip to end of line
    if (!inString && char === '/' && nextChar === '/') {
      while (i < code.length && code[i] !== '\n') {
        i++;
      }
      continue;
    }

    result += char;
    i++;
  }

  return result;
}

// ============================================================================
// COMMA HANDLING
// ============================================================================

/**
 * Removes trailing commas before ] or }.
 * Trailing commas are not valid in JSON.
 *
 * @param {string} code - JSON content
 * @returns {string} Code without trailing commas
 */
function removeTrailingCommas(code) {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < code.length; i++) {
    const char = code[i];

    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === '\\' && inString) {
      escaped = true;
      result += char;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }

    if (inString) {
      result += char;
      continue;
    }

    // Check if comma is followed by closing bracket (skip whitespace)
    if (char === ',') {
      let j = i + 1;
      while (j < code.length && /\s/.test(code[j])) {
        j++;
      }
      if (code[j] === ']' || code[j] === '}') {
        continue; // Skip this trailing comma
      }
    }

    result += char;
  }

  return result;
}

// ============================================================================
// QUOTE HANDLING
// ============================================================================

/**
 * Converts single quotes to double quotes.
 * Handles strings only, escapes existing double quotes inside converted strings.
 *
 * @param {string} code - JSON content
 * @returns {string} Code with double quotes
 */
function convertSingleToDoubleQuotes(code) {
  let result = '';
  let inDoubleString = false;
  let inSingleString = false;
  let escaped = false;

  for (let i = 0; i < code.length; i++) {
    const char = code[i];

    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      result += char;
      continue;
    }

    if (char === '"' && !inSingleString) {
      inDoubleString = !inDoubleString;
      result += char;
      continue;
    }

    if (char === "'" && !inDoubleString) {
      inSingleString = !inSingleString;
      result += '"'; // Convert to double quote
      continue;
    }

    // Escape double quotes inside single-quoted strings being converted
    if (inSingleString && char === '"') {
      result += '\\"';
      continue;
    }

    result += char;
  }

  return result;
}

// ============================================================================
// KEY HANDLING
// ============================================================================

/**
 * Adds quotes to unquoted keys (JavaScript-style object keys).
 * Only processes keys outside of strings.
 *
 * @param {string} code - JSON content
 * @returns {string} Code with quoted keys
 */
function quoteUnquotedKeys(code) {
  let result = '';
  let inString = false;
  let escaped = false;
  let i = 0;

  while (i < code.length) {
    const char = code[i];

    if (escaped) {
      result += char;
      escaped = false;
      i++;
      continue;
    }

    if (char === '\\' && inString) {
      escaped = true;
      result += char;
      i++;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      i++;
      continue;
    }

    if (inString) {
      result += char;
      i++;
      continue;
    }

    // After { or , look for unquoted keys
    if ((char === '{' || char === ',') && i < code.length - 1) {
      result += char;
      i++;

      // Skip whitespace
      let whitespace = '';
      while (i < code.length && /\s/.test(code[i])) {
        whitespace += code[i];
        i++;
      }
      result += whitespace;

      // Check for unquoted key (starts with letter, _, or $)
      if (i < code.length && /[a-zA-Z_$]/.test(code[i])) {
        let key = '';
        while (i < code.length && /[a-zA-Z0-9_$]/.test(code[i])) {
          key += code[i];
          i++;
        }

        // Skip whitespace after key
        let afterKey = '';
        while (i < code.length && /\s/.test(code[i])) {
          afterKey += code[i];
          i++;
        }

        // If followed by colon, it's a key that needs quoting
        if (i < code.length && code[i] === ':') {
          result += '"' + key + '"' + afterKey;
        } else {
          result += key + afterKey;
        }
      }
      continue;
    }

    result += char;
    i++;
  }

  return result;
}

export default applyJsonFixes;
