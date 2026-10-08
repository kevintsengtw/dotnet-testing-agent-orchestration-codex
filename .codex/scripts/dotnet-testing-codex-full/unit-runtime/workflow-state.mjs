const roleOrder = ["analyzer", "writer", "executor", "reviewer"];
const repairRoleOrder = ["writerRepair", "executorRepair", "reviewerRepair"];
const allRoles = [...roleOrder, ...repairRoleOrder];

export function normalizeRequestedScope(scope) {
  if (scope === undefined) return { kind: "class", rawContent: null, selectors: [] };
  if (!scope || !["class", "methods"].includes(scope.kind)
      || !Array.isArray(scope.selectors)
      || scope.selectors.some((item) => typeof item !== "string" || !item.trim())
      || new Set(scope.selectors).size !== scope.selectors.length
      || (scope.kind === "class" ? scope.selectors.length !== 0 : scope.selectors.length === 0)
      || (scope.rawContent !== null && typeof scope.rawContent !== "string")
      || (scope.kind === "methods" && !scope.rawContent?.trim())) {
    throw new Error("invalid requestedScope: class requires empty selectors; methods requires original text and unique non-empty selectors");
  }
  return { kind: scope.kind, rawContent: scope.rawContent, selectors: [...scope.selectors] };
}

function createPhase() {
  return {
    lifecycle: "pending",
    dispatchCount: 0,
    dispatchedAt: null,
    completedAt: null,
    resultStatus: null,
    artifact: null,
    artifactSeal: null,
    failure: null,
  };
}

function iso(value = new Date().toISOString()) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`invalid timestamp: ${value}`);
  }
  return value;
}

function finishRun(run, decision, now) {
  run.lifecycle = decision;
  run.terminalDecision = decision;
  if (!run.timing.completedAt) {
    run.timing.completedAt = iso(now);
    run.timing.durationMs = Date.parse(run.timing.completedAt) - Date.parse(run.timing.startedAt);
    if (run.timing.durationMs < 0) throw new Error("terminal timestamp cannot precede run start");
  }
  if (decision !== "completed") {
    for (const target of Object.values(run.targets)) {
      if (target.lifecycle !== "running") continue;
      target.lifecycle = "cancelled";
      target.cancellation = {
        kind: "peer_target_terminal",
        message: `Workflow ended with ${decision} before this target could finish`,
        completedAt: run.timing.completedAt,
      };
    }
  }
  return { type: "terminal", decision };
}

function requireTarget(run, target) {
  const value = run?.targets?.[target];
  if (!value) throw new Error(`unknown target: ${target}`);
  return value;
}

function hasTerminalTarget(run, lifecycle) {
  return Object.values(run.targets).some((target) => target.lifecycle === lifecycle);
}

function dispatchedPeers(run) {
  for (const role of allRoles) {
    const targets = Object.entries(run.targets)
      .filter(([, target]) => target.lifecycle === "running" && target[role].lifecycle === "dispatched")
      .map(([name]) => name);
    if (targets.length > 0) return { role, targets };
  }
  return null;
}

function allPriorRolesComplete(run, role) {
  const index = roleOrder.indexOf(role);
  return roleOrder.slice(0, index).every((priorRole) => Object.values(run.targets)
    .every((target) => target[priorRole].lifecycle === "completed"));
}

function allPriorRepairRolesComplete(targetState, role) {
  const index = repairRoleOrder.indexOf(role);
  return targetState.reviewer.lifecycle === "completed"
    && repairRoleOrder.slice(0, index).every((priorRole) => targetState[priorRole].lifecycle === "completed");
}

function dispatchAction(role, targets) {
  if (role === "writer" && targets.length === 1) {
    const targetState = targets[0].state;
    const action = { type: "dispatch_writer", target: targets[0].name };
    if (targetState.analyzer.resultStatus === "blocked") {
      action.analysisMode = "blocked";
      action.failure = targetState.analyzer.failure;
    }
    return action;
  }
  if (role === "executor" && targets.length === 1) {
    const targetState = targets[0].state;
    const action = { type: "dispatch_executor", target: targets[0].name };
    if (targetState.writer.resultStatus === "blocked") {
      action.executionMode = "blocked";
      action.failure = targetState.writer.failure;
    }
    return action;
  }
  const names = targets.map((target) => typeof target === "string" ? target : target.name);
  if (role === "executor" || targets.length === 1) {
    return { type: `dispatch_${role}`, target: names[0] };
  }
  return { type: `dispatch_${role}s`, targets: names };
}

