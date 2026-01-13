/**
 * @fileoverview ServiceNow-Specific Warnings
 * @description Analyzes code for ServiceNow anti-patterns, performance issues,
 * and best practice violations. Covers GlideRecord usage, Business Rules,
 * client scripts, and security concerns.
 */

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extracts all GlideRecord variable names from code.
 * Identifies both declaration patterns: var/let/const and direct assignment.
 *
 * @param {string} code - The code to analyze
 * @returns {string[]} Array of variable names that are GlideRecord instances
 */
function extractGlideRecordVars(code) {
  const vars = [];
  const patterns = [
    /(?:var|let|const)\s+(\w+)\s*=\s*new\s+GlideRecord\s*\(/g,
    /(\w+)\s*=\s*new\s+GlideRecord\s*\(/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      if (!vars.includes(match[1])) {
        vars.push(match[1]);
      }
    }
  }
  return vars;
}

// ============================================================================
// MAIN ANALYSIS FUNCTION
// ============================================================================

/**
 * Analyzes code for ServiceNow-specific warnings and errors.
 * Checks for performance issues, security risks, and best practice violations.
 *
 * @param {string} code - The code to analyze
 * @returns {string[] | { warnings: string[], errors: string[] }} Warnings array or object with both
 */
export function analyzeServiceNowWarnings(code) {
  const warnings = [];
  const errors = [];
  const grVars = extractGlideRecordVars(code);

  // -------------------------------------------------------------------------
  // Database & Performance Warnings
  // -------------------------------------------------------------------------

  // Check for update() inside while loop (expensive row-by-row updates)
  for (const varName of grVars) {
    const escapedVar = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const updateInLoopPattern = new RegExp(
      `while\\s*\\([^)]*${escapedVar}\\.next\\s*\\(\\s*\\)\\s*\\)[\\s\\S]*?${escapedVar}\\.update\\s*\\(`,
      'g'
    );
    if (updateInLoopPattern.test(code)) {
      warnings.push(`${varName}.update() inside while loop - each update is a separate DB call, consider batch operations`);
    }
  }

  // Check for getRowCount() without setLimit() (performance issue)
  if (/\.getRowCount\s*\(\s*\)/.test(code) && !/\.setLimit\s*\(/.test(code)) {
    warnings.push('getRowCount() without setLimit() - may cause performance issues on large tables');
  }

  // Check for deleteRecord() in while loop (use deleteMultiple instead)
  if (/while\s*\([^)]*\.next\s*\(\s*\)\s*\)[\s\S]*?\.deleteRecord\s*\(\s*\)/g.test(code)) {
    warnings.push('deleteRecord() in loop - consider deleteMultiple() for better performance');
  }

  // Check for getReference() inside loop (N+1 query problem)
  if (/while\s*\([^)]*\.next\s*\(\s*\)\s*\)[\s\S]*?\.getReference\s*\(/g.test(code) ||
      /for\s*\([^)]*\)[\s\S]*?\.getReference\s*\(/g.test(code)) {
    warnings.push('getReference() inside loop - causes N+1 queries, consider GlideRecord join or caching');
  }

  // Check for missing setLimit(1) on existence checks
  for (const varName of grVars) {
    const escapedVar = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hasIfNext = new RegExp(`if\\s*\\(\\s*${escapedVar}\\.next\\s*\\(\\s*\\)\\s*\\)`).test(code);
    const hasWhileNext = new RegExp(`while\\s*\\([^)]*${escapedVar}\\.next`).test(code);
    const hasSetLimit = new RegExp(`${escapedVar}\\.setLimit\\s*\\(`).test(code);

    if (hasIfNext && !hasWhileNext && !hasSetLimit) {
      warnings.push(`${varName}.next() in if-statement without setLimit(1) - add setLimit(1) for existence checks`);
      break;
    }
  }

  // Check for query() without any conditions (full table scan)
  for (const varName of grVars) {
    const escapedVar = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hasQuery = new RegExp(`${escapedVar}\\.query\\s*\\(`).test(code);
    const hasAddQuery = new RegExp(`${escapedVar}\\.(addQuery|addEncodedQuery|addNullQuery|addNotNullQuery|get)\\s*\\(`).test(code);

    if (hasQuery && !hasAddQuery) {
      warnings.push(`${varName}.query() without any conditions - this will scan the entire table`);
      break;
    }
  }

  // Check for updateMultiple/deleteMultiple without conditions (dangerous)
  for (const varName of grVars) {
    const escapedVar = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hasMultipleOp = new RegExp(`${escapedVar}\\.(updateMultiple|deleteMultiple)\\s*\\(`).test(code);
    const hasCondition = new RegExp(`${escapedVar}\\.(addQuery|addEncodedQuery|addNullQuery|addNotNullQuery)\\s*\\(`).test(code);

    if (hasMultipleOp && !hasCondition) {
      warnings.push(`${varName}.updateMultiple()/deleteMultiple() without conditions - will affect ALL records!`);
      break;
    }
  }

  // Check for updateMultiple() used after next() iteration (logic smell)
  for (const varName of grVars) {
    const escapedVar = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hasNext = new RegExp(`${escapedVar}\\.next\\s*\\(`).test(code);
    const hasUpdateMultiple = new RegExp(`${escapedVar}\\.updateMultiple\\s*\\(`).test(code);
    if (hasNext && hasUpdateMultiple) {
      warnings.push(`${varName} uses both next() and updateMultiple() - updateMultiple ignores per-row changes`);
      break;
    }
  }

  // Check for get() followed by query() (redundant)
  for (const varName of grVars) {
    const escapedVar = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const getPattern = new RegExp(`${escapedVar}\\.get\\s*\\([^)]+\\)[\\s\\S]*?${escapedVar}\\.query\\s*\\(`);
    if (getPattern.test(code)) {
      warnings.push(`${varName}.get() followed by query() - get() already positions the record, query() is redundant`);
      break;
    }
  }

  // -------------------------------------------------------------------------
  // Business Rule Warnings
  // -------------------------------------------------------------------------

  // Check for setAbortAction(true) without return statement
  if (/\.setAbortAction\s*\(\s*true\s*\)/.test(code)) {
    if (!/setAbortAction\s*\(\s*true\s*\)[\s\S]*?return/.test(code)) {
      warnings.push('setAbortAction(true) without return - add return false for Business Rules');
    }
  }

  // Check for direct field assignment instead of setValue()
  const directAssignments = code.match(/\bcurrent\.\w+\s*=\s*[^=]/g) || [];
  const problematicAssignments = directAssignments.filter(a =>
    !a.includes('current.update') &&
    !a.includes('current.insert') &&
    !a.includes('current.setAbortAction') &&
    !a.includes('current.setWorkflow')
  );
  if (problematicAssignments.length > 0) {
    warnings.push('Direct field assignment (current.field = value) - consider using setValue() for clarity');
  }

  // Check for current.update() in Business Rule (recursion risk)
  if (/function\s+(executeRule|onBefore|onAfter|onAsync)\s*\(\s*current/.test(code) ||
      /current\s*,\s*previous/.test(code)) {
    if (/\bcurrent\.update\s*\(/.test(code)) {
      warnings.push('current.update() in Business Rule - risks recursion, use Before BR or setWorkflow(false)');
    }
  }

  // Check for current.insert() in Business Rule (unusual pattern)
  if (/function\s+(executeRule|onBefore|onAfter)\s*\(\s*current/.test(code) ||
      /current\s*,\s*previous/.test(code)) {
    if (/\bcurrent\.insert\s*\(/.test(code)) {
      warnings.push('current.insert() in Business Rule - unusual pattern, verify this is intentional');
    }
  }

  // -------------------------------------------------------------------------
  // Security Warnings
  // -------------------------------------------------------------------------

  // Check for hardcoded sys_id values (portability issue)
  const sysIdPattern = /['"][a-f0-9]{32}['"]/gi;
  const sysIdMatches = code.match(sysIdPattern) || [];
  if (sysIdMatches.length > 0) {
    warnings.push(`${sysIdMatches.length} hardcoded sys_id(s) detected - use system properties for portability between instances`);
  }

  // Check for eval() or GlideEvaluator (security risk)
  if (/\beval\s*\(/.test(code) || /\bGlideEvaluator\b/.test(code)) {
    warnings.push('eval() or GlideEvaluator detected - potential security risk, avoid executing dynamic code');
  }

  // Check for new Function() (security risk similar to eval)
  if (/new\s+Function\s*\(/.test(code)) {
    warnings.push('new Function() detected - security risk similar to eval(), avoid dynamic code execution');
  }

  // Check for GlideRecordSecure with privileged operations (undermines security)
  if (/new\s+GlideRecordSecure\s*\(/.test(code)) {
    if (/\.setWorkflow\s*\(\s*false\s*\)/.test(code) ||
        /\.autoSysFields\s*\(\s*false\s*\)/.test(code) ||
        /\.updateMultiple\s*\(/.test(code) ||
        /\.deleteMultiple\s*\(/.test(code)) {
      warnings.push('GlideRecordSecure with privileged operation - security intent may be undermined');
    }
  }

  // -------------------------------------------------------------------------
  // Best Practice Warnings
  // -------------------------------------------------------------------------

  // Check for GlideAggregate without aggregate function
  if (/new\s+GlideAggregate\s*\(/.test(code)) {
    if (!/\.(groupBy|addAggregate|getAggregate|count)\s*\(/.test(code)) {
      warnings.push('GlideAggregate created but no aggregate function called');
    }
  }

  // Check for synchronous getXMLWait() (blocks UI)
  if (/\.getXMLWait\s*\(\s*\)/.test(code)) {
    warnings.push('getXMLWait() blocks the UI thread - consider async getXMLAnswer() with callback');
  }

  // Check for gs.sleep() (blocks thread)
  if (/\bgs\.sleep\s*\(/.test(code)) {
    warnings.push('gs.sleep() blocks the thread - avoid in production code, use scheduled jobs or events');
  }

  // Check for gs.getProperty() without default value
  const getPropertyCalls = code.match(/gs\.getProperty\s*\(\s*['"][^'"]+['"]\s*\)/g) || [];
  const getPropertyWithDefault = code.match(/gs\.getProperty\s*\(\s*['"][^'"]+['"]\s*,/g) || [];
  const propsWithoutDefault = getPropertyCalls.length - getPropertyWithDefault.length;
  if (propsWithoutDefault > 0) {
    warnings.push(`${propsWithoutDefault} gs.getProperty() call(s) without default value - consider adding a fallback`);
  }

  // Check for gs.include() (legacy pattern)
  if (/\bgs\.include\s*\(/.test(code)) {
    warnings.push('gs.include() is legacy - use Script Includes with Class.create() pattern');
  }

  // Check for g_form.getReference() without callback (async misuse)
  const getRefPattern = /g_form\.getReference\s*\(\s*['"][^'"]+['"]\s*\)/g;
  const getRefWithCallback = /g_form\.getReference\s*\(\s*['"][^'"]+['"]\s*,/g;
  const getRefCalls = (code.match(getRefPattern) || []).length;
  const getRefCallbacks = (code.match(getRefWithCallback) || []).length;
  if (getRefCalls > getRefCallbacks) {
    warnings.push('g_form.getReference() without callback - synchronous call, use callback for async operation');
  }

  // Check for GlideAjax without sysparm_name (processor won't be invoked)
  if (/new\s+GlideAjax\s*\(/.test(code)) {
    if (!/addParam\s*\(\s*['"]sysparm_name['"]/.test(code)) {
      warnings.push('GlideAjax without sysparm_name parameter - processor method will not be invoked');
    }
  }

  // Check for addEncodedQuery with sys_id (prefer structured query)
  if (/\.addEncodedQuery\s*\(\s*['"]sys_id\s*=/.test(code)) {
    warnings.push('addEncodedQuery with sys_id - prefer addQuery(\'sys_id\', value) for clarity');
  }

  // Check for direct DOM manipulation alongside g_form (upgrade risk)
  if (/\bg_form\b/.test(code)) {
    if (/document\.getElementById\s*\(/.test(code) ||
        /document\.querySelector/.test(code) ||
        /\$\s*\(\s*['"]#/.test(code)) {
      warnings.push('Direct DOM manipulation with g_form - prefer g_form APIs, DOM may break on UI upgrades');
    }
  }

  // -------------------------------------------------------------------------
  // Return Results
  // -------------------------------------------------------------------------

  if (errors.length > 0) {
    return { warnings, errors };
  }
  return warnings;
}
