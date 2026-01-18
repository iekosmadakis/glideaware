/**
 * @fileoverview Fuzzy Matcher for ServiceNow API Corrections
 * @description Uses Damerau-Levenshtein edit distance with context-aware dictionaries
 * to detect and correct typos in ServiceNow API method/class names.
 *
 * Features:
 * - Damerau-Levenshtein distance (handles transpositions)
 * - Context-aware matching (type inference)
 * - Confidence tiers for different correction behaviors
 * - Guardrails to prevent false positives
 */

import {
  CLASS_NAMES,
  GLOBAL_OBJECTS,
  CONTEXT_METHOD_MAP,
  ALL_METHODS,
} from './servicenowDictionary.js';

// =============================================================================
// CONFIGURATION
// =============================================================================
const CONFIG = {
  // Maximum edit distance for auto-correction
  maxEditDistance: 2,
  
  // Minimum similarity score for consideration
  minSimilarity: 0.70,
  
  // Minimum margin between best and second-best match
  minMargin: 0.08,
  
  // Confidence thresholds (adjusted to handle short method names like 'info')
  confidenceThresholds: {
    high: { maxDistance: 1, minSimilarity: 0.85 },    // Auto-fix silently
    medium: { maxDistance: 2, minSimilarity: 0.75 },  // Auto-fix with note
    low: { maxDistance: 2, minSimilarity: 0.65 },     // Suggest only (warning)
  },
};

// =============================================================================
// DAMERAU-LEVENSHTEIN EDIT DISTANCE
// =============================================================================

/**
 * Calculates the Damerau-Levenshtein distance between two strings.
 * This algorithm handles insertions, deletions, substitutions, AND transpositions.
 * 
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Edit distance
 */
export function damerauLevenshteinDistance(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  
  const lenA = a.length;
  const lenB = b.length;
  
  // Create distance matrix
  const d = Array(lenA + 1).fill(null).map(() => Array(lenB + 1).fill(0));
  
  // Initialize first column and row
  for (let i = 0; i <= lenA; i++) d[i][0] = i;
  for (let j = 0; j <= lenB; j++) d[0][j] = j;
  
  // Fill in the rest
  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      
      d[i][j] = Math.min(
        d[i - 1][j] + 1,      // Deletion
        d[i][j - 1] + 1,      // Insertion
        d[i - 1][j - 1] + cost // Substitution
      );
      
      // Transposition
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
      }
    }
  }
  
  return d[lenA][lenB];
}

/**
 * Calculates similarity score between two strings (0 to 1).
 * Based on normalized edit distance.
 * 
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Similarity score (0 = completely different, 1 = identical)
 */
export function similarityScore(a, b) {
  if (a === b) return 1;
  const distance = damerauLevenshteinDistance(a.toLowerCase(), b.toLowerCase());
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - (distance / maxLen);
}

// =============================================================================
// TYPE INFERENCE
// =============================================================================

/**
 * Infers variable types from code using regex-based analysis.
 * Tracks: var x = new ClassName(...) patterns.
 * 
 * @param {string} code - The code to analyze
 * @returns {Map<string, string>} Map of variable names to their inferred types
 */