export function createUnitRun({
  targets,
  requestedScopes = {},
  coveragePolicy = { lineThreshold: 80, branchThreshold: 70, maxRepairRounds: 1 },
  now = new Date().toISOString(),
}) {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error("targets must contain at least one target");
  }
  if (new Set(targets).size !== targets.length) throw new Error("targets must be unique");
  if (!requestedScopes || typeof requestedScopes !== "object" || Array.isArray(requestedScopes)
      || Object.keys(requestedScopes).some((target) => !targets.includes(target))) {
    throw new Error("requestedScopes must map only declared targets");
  }
  const scopes = Object.fromEntries(targets.map((target) => [target, normalizeRequestedScope(requestedScopes[target])]));
  for (const metric of ["lineThreshold", "branchThreshold"]) {
    if (!Number.isFinite(coveragePolicy[metric]) || coveragePolicy[metric] < 0 || coveragePolicy[metric] > 100) {
      throw new Error(`${metric} must be between 0 and 100`);
    }
  }
  if (coveragePolicy.maxRepairRounds !== 1) throw new Error("maxRepairRounds must be exactly 1");

  return {
    schemaVersion: 1,
    workflow: "unit",
    lifecycle: "running",
    terminalDecision: null,
    timing: { startedAt: iso(now), completedAt: null, durationMs: null },
    targets: Object.fromEntries(targets.map((target) => [target, {
      lifecycle: "running",
      requestedScope: scopes[target],
      analyzer: createPhase(),
      writer: createPhase(),
      executor: createPhase(),
      reviewer: createPhase(),
      writerRepair: createPhase(),
      executorRepair: createPhase(),
      reviewerRepair: createPhase(),
      coverageRepairRound: 0,
      maxCoverageRepairRounds: coveragePolicy.maxRepairRounds,
      coveragePolicy: { ...coveragePolicy },
      coverageDecision: null,
      coverageDecisionHistory: [],
      releaseEligible: null,
    }])),
  };
}

export function nextAction(run, { now = new Date().toISOString() } = {}) {
  if (!run || run.workflow !== "unit") throw new Error("unit run is required");
  if (run.lifecycle !== "running") {
    return { type: "terminal", decision: run.terminalDecision };
  }

  const terminalDecision = hasTerminalTarget(run, "failed") ? "failed"
    : hasTerminalTarget(run, "blocked") ? "blocked" : null;
  if (terminalDecision) {
    const active = dispatchedPeers(run);
    if (active) return { type: "await_phase_results", ...active };
    return finishRun(run, terminalDecision, now);
  }

  for (const role of roleOrder) {
    if (!allPriorRolesComplete(run, role)) continue;
    const pendingTargets = Object.entries(run.targets)
      .filter(([, targetState]) => targetState.lifecycle === "running" && targetState[role].lifecycle === "pending")
      .map(([name, state]) => ({ name, state }));
    if (pendingTargets.length > 0) {
      // Writers own test-project mutations. Dispatch one target at a time so
      // targets that share a project cannot race on the csproj or helper files.
      return dispatchAction(role, new Set(["writer", "executor"]).has(role)
        ? pendingTargets.slice(0, 1) : pendingTargets);
    }
    const dispatchedTargets = Object.entries(run.targets)
      .filter(([, targetState]) => targetState.lifecycle === "running" && targetState[role].lifecycle === "dispatched")
      .map(([target]) => target);
    if (dispatchedTargets.length > 0) {
      return { type: "await_phase_results", role, targets: dispatchedTargets };
    }
  }


  for (const role of repairRoleOrder) {
    const eligibleTargets = Object.entries(run.targets)
      .filter(([, targetState]) => targetState.lifecycle === "running"
        && targetState.coverageRepairRound === 1
        && allPriorRepairRolesComplete(targetState, role));
    const pendingTargets = eligibleTargets
      .filter(([, targetState]) => targetState[role].lifecycle === "pending")
      .map(([name, state]) => ({ name, state }));
    if (pendingTargets.length > 0) {
      const selected = new Set(["writerRepair", "executorRepair"]).has(role)
        ? pendingTargets.slice(0, 1) : pendingTargets;
      const names = selected.map(({ name }) => name);
      return {
        type: selected.length === 1
          ? `dispatch_${role.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`)}`
          : `dispatch_${role.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`)}s`,
        ...(selected.length === 1 ? { target: names[0] } : { targets: names }),
        repairRound: 1,
      };
    }
    const dispatchedTargets = eligibleTargets
      .filter(([, targetState]) => targetState[role].lifecycle === "dispatched")
      .map(([name]) => name);
    if (dispatchedTargets.length > 0) {
      return { type: "await_phase_results", role, targets: dispatchedTargets, repairRound: 1 };
    }
  }

  return finishRun(run, "completed", now);
}

