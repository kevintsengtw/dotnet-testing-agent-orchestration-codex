#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const EFFECTIVE_SCENARIO_STATUSES = new Set([
  "accepted",
  "accepted_with_normalization",
  "accepted_with_limitation",
]);

function parseArgs(argv) {
  const result = { analysis: "", writers: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--analysis") result.analysis = argv[++index];
    else if (arg === "--writer") result.writers.push(argv[++index]);
    else if (arg === "--help" || arg === "-h") result.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return result;
}

function usage() {
  return "Usage: node .codex/scripts/dotnet-testing-codex-full/validators/validate-tunit-optional-parameter-contract.mjs --analysis <analysis.json> [--writer <writer-result.json> ...]";
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function sortedUniqueStrings(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sameStringSet(left, right) {
  return JSON.stringify(sortedUniqueStrings(left)) === JSON.stringify(sortedUniqueStrings(right));
}

function sameMarker(left, right) {
  return nonEmptyString(left?.methodIdentifier)
    && left.methodIdentifier === right?.methodIdentifier
    && Array.isArray(left.omittedParameters)
    && Array.isArray(right?.omittedParameters)
    && sameStringSet(left.omittedParameters, right.omittedParameters);
}

function methodIdentifier(method) {
  return nonEmptyString(method?.methodIdentifier) ? method.methodIdentifier : "";
}

function collectMethods(analysis, errors) {
  if (!Array.isArray(analysis.targetClasses) || analysis.targetClasses.length === 0) {
    errors.push("analysis: targetClasses must be a non-empty array");
    return new Map();
  }

  const methods = new Map();
  for (const targetClass of analysis.targetClasses) {
    if (!Array.isArray(targetClass?.methods)) {
      errors.push("analysis: every targetClasses entry must contain a methods array");
      continue;
    }
    for (const method of targetClass.methods) {
      const identifier = methodIdentifier(method);
      if (!identifier) {
        errors.push("analysis: every target method must contain a non-empty methodIdentifier");
        continue;
      }
      if (methods.has(identifier)) {
        errors.push(`analysis: duplicate methodIdentifier ${identifier}`);
        continue;
      }
      methods.set(identifier, method);
    }
  }
  return methods;
}

function validateParameterMetadata(method, identifier, errors) {
  if (!Array.isArray(method.parameters)) {
    errors.push(`analysis: ${identifier}.parameters must be an array`);
    return [];
  }

  const optionalNames = [];
  const seenNames = new Set();
  for (const parameter of method.parameters) {
    if (!nonEmptyString(parameter?.name)) {
      errors.push(`analysis: ${identifier} contains a parameter without a name`);
      continue;
    }
    if (seenNames.has(parameter.name)) {
      errors.push(`analysis: ${identifier} contains duplicate parameter ${parameter.name}`);
      continue;
    }
    seenNames.add(parameter.name);
    if (typeof parameter.isOptional !== "boolean") {
      errors.push(`analysis: ${identifier}.${parameter.name}.isOptional must be boolean`);
      continue;
    }
    if (parameter.isOptional) {
      optionalNames.push(parameter.name);
      if (!nonEmptyString(parameter.defaultValueExpression)) {
        errors.push(`analysis: ${identifier}.${parameter.name}.defaultValueExpression must be non-empty for an optional parameter`);
      }
    } else if (parameter.defaultValueExpression !== null) {
      errors.push(`analysis: ${identifier}.${parameter.name}.defaultValueExpression must be null for a required parameter`);
    }
  }
  return optionalNames;
}

function validateMarker(marker, scenario, methods, optionalByMethod, errors, label) {
  if (!marker || typeof marker !== "object" || Array.isArray(marker)) {
    errors.push(`${label}: optionalParameterDefaultBinding must be an object`);
    return;
  }
  if (!nonEmptyString(marker.methodIdentifier)) {
    errors.push(`${label}: optionalParameterDefaultBinding.methodIdentifier must be non-empty`);
    return;
  }
  if (marker.methodIdentifier !== scenario.methodName) {
    errors.push(`${label}: optionalParameterDefaultBinding.methodIdentifier must equal scenario methodName`);
  }
  if (!methods.has(marker.methodIdentifier)) {
    errors.push(`${label}: optionalParameterDefaultBinding references unknown method ${marker.methodIdentifier}`);
    return;
  }
  if (!Array.isArray(marker.omittedParameters) || marker.omittedParameters.length === 0
      || marker.omittedParameters.some((value) => !nonEmptyString(value))) {
    errors.push(`${label}: optionalParameterDefaultBinding.omittedParameters must be a non-empty string array`);
    return;
  }
  if (new Set(marker.omittedParameters).size !== marker.omittedParameters.length) {
    errors.push(`${label}: optionalParameterDefaultBinding.omittedParameters must not contain duplicates`);
  }
  const optionalNames = optionalByMethod.get(marker.methodIdentifier) ?? [];
  if (!sameStringSet(marker.omittedParameters, optionalNames)) {
    errors.push(`${label}: omittedParameters must equal all optional parameters for ${marker.methodIdentifier}`);
  }
}

function validateWriterChain(writers, requiredScenarios, errors) {
  const coverageByScenario = new Map();
  for (const { filePath, value: writer } of writers) {
    if (!Array.isArray(writer.scenarioCoverage)) {
      errors.push(`writer ${filePath}: scenarioCoverage must be an array`);
      continue;
    }
    for (const coverage of writer.scenarioCoverage) {
      if (!nonEmptyString(coverage?.scenarioId)) continue;
      const rows = coverageByScenario.get(coverage.scenarioId) ?? [];
      rows.push({ filePath, coverage });
      coverageByScenario.set(coverage.scenarioId, rows);
    }
  }

  for (const scenario of requiredScenarios) {
    const rows = coverageByScenario.get(scenario.scenarioId) ?? [];
    if (rows.length !== 1) {
      errors.push(`writer: default-binding scenario ${scenario.scenarioId} must have exactly one scenarioCoverage row`);
      continue;
    }
    const { filePath, coverage } = rows[0];
    const label = `writer ${filePath}: scenarioCoverage ${scenario.scenarioId}`;
    if (coverage.status !== "implemented") {
      errors.push(`${label} must have status implemented`);
    }
    if (!Array.isArray(coverage.testMethodNames) || coverage.testMethodNames.length === 0
        || coverage.testMethodNames.some((value) => !nonEmptyString(value))) {
      errors.push(`${label}.testMethodNames must be a non-empty string array`);
    } else if (!coverage.testMethodNames.includes(scenario.normalizedName)) {
      errors.push(`${label}.testMethodNames must include the analysis normalizedName`);
    }
    if (!sameMarker(coverage.optionalParameterDefaultBinding, scenario.optionalParameterDefaultBinding)) {
      errors.push(`${label}.optionalParameterDefaultBinding must exactly copy the analysis marker`);
    }
  }

  for (const [scenarioId, rows] of coverageByScenario) {
    for (const { filePath, coverage } of rows) {
      if (coverage.optionalParameterDefaultBinding !== undefined
          && !requiredScenarios.some((scenario) => scenario.scenarioId === scenarioId)) {
        errors.push(`writer ${filePath}: scenarioCoverage ${scenarioId} has an unexpected optionalParameterDefaultBinding marker`);
      }
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args.analysis) throw new Error("--analysis is required");

  const errors = [];
  const analysis = readJson(args.analysis);
  if (!Array.isArray(analysis.methodsToTest) || analysis.methodsToTest.some((value) => !nonEmptyString(value))) {
    errors.push("analysis: methodsToTest must be a string array");
  }
  if (!Array.isArray(analysis.scenarioCatalog)) {
    errors.push("analysis: scenarioCatalog must be an array");
  }

  const methods = collectMethods(analysis, errors);
  const inScopeMethods = Array.isArray(analysis.methodsToTest) ? analysis.methodsToTest : [];
  const optionalByMethod = new Map();
  for (const identifier of inScopeMethods) {
    const method = methods.get(identifier);
    if (!method) {
      errors.push(`analysis: methodsToTest references unknown methodIdentifier ${identifier}`);
      continue;
    }
    optionalByMethod.set(identifier, validateParameterMetadata(method, identifier, errors));
  }

  const effectiveScenarios = Array.isArray(analysis.scenarioCatalog)
    ? analysis.scenarioCatalog.filter((scenario) => EFFECTIVE_SCENARIO_STATUSES.has(scenario?.status))
    : [];
  const requiredScenarios = [];
  for (const scenario of effectiveScenarios) {
    if (scenario.optionalParameterDefaultBinding === undefined) continue;
    const label = `analysis: scenario ${scenario.scenarioId ?? "<missing-id>"}`;
    validateMarker(scenario.optionalParameterDefaultBinding, scenario, methods, optionalByMethod, errors, label);
    requiredScenarios.push(scenario);
  }

  for (const [identifier, optionalNames] of optionalByMethod) {
    if (optionalNames.length === 0) continue;
    const matches = requiredScenarios.filter((scenario) => (
      scenario.methodName === identifier
      && sameStringSet(scenario.optionalParameterDefaultBinding?.omittedParameters ?? [], optionalNames)
    ));
    if (matches.length === 0) {
      errors.push(`analysis: optional method ${identifier} requires an effective default-binding scenario that omits all optional parameters`);
    }
  }

  const writers = args.writers.map((filePath) => ({ filePath, value: readJson(filePath) }));
  if (writers.length > 0) validateWriterChain(writers, requiredScenarios, errors);

  if (errors.length > 0) {
    process.stderr.write(`${JSON.stringify({ status: "invalid", errors }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`${JSON.stringify({
    status: "valid",
    workflow: "tunit",
    inScopeMethodCount: inScopeMethods.length,
    optionalMethodCount: [...optionalByMethod.values()].filter((names) => names.length > 0).length,
    defaultBindingScenarioCount: requiredScenarios.length,
    writerCount: writers.length,
  })}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n${usage()}\n`);
  process.exitCode = 1;
}
