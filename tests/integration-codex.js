/**
 * sena-v2 통합 테스트: Codex Runtime
 *
 * 실제 로컬 인증 세션으로 Codex App Server를 사용하여
 * TurnEngine 전체 파이프라인을 검증한다.
 *
 * 실행: npx tsx tests/integration-codex.ts
 */
import { createTurnEngine } from '../packages/core/dist/index.js';
import { codexRuntime } from '../packages/runtime-codex/dist/index.js';
// ── Helpers ──
function log(label, msg) {
    console.log(`[${label}] ${msg}`);
}
function createTestHook() {
    return {
        name: 'test-system-prompt',
        async execute() {
            return [
                {
                    source: 'integration-test',
                    role: 'system',
                    content: 'You are a helpful assistant being tested. Respond concisely in one sentence. Do not execute any commands or modify any files.',
                },
            ];
        },
    };
}
function createEndHook() {
    const hook = {
        name: 'test-end-logger',
        calls: [],
        async execute(_ctx, result) {
            hook.calls.push({ text: result.text, sessionId: result.sessionId });
        },
    };
    return hook;
}
// ── Main Test ──
async function main() {
    console.log('=== sena-v2 Integration Test: Codex Runtime ===\n');
    const runtime = codexRuntime({
        sandboxMode: 'read-only',
        approvalPolicy: 'never',
    });
    const startHook = createTestHook();
    const endHook = createEndHook();
    const engine = createTurnEngine({
        name: 'integration-test-codex',
        runtime,
        hooks: {
            onTurnStart: [startHook],
            onTurnEnd: [endHook],
        },
        tools: [],
    });
    // ── Test 1: 기본 프롬프트 처리 ──
    log('TEST 1', '기본 프롬프트 처리');
    const events = [];
    const trace = await engine.processTurn({
        input: 'What is 2 + 3? Reply with just the number.',
        trigger: 'programmatic',
        onEvent: (event) => {
            events.push(event);
            log('EVENT', `${event.type}: ${JSON.stringify(event).slice(0, 120)}`);
        },
    });
    // Debug output
    console.log('');
    log('DEBUG', `trace.error: ${trace.error}`);
    log('DEBUG', `trace.result: ${JSON.stringify(trace.result)?.slice(0, 200)}`);
    log('DEBUG', `trace.hooks: ${JSON.stringify(trace.hooks.map(h => h.phase))}`);
    log('DEBUG', `events: ${JSON.stringify(events.map(e => e.type))}`);
    console.log('');
    // Assertions
    assert(trace.agentName === 'integration-test-codex', 'agentName matches');
    assert(trace.trigger === 'programmatic', 'trigger is programmatic');
    assert(trace.input === 'What is 2 + 3? Reply with just the number.', 'input preserved');
    assert(trace.hooks[0].phase === 'onTurnStart', 'first hook is onTurnStart');
    assert(trace.hooks[0].fragments.length === 1, 'system fragment injected');
    assert(trace.assembledContext.includes('integration-test'), 'assembled context has source');
    assert(trace.result !== null, 'result is not null');
    assert(trace.result.text.length > 0, `result text: "${trace.result.text.slice(0, 80)}"`);
    assert(trace.error === null, 'no error');
    assert(trace.hooks.length >= 2, `hooks executed (${trace.hooks.length} traces)`);
    assert(endHook.calls.length === 1, 'onTurnEnd hook called once');
    log('TEST 1', `✅ PASS — result: "${trace.result.text.slice(0, 100)}"`);
    log('TEST 1', `   duration: ${trace.result.durationMs}ms`);
    // ── Test 2: 이벤트 스트리밍 ──
    log('TEST 2', '이벤트 스트리밍 확인');
    const hasSessionInit = events.some(e => e.type === 'session.init');
    const hasProgress = events.some(e => e.type === 'progress' || e.type === 'progress.delta');
    const hasResult = events.some(e => e.type === 'result');
    assert(hasSessionInit, 'session.init event present (thread created)');
    assert(hasResult, 'result event present');
    log('TEST 2', `✅ PASS — session.init: ${hasSessionInit}, progress: ${hasProgress}, result: ${hasResult}`);
    log('TEST 2', `   total events: ${events.length}`);
    // ── Summary ──
    console.log('\n=== All Codex Integration Tests PASSED ===');
}
function assert(condition, message) {
    if (!condition) {
        console.error(`❌ FAIL: ${message}`);
        process.exit(1);
    }
    console.log(`  ✓ ${message}`);
}
main().catch((err) => {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
});
//# sourceMappingURL=integration-codex.js.map