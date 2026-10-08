import { describe, expect, it } from 'vitest';
import { applyModelResponse, type PiModelState } from './session.js';

const empty: PiModelState = { models: [], levels: [] };
const response = (command: string, data: unknown, success = true) => ({ type: 'response', command, success, data });

describe('applyModelResponse', () => {
  it('reads the model, thinking level and what Pi offers from its answers', () => {
    let state = applyModelResponse(empty, response('get_state', { model: { provider: 'anthropic', id: 'claude-opus', name: 'Claude Opus' }, thinkingLevel: 'high', isStreaming: false }));
    state = applyModelResponse(state, response('get_available_models', { models: [{ provider: 'anthropic', id: 'claude-opus', name: 'Claude Opus' }, { provider: 'openai-codex', id: 'gpt-6.1-sol' }] }));
    state = applyModelResponse(state, response('get_available_thinking_levels', { levels: ['low', 'high'] }));
    expect(state).toEqual({ model: 'anthropic/claude-opus', thinking: 'high', loaded: true, models: [{ value: 'anthropic/claude-opus', label: 'Claude Opus (anthropic)' }, { value: 'openai-codex/gpt-6.1-sol', label: 'gpt-6.1-sol (openai-codex)' }], levels: ['low', 'high'] });
  });

  it('follows a model switch, and ignores failures and unrelated records', () => {
    const state = { ...empty, model: 'anthropic/claude-opus' };
    expect(applyModelResponse(state, response('set_model', { provider: 'openai-codex', id: 'gpt-6.1-sol' })).model).toBe('openai-codex/gpt-6.1-sol');
    expect(applyModelResponse(state, response('set_model', undefined, false))).toBe(state);
    expect(applyModelResponse(state, { type: 'message_end' })).toBe(state);
  });

  it('tells an empty model list apart from one Pi has not answered or failed to give', () => {
    expect(applyModelResponse(empty, response('get_available_models', { models: [] }))).toEqual({ ...empty, loaded: true });
    expect(applyModelResponse(empty, response('get_available_models', undefined, false)).loaded).toBeUndefined();
    expect(empty.loaded).toBeUndefined();
  });
});
