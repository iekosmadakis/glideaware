/**
 * JSON Fixes
 * 
 * Pre-processing fixes for JSON content including comment removal,
 * trailing comma fixes, quote normalization, and structural repairs.
 */

/**
 * Applies fixes to JSON content before formatting
 * @param {string} code - The JSON content to process
 * @returns {{ processed: string, fixes: string[] }}
 */
export function applyJsonFixes(code) {
  let processed = code;
  const fixes = [];

  if (!processed || processed.trim() === '') {
    return { processed, fixes };
  }

  // Normalize line endings
  if (processed.includes('\r\n')) {
    processed = processed.replace(/\r\n/g, '\n');
    fixes.push('Normalized line endings to LF');
  }

  // Remove trailing whitespace
  const trailingCount = (processed.match(/[ \t]+$/gm) || []).length;
  if (trailingCount > 0) {
    processed = processed.replace(/[ \t]+$/gm, '');
    fixes.push(`Removed trailing whitespace from ${trailingCount} lines`);
  }

  // Remove single-line comments (// ...)
  const singleLineComments = processed.match(/\/\/[^\n]*/g);
  if (singleLineComments && singleLineComments.length > 0) {
    processed = removeSingleLineComments(processed);
    fixes.push(`Removed ${singleLineComments.length} single-line comment(s)`);
  }

  // Remove multi-line comments (/* ... */)
  const multiLineComments = processed.match(/\/\*[\s\S]*?\*\//g);
  if (multiLineComments && multiLineComments.length > 0) {
    processed = processed.replace(/\/\*[\s\S]*?\*\//g, '');
    fixes.push(`Removed ${multiLineComments.length} multi-line comment(s)`);
  }

  // Fix trailing commas before ] or }
  const trailingCommasBefore = processed;
  processed = removeTrailingCommas(processed);
  if (processed !== trailingCommasBefore) {
    fixes.push('Removed trailing commas');
  }

  // Convert single quotes to double quotes (for string values and keys)
  const singleQuotesBefore = processed;
  processed = convertSingleToDoubleQuotes(processed);
  if (processed !== singleQuotesBefore) {
    fixes.push('Converted single quotes to double quotes');
  }

  // Fix unquoted keys (basic cases)
  const unquotedKeysBefore = processed;
  processed = quoteUnquotedKeys(processed);
  if (processed !== unquotedKeysBefore) {
    fixes.push('Added quotes to unquoted keys');
  }

  // Remove multiple consecutive commas
  const multipleCommasBefore = processed;
  processed = processed.replace(/,(\s*,)+/g, ',');
  if (processed !== multipleCommasBefore) {
    fixes.push('Fixed multiple consecutive commas');
  }

  // Clean up empty lines (reduce 3+ to 2)
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

/**
 * Fix missing closing braces and brackets by analyzing structure
 * @param {string} code - JSON content
 * @returns {{ code: string, fixes: string[] }}
 */
function fixMissingClosingBrackets(code) {
  const fixes = [];
  const stack = [];
  let inString = false;
  let escaped = false;

  // First pass: analyze the structure and track opening brackets
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

  // If stack is empty, structure is balanced
  if (stack.length === 0) {
    return { code, fixes };
  }

  // Build missing closers in reverse order (LIFO)
  let result = code.trimEnd();
  const missingBraces = stack.filter(s => s.char === '{').length;
  const missingBrackets = stack.filter(s => s.char === '[').length;

  // Add missing closers in reverse order
  for (let i = stack.length - 1; i >= 0; i--) {
    const opener = stack[i];
    const closer = opener.char === '{' ? '}' : ']';
    result += '\n' + closer;
  }

  // Build fix messages
  if (missingBraces > 0) {
    fixes.push(`Added ${missingBraces} missing closing brace(s) '}'`);
  }
  if (missingBrackets > 0) {
    fixes.push(`Added ${missingBrackets} missing closing bracket(s) ']'`);
  }

  return { code: result, fixes };
}

/**
 * Remove single-line comments while preserving strings
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

    if (!inString && char === '/' && nextChar === '/') {
      // Skip until end of line
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

/**
 * Remove trailing commas before ] or }
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

    if (char === ',') {
      // Look ahead for ] or } (skipping whitespace)
      let j = i + 1;
      while (j < code.length && /\s/.test(code[j])) {
        j++;
      }
      if (code[j] === ']' || code[j] === '}') {
        // Skip this comma
        continue;
      }
    }

    result += char;
  }

  return result;
}

/**
 * Convert single quotes to double quotes (handles strings only)
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
      result += '"';
      continue;
    }

    // Escape double quotes inside single-quoted strings that are being converted
    if (inSingleString && char === '"') {
      result += '\\"';
      continue;
    }

    result += char;
  }

  return result;
}

/**
 * Add quotes to unquoted keys (basic JavaScript-style object keys)
 * @param {string} code - JSON content
 * @returns {string} Code with quoted keys
 */
function quoteUnquotedKeys(code) {
  // Match unquoted keys: word characters followed by colon
  // But not inside strings
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

    // Check for unquoted key pattern: { or , followed by whitespace and word
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

      // Check for unquoted key
      if (i < code.length && /[a-zA-Z_$]/.test(code[i])) {
        let key = '';
        let keyStart = i;
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

        // Check if followed by colon (making it a key)
        if (i < code.length && code[i] === ':') {
          result += '"' + key + '"' + afterKey;
        } else {
          // Not a key, preserve as-is
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