export function inferVariableTypes(code) {
  const typeMap = new Map();
  
  // Pattern: var/let/const varName = new ClassName(
  const newPattern = /(?:var|let|const)\s+(\w+)\s*=\s*new\s+(\w+)\s*\(/g;
  let match;
  
  while ((match = newPattern.exec(code)) !== null) {
    const [, varName, className] = match;
    // Only track known ServiceNow classes
    if (CLASS_NAMES.includes(className)) {
      typeMap.set(varName, className);
    }
  }
  
  // Also handle gs.getUser() patterns
  const getUserPattern = /(?:var|let|const)\s+(\w+)\s*=\s*gs\.getUser\s*\(/g;
  while ((match = getUserPattern.exec(code)) !== null) {
    typeMap.set(match[1], 'GlideUser');
  }
  
  // Handle gs.getSession() patterns
  const getSessionPattern = /(?:var|let|const)\s+(\w+)\s*=\s*gs\.getSession\s*\(/g;
  while ((match = getSessionPattern.exec(code)) !== null) {
    typeMap.set(match[1], 'GlideSession');
  }
  
  return typeMap;
}

/**
 * Gets the type/context for a given receiver (the object before the dot).
 * 
 * @param {string} receiver - The receiver name (e.g., 'gr', 'gs', 'g_form')
 * @param {Map<string, string>} typeMap - Inferred type map from the code
 * @returns {string|null} The inferred type or null if unknown
 */
export function getReceiverType(receiver, typeMap) {
  // Check hardcoded globals first
  if (CONTEXT_METHOD_MAP[receiver]) {
    return receiver;
  }
  
  // Check inferred types
  if (typeMap.has(receiver)) {
    return typeMap.get(receiver);
  }
  
  return null;
}

// =============================================================================
// FUZZY MATCHING
// =============================================================================

/**
 * Result of a fuzzy match operation.
 * @typedef {Object} FuzzyMatchResult
 * @property {string|null} match - The best matching valid name, or null if no match
 * @property {number} distance - Edit distance to the best match
 * @property {number} similarity - Similarity score (0-1)
 * @property {number} margin - Margin between best and second-best match
 * @property {'high'|'medium'|'low'|null} confidence - Confidence level
 * @property {boolean} shouldAutoFix - Whether to auto-fix (true) or just warn (false)
 */

/**
 * Finds the best fuzzy match for an identifier in a dictionary.
 * 
 * @param {string} identifier - The identifier to match (possibly misspelled)
 * @param {string[]} dictionary - Array of valid names to match against
 * @returns {FuzzyMatchResult}
 */
export function findBestMatch(identifier, dictionary) {
  // If already valid, no correction needed
  if (dictionary.includes(identifier)) {
    return {
      match: identifier,
      distance: 0,
      similarity: 1,
      margin: 1,
      confidence: null,
      shouldAutoFix: false,
    };
  }
  
  let bestMatch = null;
  let bestDistance = Infinity;
  let bestSimilarity = 0;
  let secondBestSimilarity = 0;
  
  const identifierLower = identifier.toLowerCase();
  
  for (const validName of dictionary) {
    const validNameLower = validName.toLowerCase();
    
    // Quick skip: if length difference is too large, skip
    if (Math.abs(identifier.length - validName.length) > CONFIG.maxEditDistance) {
      continue;
    }
    
    const distance = damerauLevenshteinDistance(identifierLower, validNameLower);
    const similarity = 1 - (distance / Math.max(identifier.length, validName.length));
    
    if (similarity > bestSimilarity) {
      secondBestSimilarity = bestSimilarity;
      bestSimilarity = similarity;
      bestDistance = distance;
      bestMatch = validName;
    } else if (similarity > secondBestSimilarity) {
      secondBestSimilarity = similarity;
    }
  }
  
  const margin = bestSimilarity - secondBestSimilarity;
  
  // Determine confidence level
  let confidence = null;
  let shouldAutoFix = false;
  
  if (bestMatch && bestDistance <= CONFIG.maxEditDistance && bestSimilarity >= CONFIG.minSimilarity) {
    if (margin >= CONFIG.minMargin) {
      const { high, medium, low } = CONFIG.confidenceThresholds;
      
      if (bestDistance <= high.maxDistance && bestSimilarity >= high.minSimilarity) {
        confidence = 'high';
        shouldAutoFix = true;
      } else if (bestDistance <= medium.maxDistance && bestSimilarity >= medium.minSimilarity) {
        confidence = 'medium';
        shouldAutoFix = true;
      } else if (bestDistance <= low.maxDistance && bestSimilarity >= low.minSimilarity) {
        confidence = 'low';
        shouldAutoFix = false; // Only suggest, don't auto-fix
      }
    }
  }
  
  return {
    match: confidence ? bestMatch : null,
    distance: bestDistance,
    similarity: bestSimilarity,
    margin,
    confidence,
    shouldAutoFix,
  };
}

/**
 * Finds the best fuzzy match for a class name.
 * 
 * @param {string} className - The class name to match
 * @returns {FuzzyMatchResult}
 */
export function findBestClassMatch(className) {
  return findBestMatch(className, CLASS_NAMES);
}

/**
 * Finds the best fuzzy match for a method name, optionally scoped by type.
 * 
 * @param {string} methodName - The method name to match
 * @param {string|null} contextType - The type context (e.g., 'GlideRecord', 'gs')
 * @returns {FuzzyMatchResult}
 */
export function findBestMethodMatch(methodName, contextType = null) {
  // Use context-specific dictionary if available
  const dictionary = contextType && CONTEXT_METHOD_MAP[contextType]
    ? CONTEXT_METHOD_MAP[contextType]
    : ALL_METHODS;
  
  return findBestMatch(methodName, dictionary);
}

// =============================================================================
// CODE CORRECTION
// =============================================================================

/**
 * A correction to be applied to the code.
 * @typedef {Object} Correction
 * @property {string} original - Original (misspelled) text
 * @property {string} corrected - Corrected text
 * @property {number} startIndex - Start position in the code
 * @property {number} endIndex - End position in the code
 * @property {'high'|'medium'|'low'} confidence - Confidence level
 * @property {'class'|'method'} type - Type of correction
 * @property {string|null} context - Context/type if available
 */

/**
 * Analyzes code and finds all potential corrections.
 * 
 * @param {string} code - The code to analyze
 * @returns {{ corrections: Correction[], suggestions: Correction[] }}
 */
export function analyzeCode(code) {
  const corrections = [];  // High/medium confidence - will be auto-fixed
  const suggestions = [];  // Low confidence - will only be suggested as warnings
  
  // Infer variable types
  const typeMap = inferVariableTypes(code);
  
  // Pattern for class instantiation: new ClassName(
  const classPattern = /\bnew\s+([A-Z]\w*)\s*\(/g;
  let match;
  
  while ((match = classPattern.exec(code)) !== null) {
    const [fullMatch, className] = match;
    
    // Skip if already valid
    if (CLASS_NAMES.includes(className)) continue;
    
    const result = findBestClassMatch(className);
    
    if (result.match && result.confidence) {
      const correction = {
        original: className,
        corrected: result.match,
        startIndex: match.index + fullMatch.indexOf(className),
        endIndex: match.index + fullMatch.indexOf(className) + className.length,
        confidence: result.confidence,
        type: 'class',
        context: null,
        distance: result.distance,
        similarity: result.similarity,
      };
      
      if (result.shouldAutoFix) {
        corrections.push(correction);
      } else {
        suggestions.push(correction);
      }
    }
  }
  
  // Pattern for method calls: .methodName(
  // Match: receiver.method( where receiver is a word
  const methodPattern = /(\b\w+)\.(\w+)\s*\(/g;
  
  while ((match = methodPattern.exec(code)) !== null) {
    const [, receiver, methodName] = match;
    
    // Get the context type for this receiver
    const contextType = getReceiverType(receiver, typeMap);
    
    // Get the appropriate dictionary
    const dictionary = contextType && CONTEXT_METHOD_MAP[contextType]
      ? CONTEXT_METHOD_MAP[contextType]
      : ALL_METHODS;
    
    // Skip if already valid
    if (dictionary.includes(methodName)) continue;
    
    const result = findBestMethodMatch(methodName, contextType);
    
    if (result.match && result.confidence) {
      const methodStartIndex = match.index + receiver.length + 1; // +1 for the dot
      
      const correction = {
        original: methodName,
        corrected: result.match,
        startIndex: methodStartIndex,
        endIndex: methodStartIndex + methodName.length,
        confidence: result.confidence,
        type: 'method',
        context: contextType,
        distance: result.distance,
        similarity: result.similarity,
      };
      
      if (result.shouldAutoFix) {
        corrections.push(correction);
      } else {
        suggestions.push(correction);
      }
    }
  }
  
  // Sort by position (descending) so we can apply fixes from end to start
  corrections.sort((a, b) => b.startIndex - a.startIndex);
  suggestions.sort((a, b) => b.startIndex - a.startIndex);
  
  return { corrections, suggestions };
}

/**
 * Applies corrections to code.
 * 
 * @param {string} code - Original code
 * @param {Correction[]} corrections - Corrections to apply
 * @returns {string} Corrected code
 */
export function applyCorrections(code, corrections) {
  let result = code;
  
  // Apply from end to start to preserve indices
  for (const correction of corrections) {
    result = result.slice(0, correction.startIndex) 
           + correction.corrected 
           + result.slice(correction.endIndex);
  }
  
  return result;
}

/**
 * Main entry point: analyze and correct code with fuzzy matching.
 * 
 * @param {string} code - The code to process
 * @returns {{ processed: string, fixes: string[], suggestions: string[] }}
 */
export function fuzzyCorrectCode(code) {
  const { corrections, suggestions } = analyzeCode(code);
  
  // Apply auto-fixes
  const processed = applyCorrections(code, corrections);
  
  // Generate fix messages
  const fixes = [];
  const suggestionMessages = [];
  
  // Group corrections by confidence
  const highConfidence = corrections.filter(c => c.confidence === 'high');
  const mediumConfidence = corrections.filter(c => c.confidence === 'medium');
  
  // High confidence fixes (silent)
  if (highConfidence.length > 0) {
    const uniqueFixes = [...new Set(highConfidence.map(c => `${c.original} → ${c.corrected}`))];
    fixes.push(`Fixed ${highConfidence.length} typo(s): ${uniqueFixes.join(', ')}`);
  }
  
  // Medium confidence fixes (with note)
  if (mediumConfidence.length > 0) {
    const uniqueFixes = [...new Set(mediumConfidence.map(c => `${c.original} → ${c.corrected}`))];
    fixes.push(`Auto-corrected ${mediumConfidence.length} likely typo(s): ${uniqueFixes.join(', ')}`);
  }
  
  // Low confidence suggestions (warnings only)
  for (const suggestion of suggestions) {
    suggestionMessages.push(
      `Possible typo: "${suggestion.original}" - did you mean "${suggestion.corrected}"?`
    );
  }
  
  return {
    processed,
    fixes,
    suggestions: suggestionMessages,
  };
}

// =============================================================================
// EXPORTS
// =============================================================================
export default {
  damerauLevenshteinDistance,
  similarityScore,
  inferVariableTypes,
  findBestMatch,
  findBestClassMatch,
  findBestMethodMatch,
  analyzeCode,
  applyCorrections,
  fuzzyCorrectCode,
  CONFIG,
};
