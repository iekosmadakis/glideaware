/**
 * ServiceNow-Specific Warnings
 * 
 * Analyzes code for ServiceNow anti-patterns, performance issues,
 * and best practice violations.
 */

/**
 * Extracts all GlideRecord variable names from code
 * @param {string} code - The code to analyze
 * @returns {string[]} Array of variable names
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

/**
 * Analyzes code for ServiceNow-specific warnings and errors
 * @param {string} code - The code to analyze
 * @returns {string[] | { warnings: string[], errors: string[] }} Warnings array or object with both
 */
export function analyzeServiceNowWarnings(code) {
  const warnings = [];
  const errors = [];
  const grVars = extractGlideRecordVars(code);

  // Warning: update() inside while loop
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

  // Warning: getRowCount() without setLimit()
  if (/\.getRowCount\s*\(\s*\)/.test(code) && !/\.setLimit\s*\(/.test(code)) {
    warnings.push('getRowCount() without setLimit() - may cause performance issues on large tables');
  }

  // Warning: deleteRecord() in a while loop
  if (/while\s*\([^)]*\.next\s*\(\s*\)\s*\)[\s\S]*?\.deleteRecord\s*\(\s*\)/g.test(code)) {
    warnings.push('deleteRecord() in loop - consider deleteMultiple() for better performance');
  }

  // Warning: setAbortAction(true) without return statement
  if (/\.setAbortAction\s*\(\s*true\s*\)/.test(code)) {
    if (!/setAbortAction\s*\(\s*true\s*\)[\s\S]*?return/.test(code)) {
      warnings.push('setAbortAction(true) without return - add return false for Business Rules');
    }
  }

  // Warning: Direct field assignment instead of setValue()
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

  // Warning: GlideAggregate without aggregate function
  if (/new\s+GlideAggregate\s*\(/.test(code)) {
    if (!/\.(groupBy|addAggregate|getAggregate|count)\s*\(/.test(code)) {
      warnings.push('GlideAggregate created but no aggregate function called');
    }
  }

  // Warning: Synchronous getXMLWait() usage
  if (/\.getXMLWait\s*\(\s*\)/.test(code)) {
    warnings.push('getXMLWait() blocks the UI thread - consider async getXMLAnswer() with callback');
  }

  // Warning: getReference() inside a loop
  if (/while\s*\([^)]*\.next\s*\(\s*\)\s*\)[\s\S]*?\.getReference\s*\(/g.test(code) ||
      /for\s*\([^)]*\)[\s\S]*?\.getReference\s*\(/g.test(code)) {
    warnings.push('getReference() inside loop - causes N+1 queries, consider GlideRecord join or caching');
  }

  // Warning: gs.sleep() usage
  if (/\bgs\.sleep\s*\(/.test(code)) {
    warnings.push('gs.sleep() blocks the thread - avoid in production code, use scheduled jobs or events');
  }

  // Warning: Missing setLimit(1) for existence check
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

  // Warning: Hardcoded sys_id values
  const sysIdPattern = /['"][a-f0-9]{32}['"]/gi;
  const sysIdMatches = code.match(sysIdPattern) || [];
  if (sysIdMatches.length > 0) {
    warnings.push(`${sysIdMatches.length} hardcoded sys_id(s) detected - use system properties for portability between instances`);
  }

  // Warning: eval() or GlideEvaluator usage
  if (/\beval\s*\(/.test(code) || /\bGlideEvaluator\b/.test(code)) {
    warnings.push('eval() or GlideEvaluator detected - potential security risk, avoid executing dynamic code');
  }

  // Warning: GlideRecord query without any conditions
  for (const varName of grVars) {
    const escapedVar = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hasQuery = new RegExp(`${escapedVar}\\.query\\s*\\(`).test(code);
    const hasAddQuery = new RegExp(`${escapedVar}\\.(addQuery|addEncodedQuery|addNullQuery|addNotNullQuery|get)\\s*\\(`).test(code);
    
    if (hasQuery && !hasAddQuery) {
      warnings.push(`${varName}.query() without any conditions - this will scan the entire table`);
      break;
    }
  }

  // Warning: gs.getProperty() without default value
  const getPropertyCalls = code.match(/gs\.getProperty\s*\(\s*['"][^'"]+['"]\s*\)/g) || [];
  const getPropertyWithDefault = code.match(/gs\.getProperty\s*\(\s*['"][^'"]+['"]\s*,/g) || [];
  const propsWithoutDefault = getPropertyCalls.length - getPropertyWithDefault.length;
  if (propsWithoutDefault > 0) {
    warnings.push(`${propsWithoutDefault} gs.getProperty() call(s) without default value - consider adding a fallback`);
  }

  // Warning: updateMultiple() or deleteMultiple() without conditions
  for (const varName of grVars) {
    const escapedVar = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hasMultipleOp = new RegExp(`${escapedVar}\\.(updateMultiple|deleteMultiple)\\s*\\(`).test(code);
    const hasCondition = new RegExp(`${escapedVar}\\.(addQuery|addEncodedQuery|addNullQuery|addNotNullQuery)\\s*\\(`).test(code);
    
    if (hasMultipleOp && !hasCondition) {
      warnings.push(`${varName}.updateMultiple()/deleteMultiple() without conditions - will affect ALL records!`);
      break;
    }
  }

  // Warning: new Function() usage (security risk)
  if (/new\s+Function\s*\(/.test(code)) {
    warnings.push('new Function() detected - security risk similar to eval(), avoid dynamic code execution');
  }

  // Warning: gs.include() legacy usage
  if (/\bgs\.include\s*\(/.test(code)) {
    warnings.push('gs.include() is legacy - use Script Includes with Class.create() pattern');
  }

  // Warning: g_form.getReference() without callback
  const getRefPattern = /g_form\.getReference\s*\(\s*['"][^'"]+['"]\s*\)/g;
  const getRefWithCallback = /g_form\.getReference\s*\(\s*['"][^'"]+['"]\s*,/g;
  const getRefCalls = (code.match(getRefPattern) || []).length;
  const getRefCallbacks = (code.match(getRefWithCallback) || []).length;
  if (getRefCalls > getRefCallbacks) {
    warnings.push('g_form.getReference() without callback - synchronous call, use callback for async operation');
  }

  // Warning: GlideAjax without sysparm_name
  if (/new\s+GlideAjax\s*\(/.test(code)) {
    if (!/addParam\s*\(\s*['"]sysparm_name['"]/.test(code)) {
      warnings.push('GlideAjax without sysparm_name parameter - processor method will not be invoked');
    }
  }

  // Warning: addEncodedQuery with sys_id concatenation
  if (/\.addEncodedQuery\s*\(\s*['"]sys_id\s*=/.test(code)) {
    warnings.push('addEncodedQuery with sys_id - prefer addQuery(\'sys_id\', value) for clarity');
  }

  // Warning: current.update() in Business Rule pattern (recursion risk)
  if (/function\s+(executeRule|onBefore|onAfter|onAsync)\s*\(\s*current/.test(code) ||
      /current\s*,\s*previous/.test(code)) {
    if (/\bcurrent\.update\s*\(/.test(code)) {
      warnings.push('current.update() in Business Rule - risks recursion, use Before BR or setWorkflow(false)');
    }
  }

  // Warning: current.insert() in Business Rule pattern (unusual)
  if (/function\s+(executeRule|onBefore|onAfter)\s*\(\s*current/.test(code) ||
      /current\s*,\s*previous/.test(code)) {
    if (/\bcurrent\.insert\s*\(/.test(code)) {
      warnings.push('current.insert() in Business Rule - unusual pattern, verify this is intentional');
    }
  }

  // Warning: updateMultiple() used after next() iteration
  for (const varName of grVars) {
    const escapedVar = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hasNext = new RegExp(`${escapedVar}\\.next\\s*\\(`).test(code);
    const hasUpdateMultiple = new RegExp(`${escapedVar}\\.updateMultiple\\s*\\(`).test(code);
    if (hasNext && hasUpdateMultiple) {
      warnings.push(`${varName} uses both next() and updateMultiple() - updateMultiple ignores per-row changes`);
      break;
    }
  }

  // Warning: gr.get() followed by gr.query() (redundant/incorrect)
  for (const varName of grVars) {
    const escapedVar = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const getPattern = new RegExp(`${escapedVar}\\.get\\s*\\([^)]+\\)[\\s\\S]*?${escapedVar}\\.query\\s*\\(`);
    if (getPattern.test(code)) {
      warnings.push(`${varName}.get() followed by query() - get() already positions the record, query() is redundant`);
      break;
    }
  }

  // Warning: GlideRecordSecure with privileged operations
  if (/new\s+GlideRecordSecure\s*\(/.test(code)) {
    if (/\.setWorkflow\s*\(\s*false\s*\)/.test(code) || 
        /\.autoSysFields\s*\(\s*false\s*\)/.test(code) ||
        /\.updateMultiple\s*\(/.test(code) ||
        /\.deleteMultiple\s*\(/.test(code)) {
      warnings.push('GlideRecordSecure with privileged operation - security intent may be undermined');
    }
  }

  // Warning: Direct DOM manipulation alongside g_form
  if (/\bg_form\b/.test(code)) {
    if (/document\.getElementById\s*\(/.test(code) || 
        /document\.querySelector/.test(code) ||
        /\$\s*\(\s*['"]#/.test(code)) {
      warnings.push('Direct DOM manipulation with g_form - prefer g_form APIs, DOM may break on UI upgrades');
    }
  }

  // Return format based on whether errors exist
  if (errors.length > 0) {
    return { warnings, errors };
  }
  return warnings;
}