export function recordDispatch(run, action, { now = new Date().toISOString() } = {}) {
  if (run?.lifecycle !== "running") throw new Error("terminal run cannot dispatch roles");
  const actionRoles = {
    dispatch_analyzer: "analyzer",
    dispatch_analyzers: "analyzer",
    dispatch_writer: "writer",
    dispatch_writers: "writer",
    dispatch_executor: "executor",
    dispatch_reviewer: "reviewer",
    dispatch_reviewers: "reviewer",
    dispatch_writer_repair: "writerRepair",
    dispatch_writer_repairs: "writerRepair",
    dispatch_executor_repair: "executorRepair",
    dispatch_reviewer_repair: "reviewerRepair",
    dispatch_reviewer_repairs: "reviewerRepair",
  };
  const role = actionRoles[action?.type];
  if (!role) throw new Error(`unsupported dispatch action: ${action?.type}`);
  const targets = Array.isArray(action.targets) ? action.targets : [action.target];
  if (targets.length === 0 || targets.some((target) => typeof target !== "string")) {
    throw new Error("dispatch action requires targets");
  }
  if (roleOrder.includes(role) && !allPriorRolesComplete(run, role)) {
    throw new Error(`phase barrier violation: ${role} cannot dispatch before all prior roles complete`);
  }

  for (const target of targets) {
    const targetState = requireTarget(run, target);
    if (repairRoleOrder.includes(role) && !allPriorRepairRolesComplete(targetState, role)) {
      throw new Error(`phase barrier violation: ${role} cannot dispatch before prior repair roles complete`);
    }
    const phase = targetState[role];
    if (phase.lifecycle !== "pending") throw new Error(`${role} for ${target} is not pending`);
    phase.dispatchCount += 1;
    if (role === "writer" && phase.dispatchCount > 1) {
      throw new Error(`single Writer topology violation for target ${target}`);
    }
    phase.lifecycle = "dispatched";
    phase.dispatchedAt = iso(now);
  }
  return run;
}

export function recordPhaseResult(run, {
  role,
  target,
  status,
  artifact = null,
  artifactSeal = null,
  testDeclarations = null,
  failure = null,
  coverageDecision = null,
  outcome = status,
  now = new Date().toISOString(),
}) {
  if (run?.lifecycle !== "running") throw new Error("terminal run cannot accept phase results");
  if (!allRoles.includes(role)) throw new Error(`unsupported role: ${role}`);
  const targetState = requireTarget(run, target);
  if (roleOrder.includes(role) && !allPriorRolesComplete(run, role)) {
    throw new Error(`phase barrier violation: ${role} cannot start before all prior roles complete`);
  }
  if (repairRoleOrder.includes(role) && !allPriorRepairRolesComplete(targetState, role)) {
    throw new Error(`phase barrier violation: ${role} cannot start before prior repair roles complete`);
  }
  if (role === "reviewer" && outcome === "needs_repair"
      && targetState.coverageRepairRound >= targetState.maxCoverageRepairRounds) {
    throw new Error("Coverage repair budget exhausted");
  }
  if (role === "reviewerRepair" && outcome === "needs_repair") {
    throw new Error("Coverage repair budget exhausted");
  }

  const phase = targetState[role];
  if (phase.lifecycle !== "dispatched") throw new Error(`${role} for ${target} has not been dispatched`);
  phase.resultStatus = outcome;
  phase.artifact = artifact;
  phase.artifactSeal = artifactSeal;
  if (testDeclarations !== null) phase.testDeclarations = structuredClone(testDeclarations);
  phase.failure = failure;
  phase.completedAt = iso(now);
  if (Date.parse(phase.completedAt) < Date.parse(phase.dispatchedAt)) {
    throw new Error(`${role} completion timestamp cannot precede dispatch`);
  }

  if (status === "environment_blocked" || status === "blocked") {
    phase.lifecycle = "stopped";
    targetState.lifecycle = "blocked";
    return run;
  }
  if (status === "contract_failed" || status === "failed") {
    phase.lifecycle = "failed";
    targetState.lifecycle = "failed";
    return run;
  }
  if (status !== "completed") throw new Error(`unsupported phase status: ${status}`);
  if (!artifact) throw new Error(`${role} completed result requires an artifact`);
  const acceptedOutcomes = role === "reviewer" || role === "reviewerRepair"
    ? new Set(["completed", "pass", "needs_repair", "best_effort", "fail", "blocked"])
    : new Set(["completed", "blocked"]);
  if (!acceptedOutcomes.has(outcome)) {
    throw new Error(`unsupported completed phase outcome: ${outcome}`);
  }
  if (outcome === "blocked" && !new Set(["analyzer", "writer", "executor", "reviewer", "reviewerRepair"]).has(role)) {
    throw new Error(`${role} completed phase cannot have blocked outcome`);
  }
  if (role === "writer" && targetState.analyzer.resultStatus === "blocked" && outcome !== "blocked") {
    throw new Error(`writer for ${target} must preserve Analyzer blocked outcome`);
  }
  if (role === "executor" && targetState.writer.resultStatus === "blocked" && outcome !== "blocked") {
    throw new Error(`executor for ${target} must preserve Writer blocked outcome`);
  }

  phase.lifecycle = "completed";
  if (coverageDecision) {
    targetState.coverageDecision = coverageDecision;
    targetState.coverageDecisionHistory.push(coverageDecision);
    targetState.releaseEligible = coverageDecision.releaseEligible ?? false;
  }
  if (role === "reviewer" && outcome === "needs_repair") {
    targetState.coverageRepairRound += 1;
    return run;
  }
  if (role === "reviewer" || role === "reviewerRepair") {
    if (outcome === "fail") phase.lifecycle = "failed";
    targetState.lifecycle = outcome === "blocked" ? "blocked" : outcome === "fail" ? "failed" : "completed";
  }
  return run;
}
